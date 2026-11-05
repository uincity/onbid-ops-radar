-- pgTAP 테스트 17: 알림 발송을 받치는 DB 함수 (미발송 목록, 발송 임대, 매분 함수의 미발송 알림 조건) (W12)
-- Design Ref: docs/design-homepage-monitoring.md §5.4. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (pg_net 요청도 커밋되지 않으므로 이 시험이 실제로 앱을 부르지 않는다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- 연결된 DB의 실제 대기 줄·미발송 알림이 시험을 흔들지 않게, 이 트랜잭션 안에서만 정리해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';
update public.web_retry_queue set status = 'cancelled', processed_at = now() where status in ('pending', 'claimed');
insert into public.web_notifications (key, attempt, channel, kind, target_key, status, response_code)
select u.out_key, u.out_attempts + 1, 'log', u.out_kind, u.out_target_key, 'sent', 200 from public.list_unsent_web_notifications(0, null, 50) u;

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.list_unsent_web_notifications(integer, text[], integer)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.list_unsent_web_notifications(integer, text[], integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.list_unsent_web_notifications(integer, text[], integer)', 'EXECUTE'), 'list_unsent: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.lease_web_notification(text, integer)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.lease_web_notification(text, integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.lease_web_notification(text, integer)', 'EXECUTE'), 'lease: 서버 관리용 키만 실행');
select ok(not has_function_privilege('authenticated', 'public.web_enqueue_due_retries()', 'EXECUTE')
      and not has_function_privilege('anon', 'public.web_enqueue_due_retries()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_enqueue_due_retries()', 'EXECUTE'), 'web_enqueue_due_retries: 교체 뒤에도 서버 관리용 키만 실행');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in ('public.list_unsent_web_notifications(integer, text[], integer)'::regprocedure, 'public.lease_web_notification(text, integer)'::regprocedure, 'public.web_enqueue_due_retries()'::regprocedure)),
  '세 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.web_notification_leases'::regclass)
  and has_table_privilege('authenticated', 'public.web_notification_leases', 'SELECT')
  and not has_table_privilege('authenticated', 'public.web_notification_leases', 'INSERT')
  and not has_table_privilege('anon', 'public.web_notification_leases', 'SELECT')
  and not has_table_privilege('service_role', 'public.web_notification_leases', 'INSERT')
  and not has_table_privilege('service_role', 'public.web_notification_leases', 'UPDATE'),
  '임대 표: RLS 켜짐, 로그인 사용자는 읽기만, 비로그인 불가, 서버 관리용 키도 직접 쓰기 불가 (함수로만)');

-- ---------------------------------------------------------------- 준비: 알림 키 몇 개
select public.claim_notification('down:d1', 'down', 'pgtap-d', 1, '{"verdict":"FAIL"}'::jsonb);
select public.claim_notification('ongoing:d1:1', 'ongoing', 'pgtap-d', 1, '{"n":1}'::jsonb);
select public.claim_notification('stale:d9:1', 'stale', 'pgtap-d');
-- 오래된 대기 줄(20분 전)은 직접 넣는다: 줄은 추가 전용이라 시각을 고칠 수 없다 (넣는 것은 막지 않는다)
insert into public.web_notification_keys (key, kind, target_key, incident_no) values ('recovered:d1', 'recovered', 'pgtap-d', 1);
insert into public.web_notifications (key, attempt, channel, kind, target_key, status, created_at) values ('recovered:d1', 0, null, 'recovered', 'pgtap-d', 'queued', now() - interval '20 minutes');

-- ---------------------------------------------------------------- 미발송 목록
select is((select count(*)::int from public.list_unsent_web_notifications(0, null, 50) where out_target_key = 'pgtap-d'), 3, 'list: 미발송 알림 3건 (감시 알림 stale은 제외)');
select is((select string_agg(out_key, ',' order by out_key) from public.list_unsent_web_notifications(0, null, 50) where out_target_key = 'pgtap-d'), 'down:d1,ongoing:d1:1,recovered:d1', 'list: stale·resumed 종류는 앱이 보내지 않으므로 목록에 없음');
select is((select out_key from public.list_unsent_web_notifications(15, null, 50) where out_target_key = 'pgtap-d'), 'recovered:d1', 'list: 15분 넘은 것만 고르면 오래된 줄 하나');
select is((select count(*)::int from public.list_unsent_web_notifications(0, array['down:d1'], 50)), 1, 'list: 키 목록으로 고를 수 있음');
select is((select out_incident_no || '/' || (out_payload ->> 'verdict') || '/' || out_attempts from public.list_unsent_web_notifications(0, array['down:d1'], 5)), '1/FAIL/0', 'list: 사건 번호·payload·마지막 시도 번호(0=대기)를 돌려줌');
select throws_ok($$select * from public.list_unsent_web_notifications(-1, null, 5)$$, '22023', null, 'list: 경과 분은 0 이상');
select throws_ok($$select * from public.list_unsent_web_notifications(0, null, 0)$$, '22023', null, 'list: 개수는 1 이상');
select throws_ok($$select * from public.list_unsent_web_notifications(0, null, 51)$$, '22023', null, 'list: 개수는 50 이하');

-- 시도 기록에 따른 변화
select public.record_notification_attempt('down:d1', 1, 'telegram', 'failed', 500, 'http_5xx');
select is((select out_attempts from public.list_unsent_web_notifications(0, array['down:d1'], 5)), 1, 'list: 실패한 시도가 있으면 마지막 시도 번호가 올라가고 여전히 미발송');
select public.record_notification_attempt('ongoing:d1:1', 1, 'telegram', 'sent', 200);
select is((select count(*)::int from public.list_unsent_web_notifications(0, array['ongoing:d1:1'], 5)), 0, 'list: 발송(sent)된 알림은 목록에서 빠짐');
select public.record_notification_attempt('recovered:d1', 1, 'telegram', 'failed', 500, 'http_5xx');
select public.record_notification_attempt('recovered:d1', 2, 'telegram', 'failed', 500, 'http_5xx');
select public.record_notification_attempt('recovered:d1', 3, 'telegram', 'failed', 500, 'http_5xx');
select public.record_notification_attempt('recovered:d1', 4, 'telegram', 'failed', 500, 'http_5xx');
select is((select out_attempts from public.list_unsent_web_notifications(0, array['recovered:d1'], 5)), 4, 'list: 4번 실패해도 아직 한 번 더 시도할 수 있음');
select public.record_notification_attempt('recovered:d1', 5, 'telegram', 'failed', 429, 'rate_limited');
select is((select count(*)::int from public.list_unsent_web_notifications(0, array['recovered:d1'], 5)), 0, 'list: 5번을 모두 쓰면 목록에서 빠짐 (더 시도하지 않음)');

-- ---------------------------------------------------------------- 발송 임대
select is(public.lease_web_notification('down:d1', 60), true, 'lease: 처음 임대하면 true');
select is(public.lease_web_notification('down:d1', 60), false, 'lease: 임대 중인 키는 다른 실행이 받지 못함 (중복 발송 방지)');
update public.web_notification_leases set leased_until = now() - interval '1 second' where key = 'down:d1';
select is(public.lease_web_notification('down:d1', 60), true, 'lease: 임대 시간이 지나면 다시 받을 수 있음 (앱이 죽은 경우 복구)');
select is(public.lease_web_notification('ongoing:d1:1', 60), false, 'lease: 이미 발송된 알림은 임대하지 않음');
select is(public.lease_web_notification('recovered:d1', 60), false, 'lease: 시도 5회를 모두 쓴 알림은 임대하지 않음');
select is(public.lease_web_notification('nope:1', 60), false, 'lease: 선점되지 않은 키는 임대하지 않음');
select throws_ok($$select public.lease_web_notification('down:d1', 0)$$, '22023', null, 'lease: 임대 시간은 1초 이상');
select throws_ok($$select public.lease_web_notification('down:d1', 601)$$, '22023', null, 'lease: 임대 시간은 600초 이하');
select lives_ok($$select public.record_notification_attempt('down:d1', 2, 'telegram', 'sent', 200)$$, '임대한 알림의 발송 결과를 기록할 수 있음');
update public.web_notification_leases set leased_until = now() - interval '1 second' where key = 'down:d1';
select is(public.lease_web_notification('down:d1', 60), false, 'lease: 발송된 뒤에는 임대 시간이 지나도 임대하지 않음');

-- ---------------------------------------------------------------- 매분 함수: 미발송 알림 조건
-- 지금은 pgtap-d의 알림이 모두 발송됐거나 시도를 다 썼고, 감시 알림(stale)과 오래되지 않은 대기 줄만 있다
select is(public.web_enqueue_due_retries(), null, 'every-minute: 미발송 알림도 예정된 줄도 없으면 앱을 부르지 않음 (감시 알림 stale은 세지 않음)');
select public.claim_notification('cert:pgtap-d:2026-11-05', 'cert', 'pgtap-d');
select is(public.web_enqueue_due_retries(), null, 'every-minute: 15분이 안 된 미발송 알림만 있으면 앱을 부르지 않음 (바로 발송하는 흐름이 먼저)');
insert into public.web_notification_keys (key, kind, target_key) values ('cert:pgtap-d:2026-11-04', 'cert', 'pgtap-d');
insert into public.web_notifications (key, attempt, channel, kind, target_key, status, created_at) values ('cert:pgtap-d:2026-11-04', 0, null, 'cert', 'pgtap-d', 'queued', now() - interval '16 minutes');
select isnt(public.web_enqueue_due_retries(), null, 'every-minute: 15분 넘게 미발송인 알림이 있으면 앱 호출 요청 번호를 돌려줌');
select public.record_notification_attempt('cert:pgtap-d:2026-11-04', 1, 'telegram', 'sent', 200);
select public.record_notification_attempt('cert:pgtap-d:2026-11-05', 1, 'log', 'sent');
select is(public.web_enqueue_due_retries(), null, 'every-minute: 모두 발송되면 다시 앱을 부르지 않음');
-- 감시 알림(stale)은 오래되어도 앱이 보내지 않으므로 세지 않는다
insert into public.web_notification_keys (key, kind, target_key) values ('stale:d9:0', 'stale', 'pgtap-d');
insert into public.web_notifications (key, attempt, channel, kind, target_key, status, created_at) values ('stale:d9:0', 0, null, 'stale', 'pgtap-d', 'queued', now() - interval '3 hours');
select is(public.web_enqueue_due_retries(), null, 'every-minute: 오래된 감시 알림(stale)은 앱 호출 사유가 아님');
-- 점검을 끄면 미발송 알림이 있어도 호출하지 않는다
insert into public.web_notification_keys (key, kind, target_key) values ('cert:pgtap-d:2026-11-03', 'cert', 'pgtap-d');
insert into public.web_notifications (key, attempt, channel, kind, target_key, status, created_at) values ('cert:pgtap-d:2026-11-03', 0, null, 'cert', 'pgtap-d', 'queued', now() - interval '30 minutes');
update public.web_settings set value = 'false'::jsonb where key = 'web_monitor_enabled';
select is(public.web_enqueue_due_retries(), null, 'every-minute: 점검이 꺼져 있으면 미발송 알림이 있어도 앱을 부르지 않음');
update public.web_settings set value = 'true'::jsonb where key = 'web_monitor_enabled';
select isnt(public.web_enqueue_due_retries(), null, 'every-minute: 켜면 다시 호출 (미발송 알림 회수)');

select * from finish();
rollback;

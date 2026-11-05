-- pgTAP 테스트 19: 홈페이지 점검 자체 감시 (W16)
-- Design Ref: docs/design-homepage-monitoring.md §5.5. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (pg_net 요청도 커밋되지 않으므로 이 시험이 실제로 텔레그램을 부르지 않는다. 응답은 net._http_response에 시험용 줄을 넣어 흉내 낸다)
-- 시험 대상 키는 pgtap-hb. 시각은 트랜잭션 안의 now()가 고정이라 경계를 정확히 시험할 수 있다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---------------------------------------------------------------- 시험 도구 (이 트랜잭션 안에서만 존재)
-- 이 트랜잭션 안에서만 기존 점검 실행·감시 흔적을 비워 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = coalesce(finished_at, now()) where status in ('running', 'succeeded', 'partial');
update public.web_settings set value = '130'::jsonb where key = 'web_heartbeat_stale_min';
update public.web_settings set value = '24'::jsonb where key = 'web_heartbeat_realert_hours';

-- 점검을 켜고/끄고 그 변경 시각을 p_ago 전으로 되돌린다 (updated_at은 갱신 장치(web_settings_set_updated_at)가 항상 지금으로 바꾸므로 이 트랜잭션 안에서만 그 장치를 잠시 끈다)
create function pg_temp.setenabled(p_enabled boolean, p_ago interval) returns void language plpgsql as $$
begin
  alter table public.web_settings disable trigger web_settings_set_updated_at;
  update public.web_settings set value = to_jsonb(p_enabled), updated_at = now() - p_ago where key = 'web_monitor_enabled';
  alter table public.web_settings enable trigger web_settings_set_updated_at;
end;
$$;

-- 정상 종료한 실행 하나 (종료가 ago 전). trigger: scheduled|retry|manual, status: succeeded|partial|failed|blocked
create function pg_temp.mkrun(p_trigger text, p_status text, p_ago interval) returns bigint language sql as $$
  insert into public.web_check_runs (target_key, "trigger", slot_at, status, started_at, finished_at, overall_verdict)
  values ('pgtap-hb', p_trigger,
          case when p_trigger = 'scheduled' then date_trunc('second', now() - p_ago) end,
          p_status, now() - p_ago - interval '2 seconds', now() - p_ago, case when p_status in ('succeeded', 'partial') then 'PASS_DATA' end)
  returning id
$$;

create function pg_temp.hb() returns jsonb language sql as $$ select public.web_monitor_heartbeat() $$;
create function pg_temp.act() returns text language sql as $$ select (public.web_monitor_heartbeat() ->> 'action') $$;
create function pg_temp.nkeys(p_kind text) returns integer language sql as $$ select count(*)::int from public.web_notification_keys where kind = p_kind and target_key = 'pgtap-hb' $$;
create function pg_temp.attempts(p_key text) returns text language sql as $$
  select coalesce(string_agg(attempt || ':' || status || coalesce(':' || error_class, ''), ',' order by attempt), '-') from public.web_notifications where key = p_key
$$;

-- ---------------------------------------------------------------- 권한·구조
select ok(not has_function_privilege('anon', 'public.web_monitor_heartbeat()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_monitor_heartbeat()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_monitor_heartbeat()', 'EXECUTE'), 'web_monitor_heartbeat: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.web_heartbeat_post(text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_heartbeat_post(text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_heartbeat_post(text)', 'EXECUTE'), 'web_heartbeat_post: 서버 관리용 키만 실행');
select ok((select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
            where p.oid in ('public.web_monitor_heartbeat()'::regprocedure, 'public.web_heartbeat_post(text)'::regprocedure)), '두 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음');
select ok((select relrowsecurity from pg_class where oid = 'public.web_heartbeat_sends'::regclass), 'web_heartbeat_sends: RLS 켜짐');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'web_heartbeat_sends' and cmd <> 'SELECT'), 0, 'web_heartbeat_sends: 쓰기 정책 없음');
select ok(not has_table_privilege('authenticated', 'public.web_heartbeat_sends', 'INSERT') and not has_table_privilege('authenticated', 'public.web_heartbeat_sends', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.web_heartbeat_sends', 'DELETE') and not has_table_privilege('anon', 'public.web_heartbeat_sends', 'SELECT'), 'web_heartbeat_sends: 로그인 사용자는 읽기만, 비로그인은 불가');

-- ---------------------------------------------------------------- 꺼짐
do $$ begin perform pg_temp.setenabled(false, interval '10 days'); end $$;
select is(pg_temp.act(), 'disabled', '점검이 꺼져 있으면 아무것도 하지 않는다');
select is(pg_temp.nkeys('stale'), 0, '꺼져 있으면 정지 알림 키도 없다');
do $$ begin perform pg_temp.setenabled(true, interval '10 days'); end $$;

-- ---------------------------------------------------------------- 기준: 정상 정시 실행의 종료 시각 (130분 경계)
create temp table g1 as select pg_temp.mkrun('scheduled', 'succeeded', interval '129 minutes') as id;
select is(pg_temp.act(), 'ok', '마지막 정상 실행이 129분 전이면 정상');
update public.web_check_runs set finished_at = now() - interval '130 minutes', started_at = now() - interval '130 minutes 2 seconds' where id = (select id from g1);
select is(pg_temp.act(), 'ok', '정확히 130분 전은 아직 정지가 아니다 (넘어야 한다)');
update public.web_check_runs set finished_at = now() - interval '130 minutes 1 second', started_at = now() - interval '130 minutes 3 seconds' where id = (select id from g1);
select is(pg_temp.act(), 'stale_sent', '130분 1초 전은 정지: 정지 알림을 보낸다');
select is((select count(*)::int from public.web_notification_keys where key = 'stale:' || (select id from g1) || ':1'), 1, '키는 stale:{마지막 정상 실행}:1');
select is(pg_temp.attempts('stale:' || (select id from g1) || ':1'), '0:queued', '발송 직후에는 대기(queued) 줄만 있고 시도 줄은 아직 없다 (pg_net은 비동기)');
select is((select count(*)::int from public.web_heartbeat_sends where key = 'stale:' || (select id from g1) || ':1' and not settled), 1, '요청 번호가 기록되어 다음 주기에 응답을 읽는다');
select ok((select position('홈페이지 점검 정지' in payload ->> 'text') > 0 and position('130' in payload ->> 'text') > 0 from public.web_notifications where key = 'stale:' || (select id from g1) || ':1' and attempt = 0), '정지 문구와 기준(분)이 메시지에 들어 있다');
select is(pg_temp.act(), 'ok', '같은 정지 상태에서 다시 돌려도 같은 알림을 또 만들지 않는다');
select is(pg_temp.nkeys('stale'), 1, '정지 알림 키는 여전히 1개');

-- ---------------------------------------------------------------- 수동·실패·차단 실행은 살아 있음으로 세지 않는다
create temp table m1 as select pg_temp.mkrun('manual', 'succeeded', interval '1 minute') as id;
create temp table f1 as select pg_temp.mkrun('scheduled', 'failed', interval '2 minutes') as id;
select is(pg_temp.act(), 'ok', '수동·실패 실행이 있어도 정지 상태는 그대로다 (새 알림은 안 나감)');
select is((select count(*)::int from public.web_notification_keys where kind = 'resumed' and target_key = 'pgtap-hb'), 0, '수동 점검으로는 재개 알림이 나가지 않는다');

-- ---------------------------------------------------------------- 응답 읽기: 성공·실패·재발송·3회 한도
-- 시험용 응답 줄 (실제 pg_net 응답 표에 이 트랜잭션 안에서만 넣는다)
create temp table req as select net_request_id as id from public.web_heartbeat_sends where key = 'stale:' || (select id from g1) || ':1' and attempt = 1;
insert into net._http_response (id, status_code, timed_out) values ((select id from req), 500, false);
select is(pg_temp.act(), 'ok', '응답을 읽는 주기');
select is(pg_temp.attempts('stale:' || (select id from g1) || ':1'), '0:queued,1:failed:http_5xx', '500 응답은 failed(http_5xx)로 기록된다');
select is((select count(*)::int from public.web_heartbeat_sends where key = 'stale:' || (select id from g1) || ':1' and attempt = 2 and not settled), 1, '실패하면 같은 주기에 재발송(2번째 시도)한다');
-- 2번째 시도: 성공
create temp table req2 as select net_request_id as id from public.web_heartbeat_sends where key = 'stale:' || (select id from g1) || ':1' and attempt = 2;
insert into net._http_response (id, status_code, timed_out) values ((select id from req2), 200, false);
do $$ begin perform pg_temp.act(); end $$;
select is(pg_temp.attempts('stale:' || (select id from g1) || ':1'), '0:queued,1:failed:http_5xx,2:sent', '재발송이 200이면 sent로 기록된다');
select is((select count(*)::int from public.web_heartbeat_sends where key = 'stale:' || (select id from g1) || ':1' and attempt = 3), 0, '보낸 알림은 더 재발송하지 않는다');

-- ---------------------------------------------------------------- 3회까지만 재발송
create temp table g2 as select pg_temp.mkrun('scheduled', 'succeeded', interval '200 minutes') as id; -- 새 정지 사건은 더 늦은 정상 실행이 있어야 키가 다르다
-- (g1이 더 최근이므로 마지막 정상 실행은 여전히 g1 — 다른 키를 시험하려고 g1을 오래된 것으로 바꾼다)
update public.web_check_runs set finished_at = now() - interval '300 minutes', started_at = now() - interval '300 minutes 2 seconds' where id = (select id from g1);
update public.web_check_runs set finished_at = now() - interval '200 minutes', started_at = now() - interval '200 minutes 2 seconds' where id = (select id from g2);
select is(pg_temp.act(), 'stale_sent', '마지막 정상 실행이 g2로 바뀌면 새 키(stale:{g2}:1)로 정지 알림이 나간다');
create temp table req3 as select net_request_id as id from public.web_heartbeat_sends where key = 'stale:' || (select id from g2) || ':1' and attempt = 1;
insert into net._http_response (id, status_code, timed_out) values ((select id from req3), 429, false);
do $$ begin perform pg_temp.act(); end $$;
create temp table req4 as select net_request_id as id from public.web_heartbeat_sends where key = 'stale:' || (select id from g2) || ':1' and attempt = 2;
insert into net._http_response (id, status_code, timed_out) values ((select id from req4), null, true);
do $$ begin perform pg_temp.act(); end $$;
create temp table req5 as select net_request_id as id from public.web_heartbeat_sends where key = 'stale:' || (select id from g2) || ':1' and attempt = 3;
insert into net._http_response (id, status_code, timed_out) values ((select id from req5), 403, false);
do $$ begin perform pg_temp.act(); end $$;
select is(pg_temp.attempts('stale:' || (select id from g2) || ':1'), '0:queued,1:failed:rate_limited,2:failed:timeout,3:failed:http_4xx', '429·타임아웃·403이 분류 이름으로 기록된다');
do $$ begin perform pg_temp.act(); end $$;
select is((select count(*)::int from public.web_heartbeat_sends where key = 'stale:' || (select id from g2) || ':1'), 3, '3회 실패 뒤에는 더 재발송하지 않는다');

-- ---------------------------------------------------------------- 응답이 끝내 오지 않는 요청
create temp table g3 as select pg_temp.mkrun('scheduled', 'succeeded', interval '400 minutes') as id;
update public.web_check_runs set finished_at = now() - interval '500 minutes', started_at = now() - interval '500 minutes 2 seconds' where id in (select id from g1 union select id from g2);
select is(pg_temp.act(), 'stale_sent', '또 다른 정상 실행 기준의 새 정지 알림');
update public.web_heartbeat_sends set sent_at = now() - interval '31 minutes' where key = 'stale:' || (select id from g3) || ':1';
do $$ begin perform pg_temp.act(); end $$;
select is(pg_temp.attempts('stale:' || (select id from g3) || ':1'), '0:queued,1:failed:no_response', '30분이 지나도 응답이 없으면 no_response 실패로 기록한다');

-- ---------------------------------------------------------------- 재알림: 24시간마다 (키 번호 증가). 키는 지울 수 없으므로 과거 시각으로 직접 넣어 시험한다
create temp table g4 as select pg_temp.mkrun('scheduled', 'succeeded', interval '300 minutes') as id;
update public.web_check_runs set finished_at = now() - interval '600 minutes', started_at = now() - interval '600 minutes 2 seconds' where id = (select id from g3);
insert into public.web_notification_keys (key, kind, target_key, created_at) values ('stale:' || (select id from g4) || ':1', 'stale', 'pgtap-hb', now() - interval '23 hours 59 minutes');
insert into public.web_notifications (key, attempt, kind, target_key, status, payload, created_at) values ('stale:' || (select id from g4) || ':1', 0, 'stale', 'pgtap-hb', 'queued', '{"text":"시험"}'::jsonb, now() - interval '23 hours 59 minutes');
select is(pg_temp.act(), 'ok', '정지 알림 뒤 24시간이 안 지났으면 재알림하지 않는다');
-- 24시간이 지난 정지 알림(키 :1)이 있는 새 사건이면 :2로 재알림한다
create temp table g4b as select pg_temp.mkrun('scheduled', 'succeeded', interval '290 minutes') as id;
insert into public.web_notification_keys (key, kind, target_key, created_at) values ('stale:' || (select id from g4b) || ':1', 'stale', 'pgtap-hb', now() - interval '24 hours 1 minute');
insert into public.web_notifications (key, attempt, kind, target_key, status, payload, created_at) values ('stale:' || (select id from g4b) || ':1', 0, 'stale', 'pgtap-hb', 'queued', '{"text":"시험"}'::jsonb, now() - interval '24 hours 1 minute');
select is(pg_temp.act(), 'stale_sent', '마지막 정지 알림이 24시간을 넘었으면 재알림한다');
select is((select count(*)::int from public.web_notification_keys where key = 'stale:' || (select id from g4b) || ':2'), 1, '재알림 키는 번호가 올라간다 (stale:{마지막 정상 실행}:2)');
update public.web_check_runs set finished_at = now() - interval '700 minutes', started_at = now() - interval '700 minutes 2 seconds' where id = (select id from g4b);

-- ---------------------------------------------------------------- 정상으로 돌아옴: 재개 알림 1회
create temp table g5 as select pg_temp.mkrun('scheduled', 'succeeded', interval '1 minute') as id;
select is(pg_temp.act(), 'resumed_sent', '새 정상 실행이 있으면 재개 알림을 보낸다');
select is((select count(*)::int from public.web_notification_keys where kind = 'resumed' and target_key = 'pgtap-hb'), 1, '재개 알림 키는 1개');
select is(pg_temp.act(), 'ok', '재개 알림은 한 번만 나간다');
select is((select count(*)::int from public.web_notification_keys where kind = 'resumed' and target_key = 'pgtap-hb'), 1, '다시 돌려도 재개 알림 키는 그대로 1개');

-- ---------------------------------------------------------------- 점검을 다시 켠 직후에는 정지가 울리지 않는다
-- 이전 시험 실행을 모두 오래된 것으로 밀어 두고, g5만 600분 전으로 둔다
update public.web_check_runs set finished_at = now() - interval '1000 minutes', started_at = now() - interval '1000 minutes 2 seconds' where target_key = 'pgtap-hb' and "trigger" = 'scheduled';
update public.web_check_runs set finished_at = now() - interval '600 minutes', started_at = now() - interval '600 minutes 2 seconds' where id = (select id from g5);
do $$ begin perform pg_temp.setenabled(true, interval '10 minutes'); end $$;
select is(pg_temp.act(), 'ok', '마지막 정상 실행이 오래됐어도 점검을 다시 켠 지 10분이면 정지가 울리지 않는다');
do $$ begin perform pg_temp.setenabled(true, interval '131 minutes'); end $$;
select is(pg_temp.act(), 'stale_sent', '다시 켠 지 131분이 지나도록 새 정상 실행이 없으면 정지 알림');

-- ---------------------------------------------------------------- Vault 비밀값이 없으면 보내지 않고 secret_missing으로 기록한다
create temp table g6 as select pg_temp.mkrun('scheduled', 'succeeded', interval '700 minutes') as id;
update public.web_check_runs set finished_at = now() - interval '1000 minutes', started_at = now() - interval '1000 minutes 2 seconds' where target_key = 'pgtap-hb' and "trigger" = 'scheduled';
update public.web_check_runs set finished_at = now() - interval '700 minutes', started_at = now() - interval '700 minutes 2 seconds' where id = (select id from g6);
delete from vault.secrets where name in ('onbid_telegram_token', 'onbid_telegram_chat_id');
select is(pg_temp.act(), 'stale_sent', '비밀값이 없어도 알림 키는 선점되고 실패로 기록된다');
select is(pg_temp.attempts('stale:' || (select id from g6) || ':1'), '0:queued,1:failed:secret_missing', '비밀값이 없으면 secret_missing 실패로 남는다 (보내지 않음)');
select is((select count(*)::int from public.web_heartbeat_sends where key = 'stale:' || (select id from g6) || ':1'), 0, '보내지 않았으므로 요청 번호도 없다');

-- ---------------------------------------------------------------- 기록에 비밀값·주소가 남지 않는다
select is((select count(*)::int from public.web_notifications where payload::text ~* '(api\.telegram|bot[0-9]+:)'), 0, '알림 기록에 텔레그램 주소·토큰 모양이 없다');
select is((select count(*)::int from public.web_notifications where error_class is not null and error_class !~ '^[a-z0-9_]{1,40}$'), 0, '오류는 분류 이름만 남는다');

select * from finish();
rollback;

-- pgTAP 테스트 15: 웹 알림 테이블 2개와 상태 전환·알림 DB 함수, 기존 이상징후 표의 WEB 허용 (W10a)
-- Design Ref: docs/design-homepage-monitoring.md §5.3·§5.4·§6.1·§6.3. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (RLS·읽기 전용 권한 일반 점검은 00_rls_guard·03_sec04가 모든 테이블에 자동으로 한다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(85);

-- 연결된 DB에 실행 중인 웹 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 모두 마감해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.claim_notification(text, text, text, integer, jsonb, bigint)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.claim_notification(text, text, text, integer, jsonb, bigint)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.claim_notification(text, text, text, integer, jsonb, bigint)', 'EXECUTE'), 'claim_notification: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.record_notification_attempt(text, integer, text, text, integer, text, bigint)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.record_notification_attempt(text, integer, text, text, integer, text, bigint)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.record_notification_attempt(text, integer, text, text, integer, text, bigint)', 'EXECUTE'), 'record_notification_attempt: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.record_recovery_event(bigint, integer, text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.record_recovery_event(bigint, integer, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.record_recovery_event(bigint, integer, text)', 'EXECUTE'), 'record_recovery_event: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.record_web_transition(bigint, text, integer, jsonb)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.record_web_transition(bigint, text, integer, jsonb)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.record_web_transition(bigint, text, integer, jsonb)', 'EXECUTE'), 'record_web_transition: 서버 관리용 키만 실행');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in (
      'public.claim_notification(text, text, text, integer, jsonb, bigint)'::regprocedure,
      'public.record_notification_attempt(text, integer, text, text, integer, text, bigint)'::regprocedure,
      'public.record_recovery_event(bigint, integer, text)'::regprocedure,
      'public.record_web_transition(bigint, text, integer, jsonb)'::regprocedure)),
  '네 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음'
);
select ok(not has_table_privilege('service_role', 'public.web_notifications', 'INSERT')
      and not has_table_privilege('service_role', 'public.web_notification_keys', 'INSERT')
      and not has_table_privilege('authenticated', 'public.web_notifications', 'INSERT')
      and has_table_privilege('authenticated', 'public.web_notifications', 'SELECT')
      and not has_table_privilege('anon', 'public.web_notifications', 'SELECT'),
  '알림 표는 직접 추가 불가(서버 관리용 키 포함), 로그인 사용자는 읽기만, 비로그인은 읽기도 불가');

-- ---------------------------------------------------------------- 기존 이상징후 표 확장 (제약 3개)
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('WEB', 'pgtap-x', 'WEB_FRESHNESS', 'h')$$, 'anomalies: 출처 WEB과 규칙 WEB_FRESHNESS 허용');
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('WEB', 'pgtap-x', 'WEB_AVAILABILITY', 'h')$$, 'anomalies: 규칙 WEB_AVAILABILITY 허용');
select throws_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('TEST', 'pgtap-x', 'WEB_AVAILABILITY', 'h')$$, '23514', null, 'anomalies: 모르는 출처는 계속 거부');
select throws_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('WEB', 'pgtap-x', 'WEB_OTHER', 'h')$$, '23514', null, 'anomalies: 모르는 규칙은 계속 거부');
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'PGTAP-1', 'DATE_ORDER', 'h')$$, 'anomalies: 기존 출처·규칙은 그대로 허용');
select throws_ok(
  $$insert into public.anomaly_events (anomaly_id, actor_type, event_type, from_value, to_value) values ((select min(id) from public.anomalies), 'system', 'recovered', '1', '1')$$,
  '23514', null, 'anomaly_events: recovered는 이전 값이 없어야 함');
select throws_ok(
  $$insert into public.anomaly_events (anomaly_id, actor_type, event_type, to_value) values ((select min(id) from public.anomalies), 'system', 'recovered', 'abc')$$,
  '23514', null, 'anomaly_events: recovered의 값은 사건 번호(숫자)여야 함');
select throws_ok(
  $$insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, to_value) values ((select min(id) from public.anomalies), 'user', gen_random_uuid(), 'admin', 'recovered', '1')$$,
  '23514', null, 'anomaly_events: 사용자 행위자의 recovered는 거부(시스템 기록만)');

-- ---------------------------------------------------------------- 알림 키 선점
select is(public.claim_notification('down:1', 'down', 'pgtap-web', 1, '{"duration":"0"}'::jsonb), true, 'claim: 처음 선점하면 true');
select is(public.claim_notification('down:1', 'down', 'pgtap-web', 1), false, 'claim: 같은 키는 두 번째부터 false');
select is((select count(*)::int from public.web_notification_keys where key = 'down:1'), 1, '키는 한 줄만 있음');
select is((select attempt::int || '/' || status || '/' || coalesce(channel, 'null') from public.web_notifications where key = 'down:1'), '0/queued/null', '선점하면 대기(queued, 시도 0, 채널 미정) 줄이 함께 생김');
select is((select count(*)::int from public.web_notifications where key = 'down:1'), 1, '중복 선점은 대기 줄을 더 만들지 않음');
select throws_ok($$select public.claim_notification('down:2', 'cert', 'pgtap-web')$$, '23514', null, 'claim: 키가 종류로 시작하지 않으면 거부');
select throws_ok($$select public.claim_notification('zzz:1', 'zzz', 'pgtap-web')$$, '23514', null, 'claim: 모르는 종류는 거부');
select throws_ok($$select public.claim_notification('down: 3', 'down', 'pgtap-web')$$, '23514', null, 'claim: 키에 공백이 있으면 거부');
select throws_ok($$select public.claim_notification('down:4', 'down', 'Bad Target')$$, '23514', null, 'claim: 대상 이름 모양이 틀리면 거부');
select throws_ok($$select public.claim_notification('down:5', 'down', 'pgtap-web', 0)$$, '23514', null, 'claim: 사건 번호는 1 이상');
select lives_ok($$select public.claim_notification('stale:9:1', 'stale', 'pgtap-web', null, '{}'::jsonb, 12345)$$, 'claim: 감시 알림은 요청 번호를 함께 남길 수 있음');
select is((select net_request_id from public.web_notifications where key = 'stale:9:1'), 12345::bigint, 'claim: 요청 번호가 대기 줄에 기록됨');

-- ---------------------------------------------------------------- 발송 시도 기록
select lives_ok($$select public.record_notification_attempt('down:1', 1, 'log', 'failed', 500, 'http_5xx')$$, 'attempt: 1번 시도(실패) 기록');
select throws_ok($$select public.record_notification_attempt('down:1', 3, 'log', 'sent', 200)$$, '23000', null, 'attempt: 번호를 건너뛰면 거부');
select throws_ok($$select public.record_notification_attempt('down:1', 1, 'log', 'sent', 200)$$, '23000', null, 'attempt: 같은 번호 중복 거부');
select lives_ok($$select public.record_notification_attempt('down:1', 2, 'log', 'sent', 200)$$, 'attempt: 2번 시도(성공) 기록');
select throws_ok($$select public.record_notification_attempt('down:1', 3, 'log', 'sent', 200)$$, '23000', null, 'attempt: 이미 발송된 알림에는 더할 수 없음');
select is((select status from public.web_notifications where key = 'down:1' order by attempt desc limit 1), 'sent', '키마다 마지막 줄이 현재 상태(sent)');
select is((select count(*)::int from public.web_notifications where key = 'down:1'), 3, '대기 1 + 시도 2 = 3줄이 쌓임(수정 없이 추가)');
select throws_ok($$select public.record_notification_attempt('nope:1', 1, 'log', 'sent', 200)$$, 'P0002', null, 'attempt: 선점되지 않은 키는 거부');
select throws_ok($$select public.record_notification_attempt('stale:9:1', 1, 'log', 'maybe')$$, '22023', null, 'attempt: 결과는 sent/failed만');
select throws_ok($$select public.record_notification_attempt('stale:9:1', 1, 'mail', 'sent', 200)$$, '23514', null, 'attempt: 채널은 telegram/log만');
select throws_ok($$select public.record_notification_attempt('stale:9:1', 1, 'log', 'failed', 500, 'Bad Class!')$$, '23514', null, 'attempt: 오류 분류에는 내부 문구(공백·대문자·기호) 거부');
select throws_ok($$select public.record_notification_attempt('stale:9:1', 1, 'log', 'sent', 200, 'oops')$$, '23514', null, 'attempt: 성공 줄에는 오류 분류를 붙일 수 없음');
select throws_ok($$select public.record_notification_attempt('stale:9:1', 1, 'log', 'sent', 99)$$, '23514', null, 'attempt: 응답 코드는 100~599');

-- ---------------------------------------------------------------- 추가 전용 (수정·삭제·비우기 불가)
select throws_ok($$update public.web_notifications set status = 'failed' where key = 'down:1'$$, '23000', null, 'web_notifications: 수정 불가');
select throws_ok($$delete from public.web_notifications where key = 'down:1'$$, '23000', null, 'web_notifications: 삭제 불가');
select throws_ok($$truncate public.web_notifications$$, '23000', null, 'web_notifications: 비우기 불가');
select throws_ok($$update public.web_notification_keys set kind = 'cert' where key = 'down:1'$$, '23000', null, 'web_notification_keys: 수정 불가');
select throws_ok($$delete from public.web_notification_keys where key = 'down:1'$$, '23000', null, 'web_notification_keys: 삭제 불가');
select throws_ok($$truncate public.web_notification_keys cascade$$, '23000', null, 'web_notification_keys: 비우기 불가');

-- ---------------------------------------------------------------- 복구 확인 기록 (열린 WEB 이상징후에만)
create temp table rec_a as select out_anomaly_id as id from public.record_detection('WEB', 'pgtap-web', 'WEB_AVAILABILITY', '{}'::jsonb, 'h1');
create temp table demo_a as select out_anomaly_id as id from public.record_detection('DEMO', 'PGTAP-2', 'DATE_ORDER', '{}'::jsonb, 'h1');
select lives_ok($$select public.record_recovery_event((select id from rec_a), 1, '지속 시간 0분')$$, 'recovery: 열린 WEB 이상징후에 복구 확인 기록');
select is((select event_type || '/' || actor_type || '/' || to_value from public.anomaly_events where anomaly_id = (select id from rec_a) and event_type = 'recovered'), 'recovered/system/1', 'recovery: 시스템 행위자, 값은 사건 번호');
select is((select status from public.anomalies where id = (select id from rec_a)), 'open', 'recovery: 이상징후의 상태는 바뀌지 않음');
select throws_ok($$select public.record_recovery_event((select id from rec_a), 1)$$, '23505', null, 'recovery: 같은 사건 번호의 복구 확인은 한 번만');
select lives_ok($$select public.record_recovery_event((select id from rec_a), 2)$$, 'recovery: 다른 사건 번호는 기록 가능');
select throws_ok($$select public.record_recovery_event((select id from demo_a), 1)$$, '23000', null, 'recovery: WEB이 아닌 이상징후는 거부');
select throws_ok($$select public.record_recovery_event(-1, 1)$$, 'P0002', null, 'recovery: 없는 이상징후는 거부');
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select id from rec_a);
select throws_ok($$select public.record_recovery_event((select id from rec_a), 3)$$, '23000', null, 'recovery: 종결된 이상징후에는 기록하지 않음');

-- ---------------------------------------------------------------- 상태 전환: 준비 (시험용 대상 pgtap-trans)
create temp table runs as
  select (select out_run_id from public.start_web_check_run('pgtap-trans', 'manual', null)) as manual_id;
select public.finish_web_check_run((select manual_id from runs), 'succeeded', 'PASS_DATA', 5);
create temp table runs2 as
  select (select out_run_id from public.start_web_check_run('pgtap-trans', 'scheduled', null, null, '2026-11-05 05:00:00+00')) as sched_id;
select public.finish_web_check_run((select sched_id from runs2), 'succeeded', 'FAIL', 5);
create temp table runs3 as
  select (select out_run_id from public.start_web_check_run('pgtap-trans', 'retry', null, (select sched_id from runs2))) as running_id;

-- 입력 JSON: 장애 시작 (사건 1)
create temp table dec_down as select jsonb_build_object(
  'state', jsonb_build_object('current_verdict', 'FAIL', 'since', '2026-11-05T05:07:00Z', 'first_failure_at', '2026-11-05T05:07:00Z',
                              'incident_no', 1, 'incident_open', true, 'incident_last_alert_at', '2026-11-05T05:07:00Z'),
  'detection', jsonb_build_object('evidence', jsonb_build_object('reason', 'TIMEOUT'), 'value_hash', 'v1'),
  'notifications', jsonb_build_array(jsonb_build_object('key', 'down:7', 'kind', 'down', 'incident_no', 1, 'payload', jsonb_build_object('reason', 'TIMEOUT')))
) as d;

select throws_ok($$select public.record_web_transition((select manual_id from runs), 'pgtap-trans', null, (select d from dec_down))$$, '23000', null, 'transition: 수동 점검은 상태를 바꿀 수 없음');
select throws_ok($$select public.record_web_transition((select running_id from runs3), 'pgtap-trans', null, (select d from dec_down))$$, '23000', null, 'transition: 끝나지 않은 실행은 거부');
select throws_ok($$select public.record_web_transition((select sched_id from runs2), 'pgtap-other', null, (select d from dec_down))$$, 'P0002', null, 'transition: 실행의 대상과 다르면 거부');
select throws_ok($$select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', null, '{"x":1}'::jsonb)$$, '22023', null, 'transition: 결정에 state가 없으면 거부');

-- ---------------------------------------------------------------- 상태 전환: 버전 충돌
create temp table t_conflict as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 0, (select d from dec_down)) as r;
select is((select r ->> 'result' from t_conflict), 'CONFLICT', 'transition: 상태 줄이 없는데 버전을 주면 CONFLICT');
select is((select count(*)::int from public.web_target_state where target_key = 'pgtap-trans') + (select count(*)::int from public.web_notification_keys where key = 'down:7'), 0, 'transition: CONFLICT면 아무것도 저장하지 않음');

-- ---------------------------------------------------------------- 상태 전환: 정상 저장 (장애 시작)
create temp table t1 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', null, (select d from dec_down)) as r;
select is((select r ->> 'result' || '/' || (r ->> 'version') from t1), 'OK/1', 'transition: 첫 전환은 OK, 버전 1');
select is((select r -> 'claimed' from t1), '["down:7"]'::jsonb, 'transition: 선점에 성공한 알림 키를 돌려줌');
select is((select r ->> 'anomaly_action' from t1), 'created', 'transition: 이상징후가 새로 생김');
select is((select current_verdict || '/' || incident_no || '/' || incident_open || '/' || version from public.web_target_state where target_key = 'pgtap-trans'), 'FAIL/1/true/1', 'transition: 상태 줄이 저장됨');
select is((select a.source || '/' || a.rule_id || '/' || a.status from public.anomalies a join public.web_target_state s on s.open_anomaly_id = a.id where s.target_key = 'pgtap-trans'), 'WEB/WEB_AVAILABILITY/open', 'transition: 열린 이상징후(WEB)가 상태에 연결됨');
select is((select status || '/' || (payload ->> 'reason') from public.web_notifications where key = 'down:7'), 'queued/TIMEOUT', 'transition: 대기(queued) 줄이 payload와 함께 만들어짐');

select is((select r ->> 'result' from (select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', null, (select d from dec_down)) as r) x), 'CONFLICT', 'transition: 이미 줄이 있는데 null 버전이면 CONFLICT');
select is((select r ->> 'result' from (select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 5, (select d from dec_down)) as r) x), 'CONFLICT', 'transition: 버전이 다르면 CONFLICT');
select is((select version from public.web_target_state where target_key = 'pgtap-trans'), 1, 'transition: CONFLICT는 상태를 바꾸지 않음');

-- 같은 사건의 같은 알림은 중복 선점 안 됨 (버전 1 → 2)
create temp table t2 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 1, (select d from dec_down)) as r;
select is((select r ->> 'version' || '/' || (r ->> 'anomaly_action') from t2), '2/detected_again', 'transition: 같은 사건이 이어지면 같은 이상징후의 발생 횟수가 늘어남');
select is((select r -> 'claimed' from t2), '[]'::jsonb, 'transition: 같은 키는 다시 선점되지 않음');
select is((select count(*)::int from public.web_notifications where key = 'down:7'), 1, 'transition: 대기 줄도 중복 생성 안 됨');

-- ---------------------------------------------------------------- 트랜잭션 원자성
select throws_ok(
  $$select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 2,
      jsonb_set((select d from dec_down), '{state,current_verdict}', '"BOGUS"'))$$,
  '23514', null, 'transition: 상태 값이 규칙에 어긋나면 전체가 취소됨');
select throws_ok(
  $$select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 2,
      jsonb_set((select d from dec_down), '{notifications}', '[{"key":"down:8","kind":"down","incident_no":1},{"key":"zzz:1","kind":"zzz"}]'::jsonb))$$,
  '23514', null, 'transition: 알림 하나가 규칙에 어긋나면 전체가 취소됨');
select is((select version from public.web_target_state where target_key = 'pgtap-trans'), 2, 'transition: 취소되면 상태 버전이 그대로');
select is((select count(*)::int from public.web_notification_keys where key = 'down:8'), 0, 'transition: 취소되면 앞서 선점한 알림 키도 남지 않음');

-- ---------------------------------------------------------------- 복구 (이상징후 이력 + 확정 판정 채움)
create temp table dec_up as select jsonb_build_object(
  'state', jsonb_build_object('current_verdict', 'PASS_DATA', 'since', '2026-11-05T08:07:00Z', 'incident_no', 1, 'incident_open', false),
  'recovery', jsonb_build_object('note', '지속 시간 3시간', 'incident_no', 1),
  'confirm', jsonb_build_object('origin_run_id', (select sched_id from runs2), 'confirmed_verdict', 'FAIL', 'flap', false),
  'notifications', jsonb_build_array(jsonb_build_object('key', 'recovered:7', 'kind', 'recovered', 'incident_no', 1))
) as d;
create temp table anom_ids as select open_anomaly_id as id from public.web_target_state where target_key = 'pgtap-trans';
create temp table t3 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 2, (select d from dec_up)) as r;
select is((select r ->> 'result' || '/' || (r ->> 'recovered') || '/' || (r ->> 'confirmed') from t3), 'OK/true/true', 'transition: 복구는 이력 기록과 확정 판정 채움까지 한 번에 처리');
select is((select count(*)::int from public.anomaly_events where anomaly_id = (select id from anom_ids) and event_type = 'recovered' and to_value = '1'), 1, 'transition: 열린 이상징후에 복구 확인됨 이력이 남음');
select is((select confirmed_verdict || '/' || flap from public.web_check_runs where id = (select sched_id from runs2)), 'FAIL/false', 'transition: 원래 정시 실행의 확정 판정이 채워짐');
select is((select open_anomaly_id is null and not incident_open from public.web_target_state where target_key = 'pgtap-trans'), true, 'transition: 사건이 끝나면 열린 이상징후 연결이 비워짐');
select is((select count(*)::int from public.web_notifications where key = 'recovered:7' and status = 'queued'), 1, 'transition: 복구 알림이 대기 줄로 만들어짐');

-- 확정 판정은 한 번만 채워진다
create temp table dec_up2 as select jsonb_set((select d from dec_up), '{confirm,confirmed_verdict}', '"PASS_DATA"') as d;
create temp table t4 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 3, jsonb_set((select d from dec_up2), '{notifications}', '[]'::jsonb)) as r;
select is((select r ->> 'confirmed' from t4), 'false', 'transition: 이미 채워진 확정 판정은 덮어쓰지 않음');

-- ---------------------------------------------------------------- 담당자가 사건 중간에 이상징후를 닫은 경우
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select id from anom_ids);
create temp table dec_down2 as select jsonb_set(jsonb_set((select d from dec_down), '{state,incident_no}', '2'), '{notifications}', '[{"key":"down:9","kind":"down","incident_no":2}]'::jsonb) as d;
create temp table t5 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 4, (select d from dec_down2)) as r;
select is((select r ->> 'anomaly_action' from t5), 'recurred', 'transition: 종결된 건 뒤의 새 장애는 재발로 연결된 새 이상징후');
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select open_anomaly_id from public.web_target_state where target_key = 'pgtap-trans');
create temp table dec_up3 as select jsonb_build_object(
  'state', jsonb_build_object('current_verdict', 'PASS_DATA', 'since', '2026-11-05T10:07:00Z', 'incident_no', 2, 'incident_open', false),
  'recovery', jsonb_build_object('incident_no', 2)
) as d;
create temp table t6 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 5, (select d from dec_up3)) as r;
select is((select r ->> 'result' || '/' || (r ->> 'recovered') from t6), 'OK/false', 'transition: 담당자가 이미 닫은 이상징후에는 복구 이력을 만들지 않고 건너뜀');

-- ---------------------------------------------------------------- 정상 판정으로 닫은 건과 같은 값이면 열린 이상징후가 없다 (suppressed)
update public.anomalies set status = 'dismissed', verdict = 'false_positive'
 where id = (select max(id) from public.anomalies where source = 'WEB' and item_key = 'pgtap-trans');
create temp table t7 as select public.record_web_transition((select sched_id from runs2), 'pgtap-trans', 6, (select d from dec_down)) as r;
select is((select r ->> 'anomaly_action' from t7), 'suppressed', 'transition: 정상 판정한 건과 같은 값이면 억제됨');
select is((select open_anomaly_id is null from public.web_target_state where target_key = 'pgtap-trans'), true, 'transition: 억제되면 열린 이상징후 연결은 비어 있음');

select * from finish();
rollback;

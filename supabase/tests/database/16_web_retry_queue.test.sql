-- pgTAP 테스트 16: 확인 재시도·대체 실행 대기 줄의 수명주기 함수와 매분 확인 함수 (W11)
-- Design Ref: docs/design-homepage-monitoring.md §5.2·§6.3. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (pg_net 요청도 커밋되지 않으므로 이 시험이 실제로 앱을 부르지 않는다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- 연결된 DB에 실행 중인 점검·대기 줄이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 모두 정리해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';
update public.web_retry_queue set status = 'cancelled', processed_at = now() where status in ('pending', 'claimed');

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.enqueue_web_confirm(text, bigint, integer)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_web_confirm(text, bigint, integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.enqueue_web_confirm(text, bigint, integer)', 'EXECUTE'), 'enqueue_web_confirm: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.claim_due_web_retry()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.claim_due_web_retry()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.claim_due_web_retry()', 'EXECUTE'), 'claim_due_web_retry: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.finish_web_retry(bigint, text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.finish_web_retry(bigint, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.finish_web_retry(bigint, text)', 'EXECUTE'), 'finish_web_retry: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.web_retry_housekeeping()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_retry_housekeeping()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_retry_housekeeping()', 'EXECUTE'), 'web_retry_housekeeping: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.web_enqueue_due_retries()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_enqueue_due_retries()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_enqueue_due_retries()', 'EXECUTE'), 'web_enqueue_due_retries: 서버 관리용 키만 실행');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in (
      'public.enqueue_web_confirm(text, bigint, integer)'::regprocedure, 'public.claim_due_web_retry()'::regprocedure,
      'public.finish_web_retry(bigint, text)'::regprocedure, 'public.web_retry_housekeeping()'::regprocedure, 'public.web_enqueue_due_retries()'::regprocedure)),
  '다섯 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음'
);

-- ---------------------------------------------------------------- 준비: 실행 3개 (정시 A, 정시 B, 수동)
create temp table runs as select
  (select out_run_id from public.start_web_check_run('pgtap-q', 'scheduled', null, null, '2026-11-05 05:00:00+00')) as a_id;
select public.finish_web_check_run((select a_id from runs), 'succeeded', 'FAIL', 5);
-- 시험 안에서는 모든 줄의 started_at이 같아서(트랜잭션 시각) 순서를 직접 정해 둔다
update public.web_check_runs set started_at = now() - interval '2 hours' where id = (select a_id from runs);
create temp table runs_m as select (select out_run_id from public.start_web_check_run('pgtap-q', 'manual', null)) as m_id;
select public.finish_web_check_run((select m_id from runs_m), 'succeeded', 'PASS_DATA', 5);

-- ---------------------------------------------------------------- 확인 재시도 예약
create temp table q1 as select public.enqueue_web_confirm('pgtap-q', (select a_id from runs), 90) as id;
select isnt((select id from q1), null, 'enqueue: 정시 실행에 확인 재시도를 예약하면 줄 번호를 돌려줌');
select is((select kind || '/' || status || '/' || attempts from public.web_retry_queue where id = (select id from q1)), 'confirm/pending/0', 'enqueue: confirm, 대기, 시도 0');
select ok((select due_at between now() + interval '89 seconds' and now() + interval '91 seconds' from public.web_retry_queue where id = (select id from q1)), 'enqueue: 예정 시각은 지금 + 대기 초');
select is(public.enqueue_web_confirm('pgtap-q', (select a_id from runs), 90), null, 'enqueue: 대상에 대기 줄이 이미 있으면 새로 만들지 않고 null');
select is((select count(*)::int from public.web_retry_queue where target_key = 'pgtap-q' and status in ('pending', 'claimed')), 1, 'enqueue: 대상별 대기/처리 중 줄은 1개');
select throws_ok($$select public.enqueue_web_confirm('pgtap-other', (select a_id from runs), 90)$$, 'P0002', null, 'enqueue: 실행의 대상과 다르면 거부');
select throws_ok($$select public.enqueue_web_confirm('pgtap-q', (select m_id from runs_m), 90)$$, '23000', null, 'enqueue: 수동 점검에는 예약할 수 없음');
select throws_ok($$select public.enqueue_web_confirm('pgtap-q', -1, 90)$$, 'P0002', null, 'enqueue: 없는 실행은 거부');
select throws_ok($$select public.enqueue_web_confirm('pgtap-q', (select a_id from runs), -1)$$, '22023', null, 'enqueue: 음수 대기 시간은 거부');

-- ---------------------------------------------------------------- 선점
select is((select count(*)::int from public.claim_due_web_retry()), 0, 'claim: 예정 시각 전의 줄은 선점하지 않음 (빈 결과)');
update public.web_retry_queue set due_at = now() - interval '1 second' where id = (select id from q1);
create temp table c1 as select * from public.claim_due_web_retry();
select is((select out_id from c1), (select id from q1), 'claim: 예정 시각이 지난 줄을 선점');
select is((select out_target_key || '/' || out_kind || '/' || out_attempts from c1), 'pgtap-q/confirm/1', 'claim: 대상·종류·시도 횟수를 돌려줌');
select is((select status from public.web_retry_queue where id = (select id from q1)), 'claimed', 'claim: 선점하면 처리 중으로 바뀜');
select is((select count(*)::int from public.claim_due_web_retry()), 0, 'claim: 이미 선점된 줄은 두 번째 호출이 받지 못함 (중복 처리 방지)');

-- ---------------------------------------------------------------- 결과 기록
select throws_ok($$select public.finish_web_retry(1, 'maybe')$$, '22023', null, 'finish: 결과는 done/cancelled/retry만');
select is(public.finish_web_retry((select id from q1), 'done'), true, 'finish: 처리 중인 줄을 done으로 마감');
select is((select status || '/' || (processed_at is not null) from public.web_retry_queue where id = (select id from q1)), 'done/true', 'finish: 처리 시각이 기록됨');
select is(public.finish_web_retry((select id from q1), 'done'), false, 'finish: 이미 끝난 줄은 바꾸지 않고 false');
select isnt(public.enqueue_web_confirm('pgtap-q', (select a_id from runs), 90), null, 'enqueue: 앞의 줄이 끝나면 같은 대상에 다시 예약할 수 있음');

-- ---------------------------------------------------------------- 다시 시도 (retry): 최대 3번
update public.web_retry_queue set due_at = now() - interval '1 second' where target_key = 'pgtap-q' and status = 'pending';
create temp table c2 as select * from public.claim_due_web_retry();
select is(public.finish_web_retry((select out_id from c2), 'retry'), true, 'retry: 1번째 시도 뒤 retry는 대기로 되돌림');
select is((select status || '/' || (claimed_at is null) || '/' || attempts from public.web_retry_queue where id = (select out_id from c2)), 'pending/true/1', 'retry: 대기, 선점 시각 비움, 시도 1 유지');
select ok((select due_at between now() + interval '59 seconds' and now() + interval '61 seconds' from public.web_retry_queue where id = (select out_id from c2)), 'retry: 1분 뒤에 다시 예정됨');
update public.web_retry_queue set due_at = now() - interval '1 second' where id = (select out_id from c2);
create temp table c3 as select * from public.claim_due_web_retry();
select is((select out_attempts from c3), 2, 'retry: 2번째 선점의 시도 횟수는 2');
select is(public.finish_web_retry((select out_id from c3), 'retry'), true, 'retry: 2번째도 대기로 되돌림');
update public.web_retry_queue set due_at = now() - interval '1 second' where id = (select out_id from c2);
create temp table c4 as select * from public.claim_due_web_retry();
select is((select out_attempts from c4), 3, 'retry: 3번째 선점의 시도 횟수는 3');
select is(public.finish_web_retry((select out_id from c4), 'retry'), true, 'retry: 3번째 시도 뒤에는');
select is((select status from public.web_retry_queue where id = (select out_id from c2)), 'cancelled', 'retry: 더 이상 되돌리지 않고 취소');

-- ---------------------------------------------------------------- 멈춘 줄 복구
create temp table q2 as select public.enqueue_web_confirm('pgtap-q', (select a_id from runs), 0) as id;
create temp table c5 as select * from public.claim_due_web_retry();
update public.web_retry_queue set claimed_at = now() - interval '4 minutes' where id = (select id from q2);
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q2)), 'claimed', 'housekeeping: 처리 중 4분은 아직 멈춘 것으로 보지 않음');
update public.web_retry_queue set claimed_at = now() - interval '6 minutes' where id = (select id from q2);
select public.web_retry_housekeeping();
select is((select status || '/' || (claimed_at is null) from public.web_retry_queue where id = (select id from q2)), 'pending/true', 'housekeeping: 5분 넘게 멈춘 처리 중 줄은 대기로 되돌림');
update public.web_retry_queue set status = 'claimed', claimed_at = now() - interval '6 minutes', attempts = 3 where id = (select id from q2);
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q2)), 'cancelled', 'housekeeping: 3번 시도하고도 멈춘 줄은 취소');

-- ---------------------------------------------------------------- 만료
create temp table q3 as select public.enqueue_web_confirm('pgtap-q', (select a_id from runs), 90) as id;
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q3)), 'pending', 'expire: 다음 정시 점검이 시작되기 전에는 그대로');
create temp table runs_b as select (select out_run_id from public.start_web_check_run('pgtap-q', 'scheduled', null, null, '2026-11-05 06:00:00+00')) as b_id;
select public.finish_web_check_run((select b_id from runs_b), 'succeeded', 'PASS_DATA', 5);
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q3)), 'cancelled', 'expire: 다음 정시 점검이 시작되었으면 오래된 확인 재시도는 취소');
-- 차단된 정시 점검은 "다음 정시 점검 시작"으로 보지 않는다
create temp table q4 as select public.enqueue_web_confirm('pgtap-q', (select b_id from runs_b), 90) as id;
update public.web_check_runs set started_at = now() - interval '1 hour' where id = (select b_id from runs_b);
insert into public.web_check_runs (target_key, "trigger", status, finished_at, slot_at) values ('pgtap-q', 'scheduled', 'blocked', now(), '2026-11-05 07:00:00+00');
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q4)), 'pending', 'expire: 차단된(blocked) 정시 점검은 만료 사유가 아님');
-- 원래 실행이 지워졌으면(보존 삭제) 취소
delete from public.web_check_runs where id = (select b_id from runs_b);
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where id = (select id from q4)), 'cancelled', 'expire: 원래 실행이 없어진 확인 재시도는 취소');
-- 대체 실행(replace)은 만료시키지 않는다
create temp table runs_c as select (select out_run_id from public.start_web_check_run('pgtap-q', 'scheduled', null, null, '2026-11-05 08:00:00+00')) as c_id;
insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at) values ('pgtap-q', 'replace', (select a_id from runs), now() + interval '1 minute');
select public.web_retry_housekeeping();
select is((select status from public.web_retry_queue where target_key = 'pgtap-q' and kind = 'replace'), 'pending', 'expire: 대체 실행(replace) 줄은 만료되지 않음');

-- ---------------------------------------------------------------- 매분 확인 함수
update public.web_retry_queue set status = 'cancelled', processed_at = now() where status in ('pending', 'claimed');
select is(public.web_enqueue_due_retries(), null, 'every-minute: 빈 큐에서는 앱을 부르지 않음 (null)');
insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at) values ('pgtap-q', 'replace', (select a_id from runs), now() + interval '5 minutes');
select is(public.web_enqueue_due_retries(), null, 'every-minute: 예정 시각이 아직 안 된 줄만 있으면 앱을 부르지 않음');
update public.web_retry_queue set due_at = now() - interval '1 second' where status = 'pending';
select isnt(public.web_enqueue_due_retries(), null, 'every-minute: 예정 시각이 지난 줄이 있으면 앱 호출 요청 번호를 돌려줌');
update public.web_settings set value = 'false'::jsonb where key = 'web_monitor_enabled';
select is(public.web_enqueue_due_retries(), null, 'every-minute: 점검이 꺼져 있으면 예정된 줄이 있어도 앱을 부르지 않음');
update public.web_settings set value = 'true'::jsonb where key = 'web_monitor_enabled';
update public.web_retry_queue set status = 'claimed', claimed_at = now() where status = 'pending';
select is(public.web_enqueue_due_retries(), null, 'every-minute: 처리 중인 줄만 있으면 앱을 부르지 않음');

select * from finish();
rollback;

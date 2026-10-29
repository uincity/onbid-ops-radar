-- pgTAP 테스트 04: start_check_run — 동시 실행 차단과 멈춘 실행 정리  (PLAN 작업 22, PRD 5-2 규칙 7)
-- Design Ref: DESIGN §6.3(start_check_run), §5.1(1. 시작)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- 연결된 DB에 이미 실행 중인 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 모두 마감해 둔다 (끝에 되돌려진다)
update public.check_runs set status = 'failed', finished_at = now() where status = 'running';

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.start_check_run(text, text, uuid)', 'EXECUTE'), '비로그인(anon)은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.start_check_run(text, text, uuid)', 'EXECUTE'), '로그인 사용자(authenticated)도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.start_check_run(text, text, uuid)', 'EXECUTE'), '서버 관리용 키(service_role)는 실행할 수 있음');
select ok(
  (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'public.start_check_run(text, text, uuid)'::regprocedure),
  '소유자 권한으로 실행되고 search_path가 비어 있음'
);

-- ---------------------------------------------------------------- 정상 시작
create temp table first_run as select * from public.start_check_run('manual', 'DEMO', null);
select is((select out_status from first_run), 'running', '실행 중인 점검이 없으면 running으로 시작');
select is((select status from public.check_runs where id = (select out_run_id from first_run)), 'running', 'check_runs에 running 줄이 생김');
select is((select finished_at from public.check_runs where id = (select out_run_id from first_run)), null, 'running 줄은 종료 시각이 비어 있음');

-- ---------------------------------------------------------------- 동시 실행 차단
create temp table second_run as select * from public.start_check_run('scheduled', 'DEMO', null);
select is((select out_status from second_run), 'blocked', '이미 실행 중이면 blocked로 돌려줌');
select is(
  (select status || '/' || (finished_at is not null)::text from public.check_runs where id = (select out_run_id from second_run)),
  'blocked/true',
  'blocked 줄은 종료 시각까지 채워져 기록됨'
);
select is((select status from public.check_runs where id = (select out_run_id from first_run)), 'running', '처음 실행은 그대로 running (차단이 영향을 주지 않음)');
select is((select count(*)::int from public.run_logs where run_id = (select out_run_id from second_run) and code = 'RUN_BLOCKED'), 1, '차단 메모(RUN_BLOCKED)가 1줄 남음');
select is((select count(*)::int from public.check_runs where status = 'running'), 1, 'running은 전체에서 1개뿐');

-- ---------------------------------------------------------------- 멈춘 실행 정리 경계 (기준 120초)
-- 119초 지난 running은 아직 정리하지 않는다 → 새 시작은 차단된다
update public.check_runs set started_at = now() - interval '119 seconds' where id = (select out_run_id from first_run);
select is((select out_status from public.start_check_run('manual', 'DEMO', null)), 'blocked', '119초 지난 running은 정리하지 않음 (새 시작은 차단)');

-- 121초 지난 running은 실패로 마감하고 새 실행이 시작된다
update public.check_runs set started_at = now() - interval '121 seconds' where id = (select out_run_id from first_run);
create temp table third_run as select * from public.start_check_run('manual', 'DEMO', null);
select is((select out_status from third_run), 'running', '121초 지난 running을 정리한 뒤 새 실행이 시작됨');
select is((select status from public.check_runs where id = (select out_run_id from first_run)), 'failed', '멈춘 실행은 failed로 마감됨');
select is((select count(*)::int from public.run_logs where run_id = (select out_run_id from first_run) and code = 'RUN_STALE_CLOSED'), 1, '멈춘 실행 정리 메모(RUN_STALE_CLOSED)가 남음');

-- ---------------------------------------------------------------- 잘못된 입력은 거부 (예약 점검에 담당자를 붙일 수 없음)
select throws_ok(
  $$select * from public.start_check_run('scheduled', 'DEMO', gen_random_uuid())$$,
  '23514',
  null,
  '예약 점검에 담당자(triggered_by)를 붙이면 거부'
);

select * from finish();
rollback;

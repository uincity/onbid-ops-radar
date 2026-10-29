-- pgTAP 테스트 10: 예약 누락 감지 mark_schedule_missed() (R07, PRD 5-2-5)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다. 시험은 실제 운영 날짜와 겹치지 않도록 2020년 날짜를 쓴다.
-- KST 09:00 = UTC 00:00, 확인 기한 KST 09:30 = UTC 00:30 (대기 30분 기본값)

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------- 권한 (3)
select ok(has_function_privilege('service_role', 'public.mark_schedule_missed(timestamptz)', 'execute'), '서버 관리용 키는 실행할 수 있음');
select ok(not has_function_privilege('authenticated', 'public.mark_schedule_missed(timestamptz)', 'execute'), '로그인 사용자는 실행할 수 없음');
select ok(not has_function_privilege('anon', 'public.mark_schedule_missed(timestamptz)', 'execute'), '로그인 없는 사용자는 실행할 수 없음');

-- ---------------------------------------------------------------- 기한 전·후 경계 (3)
select is(public.mark_schedule_missed('2020-01-02 00:29:59+00'), 'not_due', '09:29:59(KST 2020-01-02)는 아직 기한 전: 기록하지 않음 (한 칸 안)');
select is((select count(*)::int from public.run_logs where code = 'SCHEDULE_MISSED' and log_date = '2020-01-02'), 0, '기한 전에는 누락 줄이 없음');
select is(public.mark_schedule_missed('2020-01-02 00:30:00+00'), 'recorded', '정확히 09:30:00이면 누락으로 기록 (한 칸 밖)');

-- ---------------------------------------------------------------- 날짜당 1건 (2)
select is(public.mark_schedule_missed('2020-01-02 05:00:00+00'), 'already_recorded', '같은 날 다시 불러도 새 줄을 만들지 않음');
select is((select count(*)::int from public.run_logs where code = 'SCHEDULE_MISSED' and log_date = '2020-01-02'), 1, '날짜당 누락 기록은 1건');

-- ---------------------------------------------------------------- 기록 내용 (2)
select is((select level || '/' || coalesce(run_id::text, 'null') from public.run_logs where code = 'SCHEDULE_MISSED' and log_date = '2020-01-02'), 'warn/null', '누락 기록은 경고 수준이고 연결된 실행이 없음');
select is(public.mark_schedule_missed('2020-01-03 00:30:00+00'), 'recorded', '다음 날은 따로 기록됨 (날짜가 바뀌면 새 건)');

-- ---------------------------------------------------------------- 예약 실행 기록이 있으면 누락이 아님 (3)
-- 차단(blocked)된 예약 실행도 "시작 기록이 있음"으로 본다
insert into public.check_runs ("trigger", source, status, started_at, finished_at)
values ('scheduled', 'DEMO', 'blocked', '2020-01-04 00:00:05+00', '2020-01-04 00:00:05+00');
select is(public.mark_schedule_missed('2020-01-04 01:00:00+00'), 'run_exists', '차단된 예약 실행 기록이 있으면 누락으로 보지 않음');
-- 수동 점검은 예약 점검을 대신하지 않는다
insert into public.check_runs ("trigger", source, status, started_at, finished_at)
values ('manual', 'DEMO', 'succeeded', '2020-01-05 00:00:05+00', '2020-01-05 00:00:09+00');
select is(public.mark_schedule_missed('2020-01-05 01:00:00+00'), 'recorded', '수동 점검만 있으면 예약 누락으로 기록');
-- 전날 예약 실행은 다음 날 기록을 대신하지 않는다 (KST 날짜 경계: 2020-01-04 15:00Z = KST 2020-01-05 00:00)
select is(public.mark_schedule_missed('2020-01-06 00:30:00+00'), 'recorded', '전날 실행 기록은 오늘을 대신하지 않음');

select * from finish();
rollback;

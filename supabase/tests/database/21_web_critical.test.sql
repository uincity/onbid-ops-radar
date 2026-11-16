-- pgTAP 테스트 21: 핵심 시간대 촉진 점검(W26) — 설정 4개, trigger='critical' 실행, 확인 재시도 출처, 핵심 시간대 집계 함수
-- Design Ref: docs/design-homepage-monitoring.md §5.10. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- web_critical_tick()은 켜져 있을 때 현재 시각·pg_net·Vault를 쓰므로 여기서는 "꺼져 있으면 아무것도 하지 않음"과 권한만 본다.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- 연결된 DB에 실행 중인 웹 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 모두 마감해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.web_critical_tick()', 'EXECUTE'), 'tick: 비로그인은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.web_critical_tick()', 'EXECUTE'), 'tick: 로그인 사용자도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.web_critical_tick()', 'EXECUTE'), 'tick: 서버 관리용 키는 실행할 수 있음');
select ok(not has_function_privilege('anon', 'public.web_summarize_critical(date, text)', 'EXECUTE'), '집계: 비로그인은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.web_summarize_critical(date, text)', 'EXECUTE'), '집계: 로그인 사용자도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.web_summarize_critical(date, text)', 'EXECUTE'), '집계: 서버 관리용 키는 실행할 수 있음');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in ('public.web_critical_tick()'::regprocedure, 'public.web_summarize_critical(date, text)'::regprocedure)),
  '두 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음'
);

-- ---------------------------------------------------------------- 설정 4개
select is((select count(*)::int from public.web_settings where key like 'web\_critical\_%'), 4, '핵심 시간대 설정 항목 4개');
select is((select value from public.web_settings where key = 'web_critical_enabled'), 'false'::jsonb, '촉진 점검은 기본으로 꺼져 있음');
select is((select value from public.web_settings where key = 'web_critical_hours'), '"09-11,14-18"'::jsonb, '기본 구간 09-11,14-18');
select is((select value from public.web_settings where key = 'web_critical_interval_min'), '10'::jsonb, '기본 간격 10분');
select is((select value from public.web_settings where key = 'web_critical_ongoing_min'), '60'::jsonb, '기본 지속 알림 간격 60분');

select lives_ok($$update public.web_settings set value = 'true'::jsonb where key = 'web_critical_enabled'$$, '켜기 true 허용');
select throws_ok($$update public.web_settings set value = '1'::jsonb where key = 'web_critical_enabled'$$, '23514', null, '켜기에 숫자는 거부');
select throws_ok($$update public.web_settings set value = '"true"'::jsonb where key = 'web_critical_enabled'$$, '23514', null, '켜기에 글자는 거부');

select lives_ok($$update public.web_settings set value = '"8-9"'::jsonb where key = 'web_critical_hours'$$, '구간 8-9 허용');
select lives_ok($$update public.web_settings set value = '"9-11,11-13,14-18"'::jsonb where key = 'web_critical_hours'$$, '구간 여러 개 허용');
select throws_ok($$update public.web_settings set value = '"abc"'::jsonb where key = 'web_critical_hours'$$, '23514', null, '구간 형식이 아니면 거부');
select throws_ok($$update public.web_settings set value = '"09:00-11:00"'::jsonb where key = 'web_critical_hours'$$, '23514', null, '시:분 형식은 거부');
select throws_ok($$update public.web_settings set value = '"09-11,"'::jsonb where key = 'web_critical_hours'$$, '23514', null, '끝에 쉼표는 거부');
select throws_ok($$update public.web_settings set value = '9'::jsonb where key = 'web_critical_hours'$$, '23514', null, '구간에 숫자는 거부');

select lives_ok($$update public.web_settings set value = '5'::jsonb where key = 'web_critical_interval_min'$$, '간격 5 허용');
select lives_ok($$update public.web_settings set value = '30'::jsonb where key = 'web_critical_interval_min'$$, '간격 30 허용');
select throws_ok($$update public.web_settings set value = '7'::jsonb where key = 'web_critical_interval_min'$$, '23514', null, '간격 7 거부 (60의 약수가 아님)');
select throws_ok($$update public.web_settings set value = '60'::jsonb where key = 'web_critical_interval_min'$$, '23514', null, '간격 60 거부');
select throws_ok($$update public.web_settings set value = '"10"'::jsonb where key = 'web_critical_interval_min'$$, '23514', null, '간격에 글자는 거부');

select lives_ok($$update public.web_settings set value = '10'::jsonb where key = 'web_critical_ongoing_min'$$, '지속 알림 10 허용');
select lives_ok($$update public.web_settings set value = '180'::jsonb where key = 'web_critical_ongoing_min'$$, '지속 알림 180 허용');
select throws_ok($$update public.web_settings set value = '9'::jsonb where key = 'web_critical_ongoing_min'$$, '23514', null, '지속 알림 9 거부');
select throws_ok($$update public.web_settings set value = '181'::jsonb where key = 'web_critical_ongoing_min'$$, '23514', null, '지속 알림 181 거부');

-- ---------------------------------------------------------------- 촉진 실행: 시작·중복·차단
create temp table c1 as select * from public.start_web_check_run('critical-test', 'critical', null, null, '2026-11-11 05:17:00+00');
select is((select out_status from c1), 'running', '촉진 실행이 시작됨');
select is((select slot_at from public.web_check_runs where id = (select out_run_id from c1)), null, '촉진 실행의 정시 칸(slot_at)은 비어 있음');
select is((select critical_slot_at from public.web_check_runs where id = (select out_run_id from c1)), '2026-11-11 05:17:00+00'::timestamptz, '촉진 칸 시각이 critical_slot_at에 들어감');

create temp table c2 as select * from public.start_web_check_run('critical-test', 'critical', null, null, '2026-11-11 05:27:00+00');
select is((select out_status from c2), 'blocked', '실행 중이면 다음 촉진 칸은 막힘(건너뜀)');
select is((select count(*)::int from public.web_retry_queue where target_key = 'critical-test'), 0, '촉진이 막혀도 대체 실행(replace)을 예약하지 않음');

select is((select public.finish_web_check_run((select out_run_id from c1), 'succeeded', 'FAIL', 5)), true, '촉진 실행을 종료');
create temp table c3 as select * from public.start_web_check_run('critical-test', 'critical', null, null, '2026-11-11 05:17:00+00');
select is((select out_status from c3), 'blocked', '같은 촉진 칸은 끝난 뒤에도 중복으로 막힘');

-- 제약: 촉진 칸 시각은 critical 실행만, critical 실행에는 반드시
select throws_ok(
  $$insert into public.web_check_runs (target_key, "trigger", critical_slot_at) values ('critical-test', 'manual', now())$$,
  '23514', null, 'manual 실행에 촉진 칸 시각은 거부');
select throws_ok(
  $$insert into public.web_check_runs (target_key, "trigger") values ('critical-test', 'critical')$$,
  '23514', null, 'critical 실행에 촉진 칸 시각이 없으면 거부');

-- ---------------------------------------------------------------- 확인 재시도의 원래 실행
select isnt(public.enqueue_web_confirm('critical-test', (select out_run_id from c1), 90), null, '정상 종료된 촉진 실행에도 확인 재시도를 예약할 수 있음');
select is((select origin_run_id from public.web_retry_queue where target_key = 'critical-test' and kind = 'confirm'), (select out_run_id from c1), '재시도 줄의 출처는 촉진 실행');

create temp table m1 as select * from public.start_web_check_run('critical-test', 'manual', null);
select public.finish_web_check_run((select out_run_id from m1), 'succeeded', 'PASS_DATA', 5);
select throws_ok($$select public.enqueue_web_confirm('critical-test', (select out_run_id from m1), 90)$$, '23000', null, '수동 실행은 여전히 확인 재시도의 출처가 될 수 없음');

-- ---------------------------------------------------------------- 핵심 시간대 집계 (2026-11-11 수요일)
-- 정시 14:00 KST 정상(안), 정시 18:00 KST 정상(구간 밖), 촉진 14:17 실패→재확인 정상, 촉진 14:27 정상, 촉진 14:37 실패(재확인 없음), 촉진 18:17 정상(구간 밖)
insert into public.web_check_runs (target_key, "trigger", status, finished_at, slot_at, overall_verdict) values
  ('crit-sum', 'scheduled', 'succeeded', now(), '2026-11-11 05:00:00+00', 'PASS_DATA'),
  ('crit-sum', 'scheduled', 'succeeded', now(), '2026-11-11 09:00:00+00', 'PASS_DATA');
insert into public.web_check_runs (target_key, "trigger", status, finished_at, critical_slot_at, overall_verdict) values
  ('crit-sum', 'critical', 'succeeded', now(), '2026-11-11 05:17:00+00', 'FAIL'),
  ('crit-sum', 'critical', 'succeeded', now(), '2026-11-11 05:27:00+00', 'PASS_DATA'),
  ('crit-sum', 'critical', 'succeeded', now(), '2026-11-11 05:37:00+00', 'FAIL'),
  ('crit-sum', 'critical', 'succeeded', now(), '2026-11-11 09:17:00+00', 'PASS_DATA');
insert into public.web_check_runs (target_key, "trigger", status, finished_at, origin_run_id, overall_verdict)
  select 'crit-sum', 'retry', 'succeeded', now(), r.id, 'PASS_DATA' from public.web_check_runs r where r.target_key = 'crit-sum' and r.critical_slot_at = '2026-11-11 05:17:00+00';

select is((select pass_data from public.web_summarize_critical('2026-11-11', 'crit-sum')), 3, '정상 3: 정시 14시 + 촉진(재확인으로 정상) + 촉진 14:27');
select is((select fail from public.web_summarize_critical('2026-11-11', 'crit-sum')), 1, '실패 1: 재확인 없는 촉진 실패');
select is((select critical_runs from public.web_summarize_critical('2026-11-11', 'crit-sum')), 3, '구간 안 촉진 실행 3회 (18시 촉진은 제외)');
select is((select (pass_data + pass_no_data + degraded + fail + unverified + not_run) from public.web_summarize_critical('2026-11-11', 'crit-sum')), 4, '판정 합계 4 (구간 밖 정시·촉진은 제외)');
select is((select count(*)::int from public.web_summarize_critical('2026-11-14', 'crit-sum')), 0, '토요일은 핵심 시간대가 없어 0줄');
select is((select pass_data + fail from public.web_summarize_day('2026-11-11', 'crit-sum')), 2, '기존 일 집계에는 촉진 실행이 들어가지 않음(정시 2회)');

-- 계획 점검 창 안의 촉진 실행은 계획 점검으로 센다
insert into auth.users (id, email, aud, role) values ('55555555-5555-4555-8555-555555555555', 'pgtap-crit-admin@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values ('55555555-5555-4555-8555-555555555555', '팀장', 'admin');
insert into public.web_maintenance_windows (target_key, starts_at, ends_at, reason, created_by)
  values ('crit-win', '2026-11-11 05:00:00+00', '2026-11-11 06:00:00+00', '시험', '55555555-5555-4555-8555-555555555555');
insert into public.web_check_runs (target_key, "trigger", status, started_at, finished_at, critical_slot_at, overall_verdict) values
  ('crit-win', 'critical', 'succeeded', '2026-11-11 05:17:30+00', '2026-11-11 05:17:40+00', '2026-11-11 05:17:00+00', 'FAIL');
select is((select planned_count from public.web_summarize_critical('2026-11-11', 'crit-win')), 1, '계획 점검 창 안의 촉진 실패는 계획 점검으로 셈');

-- ---------------------------------------------------------------- tick: 꺼져 있으면 아무것도 하지 않음
update public.web_settings set value = 'false'::jsonb where key = 'web_critical_enabled';
select is(public.web_critical_tick(), null::bigint, '꺼져 있으면 tick은 아무것도 하지 않고 null');

select * from finish();
rollback;

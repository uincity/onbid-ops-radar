-- pgTAP 테스트 20: 홈페이지 일별 요약·집계 함수·보존 삭제 (W19)
-- Design Ref: docs/design-homepage-monitoring.md §5.8·§5.9. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- 시험 대상 키는 pgtap-ret·pgtap-ret2 (실제 대상 onbid-home과 겹치지 않는다).

begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- 연결된 DB에 실행 중인 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 정리해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = coalesce(finished_at, now()) where status = 'running';

-- ---------------------------------------------------------------- 시험 도구
-- 점검 1건: 정시 칸 시각 p_slot, 종류·상태·판정을 직접 넣는다. 응답 시간(L2)과 점검 문구 감지는 층별 판정 줄로 만든다
create function pg_temp.mk(p_target text, p_slot timestamptz, p_overall text, p_confirmed text, p_planned boolean default false, p_flap boolean default false,
                           p_l2_ms integer default null, p_maint boolean default false, p_trigger text default 'scheduled', p_status text default 'succeeded')
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.web_check_runs (target_key, "trigger", slot_at, status, started_at, finished_at, overall_verdict, confirmed_verdict, planned_maintenance, flap)
  values (p_target, p_trigger, case when p_trigger = 'scheduled' then p_slot end, p_status, p_slot + interval '7 minutes', p_slot + interval '8 minutes',
          case when p_status in ('succeeded', 'partial') then p_overall end, p_confirmed, p_planned, p_flap)
  returning id into v_id;
  if p_l2_ms is not null then
    insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason, duration_ms)
    values (v_id, p_target, 'L2_HTTP', true, case when p_maint then 'FAIL' else coalesce(p_overall, 'PASS_DATA') end,
            case when p_maint then 'MAINTENANCE_DETECTED' when p_overall = 'FAIL' then 'HTTP_5XX' end, p_l2_ms);
  end if;
  return v_id;
end;
$$;

create function pg_temp.kst_day(p_offset integer) returns date language sql as $$ select ((now() at time zone 'Asia/Seoul')::date + p_offset) $$;
create function pg_temp.slot(p_day date, p_hour integer) returns timestamptz language sql as $$ select (p_day::timestamp at time zone 'Asia/Seoul') + make_interval(hours => p_hour) $$;

-- ---------------------------------------------------------------- 권한·구조
select ok(not has_function_privilege('anon', 'public.web_summarize_day(date, text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_summarize_day(date, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_summarize_day(date, text)', 'EXECUTE'), 'web_summarize_day: 서버 관리용 키만 실행 (로그인 사용자 불가)');
select ok(not has_function_privilege('anon', 'public.web_retention_cleanup()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_retention_cleanup()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_retention_cleanup()', 'EXECUTE'), 'web_retention_cleanup: 서버 관리용 키만 실행 (로그인 사용자 불가)');
select ok((select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
            where p.oid in ('public.web_summarize_day(date, text)'::regprocedure, 'public.web_retention_cleanup()'::regprocedure)), '두 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음');
select ok((select relrowsecurity from pg_class where oid = 'public.web_daily_summary'::regclass), 'web_daily_summary: RLS 켜짐');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'web_daily_summary' and cmd <> 'SELECT'), 0, 'web_daily_summary: 쓰기 정책 없음');
select ok(not has_table_privilege('authenticated', 'public.web_daily_summary', 'INSERT') and not has_table_privilege('authenticated', 'public.web_daily_summary', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.web_daily_summary', 'DELETE') and has_table_privilege('authenticated', 'public.web_daily_summary', 'SELECT')
      and not has_table_privilege('anon', 'public.web_daily_summary', 'SELECT'), 'web_daily_summary: 로그인 사용자는 읽기만, 비로그인은 불가');

-- ---------------------------------------------------------------- 집계: 하루(KST)의 정시 점검 확정 판정
create temp table d1 as select pg_temp.kst_day(-5) as d;
create temp table setup1 as select
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 0), 'PASS_DATA', 'PASS_DATA', p_l2_ms => 1000) as h00,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 1), 'PASS_DATA', 'PASS_DATA', p_l2_ms => 3000) as h01,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 2), 'FAIL', 'PASS_DATA', p_flap => true) as h02,       -- 일시 실패: 확정 판정은 정상
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 3), 'FAIL', 'FAIL', p_l2_ms => 100) as h03,           -- 확정 실패
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 4), 'FAIL', 'FAIL', p_planned => true) as h04,        -- 계획 점검 창 안
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 5), 'FAIL', 'FAIL', p_l2_ms => 900, p_maint => true) as h05, -- 미등록 점검(점검 문구, 창 밖)
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 6), 'DEGRADED', 'DEGRADED') as h06,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 7), 'UNVERIFIED', 'UNVERIFIED') as h07,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 8), 'NOT_RUN', 'NOT_RUN') as h08,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 9), 'PASS_NO_DATA', 'PASS_NO_DATA') as h09,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 10), 'PASS_DATA', null, p_trigger => 'manual', p_l2_ms => 99999) as h10,      -- 수동: 세지 않음
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 11), 'FAIL', null, p_trigger => 'retry', p_l2_ms => 99999) as h11,           -- 재확인: 세지 않음
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 12), 'PASS_DATA', 'PASS_DATA', p_status => 'failed', p_l2_ms => 99999) as h12, -- 실패한 실행: 세지 않음
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1), 14), 'PASS_DATA', null) as h14,                        -- 재확인 대기 중: 대표 판정으로 센다
  pg_temp.mk('pgtap-ret2', pg_temp.slot((select d from d1), 0), 'FAIL', 'FAIL', p_l2_ms => 200) as o00;           -- 다른 대상

create temp table s1 as select * from public.web_summarize_day((select d from d1), 'pgtap-ret');
select is((select count(*)::int from s1), 1, '대상을 지정하면 그 대상 1줄만 나온다');
select is((select pass_data from s1), 4, '정상: 확정 판정 기준(일시 실패 확정 정상 포함, 재확인 대기는 대표 판정) = 4');
select is((select pass_no_data from s1), 1, '정상(데이터 없음) = 1');
select is((select degraded from s1), 1, '성능 저하 = 1');
select is((select fail from s1), 3, '실패 = 3 (확정 실패 + 계획 점검 + 미등록 점검 칸)');
select is((select unverified from s1), 1, '확인 불가 = 1');
select is((select not_run from s1), 1, '미점검 = 1');
select is((select planned_count from s1), 1, '계획 점검 = 1');
select is((select unplanned_count from s1), 1, '미등록 점검 = 1 (점검 문구 감지, 창 밖)');
select is((select flap_count from s1), 1, '일시 실패 = 1');
select is((select confirmed_down_count from s1), 1, '확정 실패(계획·미등록 제외) = 1');
select is((select down_seconds from s1), 3600, '확정 실패 시간 = 1칸 × 3600초');
select is((select avg_ms from s1), 1250, '평균 응답 시간 = (1000+3000+100+900)/4, 수동·재확인·실패 실행은 제외');
select is((select max_ms from s1), 3000, '최대 응답 시간 = 3000');
-- 가용률 식의 분모가 맞아떨어진다: 판정 합 - 검증불가 - 미점검 - 계획 - 미등록 = 정상 계열 + 저하 + 확정 실패
select is((select pass_data + pass_no_data + degraded + fail + unverified + not_run from s1), 11, '판정 합계 = 정시 점검 칸 수(수동·재확인·실패·차단 제외) 11');
select is((select pass_data + pass_no_data + degraded + fail + unverified + not_run - unverified - not_run - planned_count - unplanned_count from s1), 7, '가용률 분모 = 11 - 검증불가 1 - 미점검 1 - 계획 1 - 미등록 1 = 7 (정상 4 + 무데이터 1 + 저하 1 + 확정 실패 1)');

-- 대상을 안 주면 모든 대상, 다른 날은 비어 있다
select is((select count(*)::int from public.web_summarize_day((select d from d1)) where target_key in ('pgtap-ret', 'pgtap-ret2')), 2, '대상을 안 주면 모든 대상이 나온다');
select is((select count(*)::int from public.web_summarize_day((select d from d1) + 1, 'pgtap-ret')), 0, '기록도 요약도 없는 날은 빈 결과');

-- KST 하루 경계: 전날 23:59:59와 다음 날 00:00:00
create temp table edge as select
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1) + 1, 0) - interval '1 second', 'PASS_DATA', 'PASS_DATA') as before_mid,
  pg_temp.mk('pgtap-ret', pg_temp.slot((select d from d1) + 1, 0), 'FAIL', 'FAIL') as at_mid;
select is((select pass_data from public.web_summarize_day((select d from d1), 'pgtap-ret')), 5, '자정 1초 전은 그 날에 들어간다 (정상 4 + 1)');
select is((select fail from public.web_summarize_day((select d from d1) + 1, 'pgtap-ret')), 1, '자정 정각은 다음 날에 들어간다');

-- ---------------------------------------------------------------- 저장된 요약은 원본이 없을 때 돌려준다
insert into public.web_daily_summary (summary_date, target_key, pass_data, fail, confirmed_down_count, down_seconds, avg_ms, max_ms)
values (pg_temp.kst_day(-300), 'pgtap-ret', 20, 3, 3, 10800, 1500, 4000);
select is((select pass_data from public.web_summarize_day(pg_temp.kst_day(-300), 'pgtap-ret')), 20, '원본이 삭제된 날은 저장된 요약에서 읽는다');
select is((select down_seconds from public.web_summarize_day(pg_temp.kst_day(-300), 'pgtap-ret')), 10800, '저장된 요약의 확정 실패 시간도 그대로');

-- ---------------------------------------------------------------- 보존 삭제: 오늘(KST) - 90일보다 이른 "날" 전체
create temp table old1 as select
  pg_temp.mk('pgtap-ret', pg_temp.slot(pg_temp.kst_day(-91), 23) + interval '59 minutes 59 seconds', 'PASS_DATA', 'PASS_DATA', p_l2_ms => 1000) as a_late,   -- 91일 전 23:59:59 → 삭제
  pg_temp.mk('pgtap-ret', pg_temp.slot(pg_temp.kst_day(-91), 1), 'FAIL', 'FAIL', p_l2_ms => 500) as a_fail,                                                   -- 91일 전 → 삭제
  pg_temp.mk('pgtap-ret', pg_temp.slot(pg_temp.kst_day(-90), 0), 'PASS_DATA', 'PASS_DATA', p_l2_ms => 800) as b_keep;                                          -- 90일 전 00:00 정각 → 보존
create temp table child as
  with ins as (
    insert into public.web_check_runs (target_key, "trigger", status, started_at, finished_at, overall_verdict, origin_run_id)
    values ('pgtap-ret', 'retry', 'succeeded', pg_temp.slot(pg_temp.kst_day(-90), 5), pg_temp.slot(pg_temp.kst_day(-90), 5) + interval '1 minute', 'PASS_DATA', (select a_fail from old1))
    returning id)
  select id from ins;
insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at, status, created_at, processed_at)
values ('pgtap-ret', 'confirm', (select a_fail from old1), pg_temp.slot(pg_temp.kst_day(-91), 1) + interval '2 minutes', 'done', pg_temp.slot(pg_temp.kst_day(-91), 1), pg_temp.slot(pg_temp.kst_day(-91), 1) + interval '3 minutes');

-- 삭제하면 안 되는 추가 전용 기록 (알림 키)
insert into public.web_notification_keys (key, kind, target_key, created_at) values ('down:77', 'down', 'pgtap-ret', now() - interval '200 days');
create temp table before_keys as select count(*)::int as n from public.web_notification_keys;

create temp table cl as select public.web_retention_cleanup() as r;
select is((select r ->> 'cutoff_date' from cl), pg_temp.kst_day(-90)::text, '보존 기준일 = 오늘(KST) - 90일');
select ok((select (r ->> 'days_summarized')::int >= 1 from cl), '삭제 대상 날짜를 요약했다');
select is((select count(*)::int from public.web_check_runs where target_key = 'pgtap-ret' and slot_at < pg_temp.slot(pg_temp.kst_day(-90), 0)), 0, '90일을 넘긴 날의 정시 점검은 삭제된다 (23:59:59 포함)');
select is((select count(*)::int from public.web_check_runs where id = (select b_keep from old1)), 1, '보존 기준일 00:00 정각 점검은 남는다 (하루가 반쯤 잘리지 않는다)');
select is((select count(*)::int from public.web_probe_results where run_id in (select a_late from old1 union select a_fail from old1)), 0, '삭제된 점검의 층별 판정 줄도 함께 삭제된다');
select is((select count(*)::int from public.web_probe_results where run_id = (select b_keep from old1)), 1, '남은 점검의 판정 줄은 그대로');
select ok((select origin_run_id is null from public.web_check_runs where id = (select id from child)), '재확인 줄의 origin_run_id는 비워진다 (on delete set null)');
select is((select count(*)::int from public.web_retry_queue where target_key = 'pgtap-ret'), 0, '끝난 재확인 대기 줄도 삭제된다');
select is((select pass_data from public.web_daily_summary where summary_date = pg_temp.kst_day(-91) and target_key = 'pgtap-ret'), 1, '삭제 전에 저장된 요약: 91일 전 정상 1');
select is((select fail from public.web_daily_summary where summary_date = pg_temp.kst_day(-91) and target_key = 'pgtap-ret'), 1, '삭제 전에 저장된 요약: 91일 전 실패 1');
select is((select count(*)::int from public.web_daily_summary where summary_date = pg_temp.kst_day(-90) and target_key = 'pgtap-ret'), 0, '보존 중인 날은 요약을 저장하지 않는다');
select is((select pass_data from public.web_summarize_day(pg_temp.kst_day(-91), 'pgtap-ret')), 1, '삭제된 날도 같은 집계 함수가 저장된 요약을 돌려준다');
select is((select count(*)::int from public.web_notification_keys), (select n from before_keys), '추가 전용 기록(알림 키)은 삭제하지 않는다');
select is((select count(*)::int from cron.job_run_details where end_time < now() - interval '14 days'), 0, 'cron 실행 기록은 14일 넘은 줄이 남지 않는다');

-- 다시 돌려도 안전하다 (멱등)
create temp table cl2 as select public.web_retention_cleanup() as r;
select is((select (r ->> 'runs_deleted')::int from cl2), 0, '두 번째 실행은 더 지울 것이 없다');
select is((select count(*)::int from public.web_daily_summary where target_key = 'pgtap-ret' and summary_date = pg_temp.kst_day(-91)), 1, '요약은 중복으로 쌓이지 않는다');

select * from finish();
rollback;

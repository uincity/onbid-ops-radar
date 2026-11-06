-- W19: 홈페이지 점검 일별 요약(web_daily_summary)·집계 함수(web_summarize_day)·보존 삭제(web_retention_cleanup)
-- Design Ref: docs/design-homepage-monitoring.md §5.8(집계)·§5.9(보존 삭제)·§6.1·§6.3, docs/plan-homepage-monitoring.md W19
--
-- 한 줄 설명
--   web_daily_summary     : KST 하루의 점검 집계(대상별). 보존 기간이 지나 원본이 삭제된 날을 보고서가 계속 읽을 수 있게 남긴다
--   web_summarize_day     : 하루의 집계를 계산하는 **함수 하나**. 보고서와 보존 삭제가 같은 함수를 써서 계산이 어긋나지 않는다.
--                           그 날의 점검 기록이 있으면 기록에서 계산하고, 이미 삭제됐으면 저장된 요약을 돌려준다
--   web_retention_cleanup : 하루 1회. 보존 기간(web_result_retention_days)이 지난 날을 KST 하루 단위로 요약해 저장한 뒤,
--                           그 날의 점검 실행(판정 줄은 함께 삭제)·끝난 재확인 대기 줄을 삭제한다. cron.job_run_details의 14일 넘은 줄도 정리한다.
--                           추가 전용 테이블(알림 키·알림 시도)과 이상징후 이력은 지우지 않는다
--
-- 집계 규칙 (정시 점검만 센다: trigger='scheduled', status succeeded·partial. 수동·재확인·차단·실패 실행은 세지 않는다)
--   하루 = 정시 칸(slot_at)의 KST 날짜.  판정 = coalesce(confirmed_verdict, overall_verdict) — 재확인 반영 뒤의 확정 판정
--   pass_data … not_run : 판정별 횟수(계획 점검·미등록 점검 칸도 포함)
--   planned_count       : 계획 점검 창 안의 점검 중 판정이 정상·저하·실패인 칸 수(검증 불가·미점검은 이미 빠지므로 겹쳐 세지 않는다)
--   unplanned_count     : 점검 문구가 감지됐는데 창 밖인 칸(판정 FAIL) 중 계획 점검이 아닌 칸 수
--   flap_count          : 일시 실패(한 번 실패했다가 재확인에서 정상)로 표시된 칸 수
--   confirmed_down_count: 확정 실패(FAIL)이면서 계획·미등록 점검이 아닌 칸 수
--   down_seconds        : confirmed_down_count × 3600초 (정시 간격 1시간 단위의 근사. 실제 장애 길이의 정밀한 값이 아니다)
--   avg_ms·max_ms       : 정시 점검의 L2 HTTP 응답 시간(밀리초, 값이 있는 것만)
--   가용률(앱이 계산) = 정상 계열 ÷ (판정 횟수 − 검증 불가 − 미점검 − 계획 점검 − 미등록 점검). 저하는 정상 계열이 아니다.
-- 쓰기는 이 파일의 함수로만 한다(표에는 쓰기 정책 없음). 읽기는 로그인 사용자.

-- ===========================================================================
-- A. web_daily_summary
-- ===========================================================================
create table public.web_daily_summary (
  summary_date         date        not null,
  target_key           text        not null,
  pass_data            integer     not null default 0,
  pass_no_data         integer     not null default 0,
  degraded             integer     not null default 0,
  fail                 integer     not null default 0,
  unverified           integer     not null default 0,
  not_run              integer     not null default 0,
  planned_count        integer     not null default 0,
  unplanned_count      integer     not null default 0,
  flap_count           integer     not null default 0,
  confirmed_down_count integer     not null default 0,
  down_seconds         integer     not null default 0,
  avg_ms               integer,
  max_ms               integer,
  created_at           timestamptz not null default now(),

  primary key (summary_date, target_key),
  constraint web_daily_summary_target_check check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_daily_summary_counts_check check (
    least(pass_data, pass_no_data, degraded, fail, unverified, not_run, planned_count, unplanned_count, flap_count, confirmed_down_count, down_seconds) >= 0
    and (avg_ms is null or avg_ms >= 0) and (max_ms is null or max_ms >= 0)
  )
);

comment on table public.web_daily_summary is
  '홈페이지 점검 일별 요약(KST 하루, 대상별). 보존 기간이 지나 원본이 삭제된 날의 보고서용. 쓰기는 web_retention_cleanup()으로만.';

alter table public.web_daily_summary enable row level security;
revoke all on public.web_daily_summary from anon, authenticated;
grant select on public.web_daily_summary to authenticated;
create policy "로그인 사용자는 web_daily_summary를 읽을 수 있다"
  on public.web_daily_summary for select to authenticated using (true);

-- ===========================================================================
-- B. web_summarize_day : 하루 집계 (보고서와 보존 삭제가 같이 쓴다)
-- ===========================================================================
create or replace function public.web_summarize_day(p_date date, p_target text default null)
returns table (
  summary_date date, target_key text,
  pass_data integer, pass_no_data integer, degraded integer, fail integer, unverified integer, not_run integer,
  planned_count integer, unplanned_count integer, flap_count integer, confirmed_down_count integer,
  down_seconds integer, avg_ms integer, max_ms integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := (p_date::timestamp at time zone 'Asia/Seoul');
  v_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Seoul');
begin
  if p_date is null then
    raise exception '집계할 날짜가 필요합니다' using errcode = '22023';
  end if;

  return query
  with day_runs as (
    select r.id, r.target_key as tk, coalesce(r.confirmed_verdict, r.overall_verdict) as v, r.planned_maintenance as planned, r.flap
      from public.web_check_runs r
     where r."trigger" = 'scheduled' and r.status in ('succeeded', 'partial')
       and r.slot_at >= v_start and r.slot_at < v_end
       and (p_target is null or r.target_key = p_target)
  ), flagged as (
    select d.*,
           (not d.planned and d.v = 'FAIL' and exists (
              select 1 from public.web_probe_results p where p.run_id = d.id and p.counts_toward_overall and p.reason = 'MAINTENANCE_DETECTED')) as unplanned
      from day_runs d
  ), resp as (
    select f.tk, avg(p.duration_ms)::integer as avg_ms, max(p.duration_ms)::integer as max_ms
      from flagged f join public.web_probe_results p on p.run_id = f.id and p.layer = 'L2_HTTP' and p.duration_ms is not null
     group by f.tk
  ), agg as (
    select f.tk,
           count(*) filter (where f.v = 'PASS_DATA')::integer as pass_data,
           count(*) filter (where f.v = 'PASS_NO_DATA')::integer as pass_no_data,
           count(*) filter (where f.v = 'DEGRADED')::integer as degraded,
           count(*) filter (where f.v = 'FAIL')::integer as fail,
           count(*) filter (where f.v = 'UNVERIFIED')::integer as unverified,
           count(*) filter (where f.v = 'NOT_RUN')::integer as not_run,
           count(*) filter (where f.planned and f.v in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL'))::integer as planned_count,
           count(*) filter (where f.unplanned)::integer as unplanned_count,
           count(*) filter (where f.flap)::integer as flap_count,
           count(*) filter (where f.v = 'FAIL' and not f.planned and not f.unplanned)::integer as confirmed_down_count
      from flagged f group by f.tk
  )
  select p_date, a.tk, a.pass_data, a.pass_no_data, a.degraded, a.fail, a.unverified, a.not_run, a.planned_count, a.unplanned_count, a.flap_count,
         a.confirmed_down_count, a.confirmed_down_count * 3600, rs.avg_ms, rs.max_ms
    from agg a left join resp rs on rs.tk = a.tk
   order by a.tk;

  -- 그 날의 점검 기록이 없으면(이미 보존 기간이 지나 삭제됐으면) 저장된 요약을 돌려준다
  if not found then
    return query
    select s.summary_date, s.target_key, s.pass_data, s.pass_no_data, s.degraded, s.fail, s.unverified, s.not_run, s.planned_count, s.unplanned_count, s.flap_count,
           s.confirmed_down_count, s.down_seconds, s.avg_ms, s.max_ms
      from public.web_daily_summary s
     where s.summary_date = p_date and (p_target is null or s.target_key = p_target)
     order by s.target_key;
  end if;
end;
$$;

comment on function public.web_summarize_day(date, text) is
  '하루(KST)의 홈페이지 점검 집계. 정시 점검의 확정 판정만 센다. 기록이 없으면 저장된 일별 요약을 돌려준다. 보고서와 보존 삭제가 같은 함수를 쓴다. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- C. web_retention_cleanup : 하루 1회 보존 삭제
--   보존 기준: 오늘(KST) - web_result_retention_days 보다 이른 "날" 전체. 날짜가 반쯤 잘리지 않는다.
--   출력(jsonb): { cutoff_date, days_summarized, runs_deleted, queue_deleted, cron_deleted }
-- ===========================================================================
create or replace function public.web_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days     integer;
  v_cutoff   date;
  v_start    timestamptz;
  v_day      date;
  v_summ     integer := 0;
  v_runs     integer := 0;
  v_queue    integer := 0;
  v_cron     integer := 0;
begin
  -- 같은 정리가 겹쳐 돌지 않게 한다
  if not pg_try_advisory_xact_lock(hashtextextended('web_retention', 0)) then
    return jsonb_build_object('action', 'busy');
  end if;

  select coalesce((s.value #>> '{}')::integer, 90) into v_days from public.web_settings s where s.key = 'web_result_retention_days';
  v_days := coalesce(v_days, 90);
  v_cutoff := ((now() at time zone 'Asia/Seoul')::date - v_days);
  v_start := (v_cutoff::timestamp at time zone 'Asia/Seoul'); -- 이 시각보다 이른 점검이 삭제 대상 (KST 하루 경계)

  -- ① 삭제할 날들을 같은 집계 함수로 요약해 저장한다 (삭제 전, 같은 트랜잭션)
  for v_day in
    select distinct (coalesce(r.slot_at, r.started_at) at time zone 'Asia/Seoul')::date
      from public.web_check_runs r
     where coalesce(r.slot_at, r.started_at) < v_start and r.status <> 'running'
     order by 1
  loop
    insert into public.web_daily_summary (summary_date, target_key, pass_data, pass_no_data, degraded, fail, unverified, not_run, planned_count, unplanned_count, flap_count, confirmed_down_count, down_seconds, avg_ms, max_ms)
    select s.summary_date, s.target_key, s.pass_data, s.pass_no_data, s.degraded, s.fail, s.unverified, s.not_run, s.planned_count, s.unplanned_count, s.flap_count, s.confirmed_down_count, s.down_seconds, s.avg_ms, s.max_ms
      from public.web_summarize_day(v_day) s
    on conflict (summary_date, target_key) do nothing;
    v_summ := v_summ + 1;
  end loop;

  -- ② 끝난 재확인 대기 줄 (원래 실행을 가리키는 줄이 삭제 대상에서 걸리지 않게 먼저 지운다)
  delete from public.web_retry_queue q where q.status in ('done', 'cancelled') and q.created_at < v_start;
  get diagnostics v_queue = row_count;

  -- ③ 점검 실행 삭제 (층별 판정 줄은 함께 삭제, 재확인 줄의 origin_run_id는 비워진다, 상태 줄의 시작 실행 번호도 비워진다)
  delete from public.web_check_runs r where coalesce(r.slot_at, r.started_at) < v_start and r.status <> 'running';
  get diagnostics v_runs = row_count;

  -- ④ Cron 실행 기록 정리 (14일 초과). 권한이 없으면 건너뛴다
  begin
    delete from cron.job_run_details d where d.end_time < now() - interval '14 days';
    get diagnostics v_cron = row_count;
  exception when others then
    v_cron := -1;
  end;

  return jsonb_build_object('cutoff_date', v_cutoff, 'days_summarized', v_summ, 'runs_deleted', v_runs, 'queue_deleted', v_queue, 'cron_deleted', v_cron);
end;
$$;

comment on function public.web_retention_cleanup() is
  '하루 1회 보존 삭제. 보존 기간이 지난 날을 KST 하루 단위로 요약해 web_daily_summary에 저장한 뒤 그 날의 점검 실행·판정·끝난 재확인 줄을 삭제하고 cron.job_run_details 오래된 줄을 정리한다. 추가 전용 테이블은 건드리지 않는다. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- 실행 권한: 모두 닫고 서버 관리용 키(크론 포함)에게만 연다
-- ===========================================================================
revoke all on function public.web_summarize_day(date, text) from public, anon, authenticated;
revoke all on function public.web_retention_cleanup() from public, anon, authenticated;
grant execute on function public.web_summarize_day(date, text) to service_role;
grant execute on function public.web_retention_cleanup() to service_role;

-- 홈페이지 가용성 모니터링 W26: 핵심 시간대 촉진 점검
-- Design Ref: docs/design-homepage-monitoring.md §5.10(v0.3) / Plan W26
--
-- 하는 일:
--   A. web_settings에 새 항목 4개(web_critical_enabled·hours·interval_min·ongoing_min)와 값 규칙을 더한다. 기본은 꺼짐(false)이라 이 파일만으로는 아무 점검도 늘지 않는다
--   B. web_check_runs에 새 실행 종류 critical과 칸 시각 critical_slot_at(같은 칸 중복 방지)을 더한다. 정시 칸 규칙(slot_at)은 바꾸지 않는다
--   C. start_web_check_run 교체: critical을 받는다. critical이 막히면 칸을 건너뛴다(대체 실행 예약 없음)
--   D. enqueue_web_confirm 교체: 확인 재시도의 원래 실행으로 critical도 허용한다
--   E. web_critical_tick(): pg_cron이 5분마다 부른다. 켜져 있고 핵심 시간대의 촉진 칸일 때만 앱(/api/cron/web-check-critical)을 pg_net으로 부른다
--   F. web_summarize_critical(날짜, 대상): 핵심 시간대 가용률(정시+촉진 실행) 집계. 기존 web_summarize_day는 바꾸지 않는다(촉진 실행은 거기에 들어가지 않는다)
-- 바꾸지 않는 것: record_web_transition(원래 실행의 확정 판정은 정시 실행만 채움 → 촉진 실행의 확정은 F가 재확인 실행으로 계산), 자체 감시 기준, web_summarize_day, 보존 삭제.

-- ===========================================================================
-- A. web_settings: 새 항목 4개
-- ===========================================================================
alter table public.web_settings drop constraint web_settings_key_check;
alter table public.web_settings add constraint web_settings_key_check
  check (key in (
    'web_http_timeout_ms', 'web_http_slow_ms', 'web_confirm_retry_delay_sec', 'web_realert_after_hours',
    'web_degraded_alert_count', 'web_unverifiable_alert_count', 'web_aux_alert_count', 'web_cert_warn_days',
    'web_heartbeat_stale_min', 'web_heartbeat_realert_hours', 'web_freshness_max_hours', 'web_result_retention_days',
    'web_alert_daily_cap', 'web_run_time_limit_seconds', 'web_stale_running_seconds', 'web_request_gap_ms',
    'web_notify_timeout_ms', 'web_window_max_hours', 'web_unplanned_escalate_hours', 'web_monitor_enabled',
    'web_critical_enabled', 'web_critical_hours', 'web_critical_interval_min', 'web_critical_ongoing_min'
  ));

-- 값 규칙 함수 교체(기존 20개 규칙은 그대로, 새 4개만 더한다). 시작<끝·겹침 같은 얽힌 규칙은 코드(Zod)가 확인한다
create or replace function public.web_settings_value_is_valid(p_key text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case p_key
      when 'web_http_timeout_ms' then public.settings_int_between(p_value, 1000, 30000)
      when 'web_http_slow_ms' then public.settings_int_between(p_value, 500, 29999)
      when 'web_confirm_retry_delay_sec' then public.settings_int_between(p_value, 30, 600)
      when 'web_realert_after_hours' then public.settings_int_between(p_value, 1, 24)
      when 'web_degraded_alert_count' then public.settings_int_between(p_value, 1, 10)
      when 'web_unverifiable_alert_count' then public.settings_int_between(p_value, 1, 10)
      when 'web_aux_alert_count' then public.settings_int_between(p_value, 1, 10)
      when 'web_cert_warn_days' then public.settings_int_between(p_value, 1, 60)
      when 'web_heartbeat_stale_min' then public.settings_int_between(p_value, 90, 1440)
      when 'web_heartbeat_realert_hours' then public.settings_int_between(p_value, 1, 168)
      when 'web_freshness_max_hours' then public.settings_int_between(p_value, 1, 168)
      when 'web_result_retention_days' then public.settings_int_between(p_value, 7, 365)
      when 'web_alert_daily_cap' then public.settings_int_between(p_value, 1, 100)
      when 'web_run_time_limit_seconds' then public.settings_int_between(p_value, 10, 85)
      when 'web_stale_running_seconds' then public.settings_int_between(p_value, 60, 600)
      when 'web_request_gap_ms' then public.settings_int_between(p_value, 0, 5000)
      when 'web_notify_timeout_ms' then public.settings_int_between(p_value, 1000, 30000)
      when 'web_window_max_hours' then public.settings_int_between(p_value, 1, 720)
      when 'web_unplanned_escalate_hours' then public.settings_int_between(p_value, 1, 48)
      when 'web_monitor_enabled' then jsonb_typeof(p_value) = 'boolean'
      -- 핵심 시간대 촉진 점검(W26): 켜기/끄기, 구간 목록("09-11,14-18", KST 시 단위, 끝 미포함), 간격(분, 60의 약수), 핵심 시간대 지속 알림 간격(분)
      when 'web_critical_enabled' then jsonb_typeof(p_value) = 'boolean'
      when 'web_critical_hours' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9]{1,2}-[0-9]{1,2}(,[0-9]{1,2}-[0-9]{1,2})*$'
      when 'web_critical_interval_min' then jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') in ('5', '10', '15', '20', '30')
      when 'web_critical_ongoing_min' then public.settings_int_between(p_value, 10, 180)
      else false
    end,
    false
  );
$$;

-- 새 항목의 기본값. 촉진 점검은 꺼진 채로 들어간다(켜기는 배포 확인 뒤 별도 단계)
insert into public.web_settings (key, value) values
  ('web_critical_enabled',      'false'::jsonb),
  ('web_critical_hours',        '"09-11,14-18"'::jsonb),
  ('web_critical_interval_min', '10'::jsonb),
  ('web_critical_ongoing_min',  '60'::jsonb);

-- ===========================================================================
-- B. web_check_runs: 새 실행 종류 critical
-- ===========================================================================
alter table public.web_check_runs drop constraint web_check_runs_trigger_check;
alter table public.web_check_runs add constraint web_check_runs_trigger_check
  check ("trigger" in ('scheduled', 'retry', 'manual', 'critical'));

alter table public.web_check_runs add column critical_slot_at timestamptz;
comment on column public.web_check_runs.critical_slot_at is
  '촉진 점검(critical)의 칸 시각(분 단위로 자른 시각). critical 실행만 가진다. 차단되지 않은 같은 (대상, 칸)의 촉진 실행은 하나만 인정된다. slot_at(정시 칸)은 비워 둔다.';
alter table public.web_check_runs add constraint web_check_runs_critical_slot_check
  check (("trigger" = 'critical') = (critical_slot_at is not null));

create unique index web_check_runs_critical_slot_once
  on public.web_check_runs (target_key, critical_slot_at)
  where "trigger" = 'critical' and status <> 'blocked';

-- ===========================================================================
-- C. start_web_check_run 교체 (critical 허용)
-- ===========================================================================
-- 시그니처는 그대로(p_slot_at). critical이면 p_slot_at을 critical_slot_at에 넣고 slot_at은 비운다.
create or replace function public.start_web_check_run(
  p_target       text,
  p_trigger      text,
  p_triggered_by uuid default null,
  p_origin_run_id bigint default null,
  p_slot_at      timestamptz default null
)
returns table (out_run_id bigint, out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale      integer;
  v_id         bigint;
  v_constraint text;
  v_slot       timestamptz := case when p_trigger = 'critical' then null else p_slot_at end;
  v_cslot      timestamptz := case when p_trigger = 'critical' then p_slot_at else null end;
begin
  select (s.value #>> '{}')::integer into v_stale
    from public.web_settings s
   where s.key = 'web_stale_running_seconds';
  if v_stale is null then
    raise exception 'web_stale_running_seconds 설정값이 없습니다' using errcode = 'P0001';
  end if;

  -- 1) 멈춘 실행 마감
  update public.web_check_runs
     set status = 'failed', finished_at = now()
   where status = 'running'
     and started_at < now() - make_interval(secs => v_stale);

  -- 2) 새 실행 시작
  begin
    insert into public.web_check_runs (target_key, "trigger", triggered_by, origin_run_id, slot_at, critical_slot_at)
    values (p_target, p_trigger, p_triggered_by, p_origin_run_id, v_slot, v_cslot)
    returning id into v_id;

    return query select v_id, 'running'::text;
    return;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
  end;

  -- 3) 차단 기록
  insert into public.web_check_runs (target_key, "trigger", status, finished_at, triggered_by, origin_run_id, slot_at, critical_slot_at)
  values (p_target, p_trigger, 'blocked', now(), p_triggered_by, p_origin_run_id, v_slot, v_cslot)
  returning id into v_id;

  -- 정시 점검이 다른 실행 때문에 막혔으면 같은 칸을 대신 실행하도록 1분 뒤로 예약한다. 촉진 점검은 건너뛴다(보조이고 다음 칸이 곧 온다)
  if p_trigger = 'scheduled' and v_constraint = 'web_check_runs_only_one_running' then
    insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at)
    values (p_target, 'replace', v_id, now() + interval '1 minute')
    on conflict do nothing;
  end if;

  return query select v_id, 'blocked'::text;
end;
$$;

-- ===========================================================================
-- D. enqueue_web_confirm 교체 (원래 실행으로 critical 허용)
-- ===========================================================================
create or replace function public.enqueue_web_confirm(
  p_target        text,
  p_origin_run_id bigint,
  p_delay_sec     integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_id  bigint;
begin
  if p_delay_sec is null or p_delay_sec < 0 or p_delay_sec > 3600 then
    raise exception '대기 시간은 0~3600초여야 합니다' using errcode = '22023';
  end if;

  select r.target_key, r."trigger", r.status into v_run from public.web_check_runs r where r.id = p_origin_run_id;
  if not found or v_run.target_key is distinct from p_target then
    raise exception '원래 점검 실행을 찾을 수 없거나 대상이 다릅니다' using errcode = 'P0002';
  end if;
  -- 확인 재시도는 정상 종료된 정시·촉진 실행에만 붙는다
  if v_run."trigger" not in ('scheduled', 'critical') or v_run.status not in ('succeeded', 'partial') then
    raise exception '정상 종료된 정시·촉진 실행만 확인 재시도를 예약할 수 있습니다' using errcode = 'integrity_constraint_violation';
  end if;

  insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at)
  values (p_target, 'confirm', p_origin_run_id, now() + make_interval(secs => p_delay_sec))
  on conflict (target_key) where status in ('pending', 'claimed') do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ===========================================================================
-- E. web_critical_tick : 5분마다 pg_cron이 부른다
-- ===========================================================================
-- 켜져 있고(web_monitor_enabled·web_critical_enabled) 지금(KST)이 평일의 핵심 시간대이며 촉진 칸일 때만 앱을 부른다. 아니면 아무것도 하지 않는다(null).
-- 촉진 칸: (분 − 7) mod 간격 = 0 이고 분 ≠ 7 (:07은 정시 점검이 이미 한다). 간격은 매시 :07을 기준으로 맞춘다.
-- 이 규칙은 lib/web-monitor/critical.ts의 isCriticalSlot과 같아야 한다(tests/unit/web-critical.test.ts가 경계를 같이 확인).
create or replace function public.web_critical_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled  boolean;
  v_critical boolean;
  v_hours    text;
  v_interval integer;
  v_kst      timestamp := (now() at time zone 'Asia/Seoul');
  v_min      integer   := extract(minute from (now() at time zone 'Asia/Seoul'))::integer;
  v_hour     integer   := extract(hour from (now() at time zone 'Asia/Seoul'))::integer;
  v_in       boolean   := false;
  v_part     text;
  v_id       bigint;
begin
  select (s.value #>> '{}')::boolean into v_enabled from public.web_settings s where s.key = 'web_monitor_enabled';
  select (s.value #>> '{}')::boolean into v_critical from public.web_settings s where s.key = 'web_critical_enabled';
  if v_enabled is distinct from true or v_critical is distinct from true then
    return null;
  end if;

  select s.value #>> '{}' into v_hours from public.web_settings s where s.key = 'web_critical_hours';
  select (s.value #>> '{}')::integer into v_interval from public.web_settings s where s.key = 'web_critical_interval_min';
  if v_hours is null or v_interval is null then
    return null; -- 설정이 없으면 기본값으로 대신하지 않고 아무것도 하지 않는다
  end if;

  if extract(isodow from v_kst) > 5 then
    return null; -- 주말
  end if;
  if v_min = 7 or (((v_min - 7) % v_interval) + v_interval) % v_interval <> 0 then
    return null; -- 정시 칸이거나 촉진 칸이 아님
  end if;
  foreach v_part in array string_to_array(v_hours, ',') loop
    if v_hour >= split_part(v_part, '-', 1)::integer and v_hour < split_part(v_part, '-', 2)::integer then
      v_in := true;
    end if;
  end loop;
  if not v_in then
    return null;
  end if;

  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'onbid_app_url') || '/api/cron/web-check-critical',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onbid_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 85000
  ) into v_id;
  return v_id;
end;
$$;

comment on function public.web_critical_tick() is
  '5분마다 pg_cron이 부른다. 촉진 점검이 켜져 있고 지금이 평일 핵심 시간대의 촉진 칸일 때만 /api/cron/web-check-critical을 pg_net으로 호출한다(아니면 null). 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- F. web_summarize_critical : 핵심 시간대 집계 (정시 + 촉진 실행)
-- ===========================================================================
-- 기존 web_summarize_day와 같은 열(숫자 부분)을 돌려줘서 보고서가 같은 가용률 식(availabilityOf)을 쓴다.
-- 정시 실행: slot_at의 KST 시각이 핵심 시간대 안이고, 판정은 coalesce(확정, 대표)
-- 촉진 실행: critical_slot_at의 KST 시각이 핵심 시간대 안이고, 판정은 "재확인(retry) 실행이 있으면 그 판정, 없으면 대표 판정"(촉진 실행은 확정 판정 칸이 비어 있어서)
-- 계획 점검 창 안의 촉진 실행은 계획 점검으로 센다(정시 실행의 planned_maintenance 표시와 같은 뜻)
-- 주말에는 핵심 시간대가 없으므로 0줄. 보존 기간이 지난 날은 원본이 없어 0줄(핵심 시간대 요약은 따로 보존하지 않는다).
create or replace function public.web_summarize_critical(p_date date, p_target text default null)
returns table (
  summary_date date, target_key text,
  pass_data integer, pass_no_data integer, degraded integer, fail integer, unverified integer, not_run integer,
  planned_count integer, unplanned_count integer, critical_runs integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := (p_date::timestamp at time zone 'Asia/Seoul');
  v_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Seoul');
  v_hours text;
begin
  if p_date is null then
    raise exception '집계할 날짜가 필요합니다' using errcode = '22023';
  end if;
  select s.value #>> '{}' into v_hours from public.web_settings s where s.key = 'web_critical_hours';
  if v_hours is null then
    raise exception 'web_critical_hours 설정값이 없습니다' using errcode = 'P0001';
  end if;
  if extract(isodow from p_date) > 5 then
    return;
  end if;

  return query
  with hrs as (
    select split_part(x, '-', 1)::integer as h_from, split_part(x, '-', 2)::integer as h_to
      from unnest(string_to_array(v_hours, ',')) as x
  ), sched as (
    select r.id, r.target_key as tk, coalesce(r.confirmed_verdict, r.overall_verdict) as v, r.planned_maintenance as planned, false as is_critical
      from public.web_check_runs r
     where r."trigger" = 'scheduled' and r.status in ('succeeded', 'partial')
       and r.slot_at >= v_start and r.slot_at < v_end
       and (p_target is null or r.target_key = p_target)
       and exists (select 1 from hrs h where extract(hour from (r.slot_at at time zone 'Asia/Seoul')) >= h.h_from and extract(hour from (r.slot_at at time zone 'Asia/Seoul')) < h.h_to)
  ), crit as (
    select r.id, r.target_key as tk,
           coalesce(
             case when r.overall_verdict = 'FAIL' then
               (select t.overall_verdict from public.web_check_runs t
                 where t.origin_run_id = r.id and t."trigger" = 'retry' and t.status in ('succeeded', 'partial')
                 order by t.id limit 1)
             end,
             r.overall_verdict) as v,
           exists (select 1 from public.web_maintenance_windows w
                    where w.target_key = r.target_key and r.started_at >= w.starts_at and r.started_at < w.ends_at
                      and (w.cancelled_at is null or w.cancelled_at >= w.starts_at)) as planned,
           true as is_critical
      from public.web_check_runs r
     where r."trigger" = 'critical' and r.status in ('succeeded', 'partial')
       and r.critical_slot_at >= v_start and r.critical_slot_at < v_end
       and (p_target is null or r.target_key = p_target)
       and exists (select 1 from hrs h where extract(hour from (r.critical_slot_at at time zone 'Asia/Seoul')) >= h.h_from and extract(hour from (r.critical_slot_at at time zone 'Asia/Seoul')) < h.h_to)
  ), all_runs as (
    select * from sched union all select * from crit
  ), flagged as (
    select d.*,
           (not d.planned and d.v = 'FAIL' and exists (
              select 1 from public.web_probe_results p where p.run_id = d.id and p.counts_toward_overall and p.reason = 'MAINTENANCE_DETECTED')) as unplanned
      from all_runs d
  )
  select p_date, f.tk,
         (count(*) filter (where f.v = 'PASS_DATA'))::integer,
         (count(*) filter (where f.v = 'PASS_NO_DATA'))::integer,
         (count(*) filter (where f.v = 'DEGRADED'))::integer,
         (count(*) filter (where f.v = 'FAIL'))::integer,
         (count(*) filter (where f.v = 'UNVERIFIED'))::integer,
         (count(*) filter (where f.v = 'NOT_RUN'))::integer,
         (count(*) filter (where f.planned and f.v in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL')))::integer,
         (count(*) filter (where f.unplanned))::integer,
         (count(*) filter (where f.is_critical))::integer
    from flagged f
   group by f.tk
   order by f.tk;
end;
$$;

comment on function public.web_summarize_critical(date, text) is
  '핵심 시간대(web_critical_hours, 평일) 집계: 정시+촉진 실행. 촉진 실행의 판정은 재확인 실행이 있으면 그 결과. 기존 web_summarize_day와 같은 숫자 열 + 촉진 실행 수. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- 실행 권한: 모두 닫고 서버 관리용 키에게만 연다
-- ===========================================================================
revoke all on function public.web_settings_value_is_valid(text, jsonb) from public, anon, authenticated;
revoke all on function public.start_web_check_run(text, text, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_web_confirm(text, bigint, integer) from public, anon, authenticated;
revoke all on function public.web_critical_tick() from public, anon, authenticated;
revoke all on function public.web_summarize_critical(date, text) from public, anon, authenticated;
grant execute on function public.web_settings_value_is_valid(text, jsonb) to service_role;
grant execute on function public.start_web_check_run(text, text, uuid, bigint, timestamptz) to service_role;
grant execute on function public.enqueue_web_confirm(text, bigint, integer) to service_role;
grant execute on function public.web_critical_tick() to service_role;
grant execute on function public.web_summarize_critical(date, text) to service_role;

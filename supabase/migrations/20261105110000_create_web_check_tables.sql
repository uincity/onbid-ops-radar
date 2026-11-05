-- W04: 홈페이지 모니터링 점검 기록 테이블 4개와 시작·종료 DB 함수
-- Design Ref: docs/design-homepage-monitoring.md §6.1(테이블)·§6.3(start_web_check_run, finish_web_check_run)·§6.4(RLS),
--             docs/plan-homepage-monitoring.md W04, 기존 20261029020000_create_start_check_run.sql(같은 방식)
--
-- 한 줄 설명
--   web_check_runs   : 웹 점검 1회 (정시/재확인/수동, 실행 중·완료·차단)
--   web_probe_results: 점검 1회의 층별 판정 줄 (L1~L3, 보조 확인, 인증서 임박 신호)
--   web_target_state : 대상별 확정 상태 (사건 번호·연속 횟수·알림 시계). 이 파일에서는 구조만 만들고 줄은 넣지 않는다
--   web_retry_queue  : 재확인·대체 실행 예약 (대상별 대기/처리 중은 1개)
--   start_web_check_run : 멈춘 실행 정리 → 새 실행 시작, 이미 실행 중이면 차단 줄 남기고 (정시라면) 1분 뒤 대체 실행 예약
--   finish_web_check_run: 실행 종료와 대표 판정 기록
-- 이 파일이 만들지 않는 것(뒤 작업): web_maintenance_windows, web_notification_keys, web_notifications, web_daily_summary,
--   record_web_transition 등 알림·상태 전환 함수(W10a), 기존 anomalies 규칙/출처 확장(W10).
-- 규칙: 읽기는 로그인 사용자만, 쓰기 정책 없음(서버 관리용 키와 아래 DB 함수만). 시각은 timestamptz(UTC).
-- 코드와 같아야 하는 목록: 판정 6가지·사유·층 이름은 lib/web-monitor/classify.ts (tests/unit/web-db-drift.test.ts가 확인)

-- ===========================================================================
-- A. web_check_runs : 웹 점검 1회
-- ===========================================================================
create table public.web_check_runs (
  id                  bigint generated always as identity primary key,
  target_key          text        not null,
  -- scheduled(매시 정시, 대체 실행 포함) / retry(일시 실패 확인 재시도) / manual(팀장 수동 점검)
  "trigger"           text        not null,
  -- 정시 칸의 시각(정시·대체 실행만). 같은 칸의 정시 점검은 한 번만 인정된다(아래 유니크 인덱스)
  slot_at             timestamptz,
  status              text        not null default 'running',
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  -- 재확인이면 원래 실행. 원래 실행이 보존 기간이 지나 삭제되면 비워진다
  origin_run_id       bigint      references public.web_check_runs (id) on delete set null,
  -- 수동 점검을 누른 팀장. 예약·재확인에는 붙일 수 없다
  triggered_by        uuid        references public.profiles (id),
  request_count       integer     not null default 0,
  -- 이 실행의 대표 판정(종료 전 비어 있음). 재확인을 반영한 확정 판정(confirmed_verdict)은 상태 전환 함수가 채운다(W10a)
  overall_verdict     text,
  confirmed_verdict   text,
  flap                boolean     not null default false,
  planned_maintenance boolean     not null default false,

  constraint web_check_runs_target_check
    check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_check_runs_trigger_check
    check ("trigger" in ('scheduled', 'retry', 'manual')),
  constraint web_check_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed', 'blocked')),
  -- 실행 중일 때만 종료 시각이 비어 있다
  constraint web_check_runs_finished_at_check
    check ((status = 'running') = (finished_at is null)),
  constraint web_check_runs_finished_after_start_check
    check (finished_at is null or finished_at >= started_at),
  -- 정시 실행만 정시 칸 시각을 가지고, 정시 실행에는 반드시 있다
  constraint web_check_runs_slot_check
    check (("trigger" = 'scheduled') = (slot_at is not null)),
  -- 재확인만 원래 실행을 가질 수 있다 (원래 실행이 삭제되어 비는 경우가 있어 재확인에 반드시 있어야 한다고는 하지 않는다)
  constraint web_check_runs_origin_check
    check (origin_run_id is null or "trigger" = 'retry'),
  -- 담당자는 수동 점검에만 붙는다
  constraint web_check_runs_triggered_by_check
    check (triggered_by is null or "trigger" = 'manual'),
  constraint web_check_runs_request_count_check
    check (request_count >= 0),
  constraint web_check_runs_overall_verdict_check
    check (overall_verdict is null or overall_verdict in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL', 'UNVERIFIED', 'NOT_RUN')),
  constraint web_check_runs_confirmed_verdict_check
    check (confirmed_verdict is null or confirmed_verdict in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL', 'UNVERIFIED', 'NOT_RUN')),
  -- 실행 중·차단된 줄에는 판정이 없다. 정상 종료(완료·일부 완료)에는 대표 판정이 있다(멈춰서 정리된 failed는 없을 수 있음)
  constraint web_check_runs_verdict_state_check
    check (
      (status in ('running', 'blocked') and overall_verdict is null and confirmed_verdict is null)
      or (status in ('succeeded', 'partial') and overall_verdict is not null)
      or status = 'failed'
    ),
  -- 확정 판정은 정시 실행에만 있다
  constraint web_check_runs_confirmed_scheduled_check
    check (confirmed_verdict is null or "trigger" = 'scheduled'),
  -- 대상 키와 함께 자식 표가 같은 대상만 가리키도록 하는 연결용
  constraint web_check_runs_id_target_key unique (id, target_key)
);

comment on table public.web_check_runs is '웹 점검 1회(설계서 6.1). 쓰기는 서버 관리용 키와 start_web_check_run/finish_web_check_run 함수만.';
comment on column public.web_check_runs.slot_at is '정시 칸의 시각. 정시·대체 실행만 가진다. (대상, 칸)당 정시 실행은 차단된 줄을 빼고 하나만 인정된다.';
comment on column public.web_check_runs.confirmed_verdict is '재확인을 반영한 확정 판정(정시 실행만). 재확인 대기 중에는 비어 있다.';

-- 동시 실행 방지: running인 줄은 전체에서 최대 1개 (대상 수와 관계없이 서버 부담을 줄이기 위한 직렬 실행)
create unique index web_check_runs_only_one_running
  on public.web_check_runs ((true))
  where status = 'running';

-- 같은 대상의 같은 정시 칸에는 차단되지 않은 정시 실행이 하나만 있다 (정시 중복 호출·대체 실행 중복 방지)
create unique index web_check_runs_slot_once
  on public.web_check_runs (target_key, slot_at)
  where "trigger" = 'scheduled' and status <> 'blocked';

create index web_check_runs_target_started_idx on public.web_check_runs (target_key, started_at desc);

-- ===========================================================================
-- B. web_probe_results : 점검 1회의 층별 판정 (추가 전용이 아님: 보존 기간 삭제·시험 정리를 위해)
-- ===========================================================================
create table public.web_probe_results (
  id                   bigint generated always as identity primary key,
  run_id               bigint      not null,
  target_key           text        not null,
  layer                text        not null,
  -- 대표 판정에 포함되는지. 인증서 임박 신호와 보조 확인은 false
  counts_toward_overall boolean    not null,
  verdict              text        not null,
  reason               text,
  http_status          integer,
  duration_ms          integer,
  final_url            text,
  cert_days_left       integer,
  detail               jsonb,
  created_at           timestamptz not null default now(),

  -- 점검 실행이 지워지면 층별 판정도 함께 지운다(보존 기간 삭제). 실행과 대상 키가 항상 같도록 함께 연결한다
  constraint web_probe_results_run_target_fkey
    foreign key (run_id, target_key) references public.web_check_runs (id, target_key) on delete cascade,
  constraint web_probe_results_layer_check
    check (layer in ('L1_CONNECT', 'L2_HTTP', 'L3_CONTENT', 'AUX_STUB', 'AUX_QUEUE', 'L4_FILES')),
  constraint web_probe_results_verdict_check
    check (verdict in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL', 'UNVERIFIED', 'NOT_RUN')),
  -- 닫힌 사유 목록(설계서 6.1). 새 사유는 마이그레이션으로만 늘린다
  constraint web_probe_results_reason_check
    check (reason is null or reason in (
      'TIMEOUT', 'SLOW_RESPONSE', 'DNS_FAILED', 'TCP_FAILED', 'TLS_FAILED', 'HTTP_5XX', 'HTTP_BLOCKED', 'HTTP_4XX_OTHER', 'HTTP_NOT_FOUND',
      'MARKER_MISSING', 'TOO_SMALL', 'MAINTENANCE_DETECTED', 'BLOCK_PHRASE', 'CERT_EXPIRING', 'CERT_INVALID', 'REDIRECT_LIMIT',
      'HOST_NOT_ALLOWED', 'STUB_CHANGED', 'FILE_NOT_FOUND', 'UPSTREAM_FAILED', 'BUDGET_SKIP', 'INTERNAL_ERROR'
    )),
  -- 정상 판정이면 사유가 없고, 그 밖의 판정에는 반드시 사유가 있다
  constraint web_probe_results_reason_presence_check
    check ((verdict in ('PASS_DATA', 'PASS_NO_DATA')) = (reason is null)),
  -- 미점검의 사유는 두 가지뿐: 앞 층 실패로 건너뜀 / 시간 예산 소진
  constraint web_probe_results_not_run_reason_check
    check (verdict <> 'NOT_RUN' or reason in ('UPSTREAM_FAILED', 'BUDGET_SKIP')),
  -- 보조 확인은 대표 판정에 들어가지 않는다 (원칙 5)
  constraint web_probe_results_aux_not_counted_check
    check (layer not like 'AUX\_%' or counts_toward_overall = false),
  constraint web_probe_results_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint web_probe_results_duration_check
    check (duration_ms is null or duration_ms >= 0),
  -- 주소의 질의(?…)·조각(#…)은 저장하지 않는다 (서비스키·토큰 보호)
  constraint web_probe_results_final_url_check
    check (final_url is null or (char_length(final_url) <= 2000 and final_url !~ '[?#]')),
  constraint web_probe_results_detail_check
    check (detail is null or (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096)),
  -- 한 점검에서 같은 층은 (대표 판정 포함 여부가 같은) 한 줄만. 인증서 임박 신호는 포함 안 함 줄로 따로 들어간다
  constraint web_probe_results_run_layer_key unique (run_id, layer, counts_toward_overall)
);

comment on table public.web_probe_results is '웹 점검 1회의 층별 판정(설계서 6.1). 응답 본문은 저장하지 않는다. 추가 전용이 아니라 보존 기간이 지나면 삭제한다.';
create index web_probe_results_target_checked_idx on public.web_probe_results (target_key, created_at desc);

-- ===========================================================================
-- C. web_target_state : 대상별 확정 상태 (구조만. 첫 정시 점검이 줄을 만든다: W10a)
-- ===========================================================================
create table public.web_target_state (
  target_key                 text        primary key,
  current_verdict            text        not null,
  since                      timestamptz not null,
  first_failure_at           timestamptz,
  -- 사건 번호: 대상별로 사건이 시작될 때마다 1씩 늘고 알림 멱등 키에 쓰인다
  incident_no                integer     not null default 0,
  incident_open              boolean     not null default false,
  incident_last_alert_at     timestamptz,
  ongoing_count              integer     not null default 0,
  open_anomaly_id            bigint      references public.anomalies (id),
  consecutive_degraded       integer     not null default 0,
  degraded_start_run_id      bigint      references public.web_check_runs (id) on delete set null,
  consecutive_unverifiable   integer     not null default 0,
  unverifiable_start_run_id  bigint      references public.web_check_runs (id) on delete set null,
  -- 프로브별 연속 횟수와 시작 실행: { "entry-stub": { "count": 2, "start_run_id": 10 } }
  aux_state                  jsonb       not null default '{}'::jsonb,
  unplanned_since_run_id     bigint      references public.web_check_runs (id) on delete set null,
  unplanned_since            timestamptz,
  alerts_today               integer     not null default 0,
  alerts_today_date          date,
  -- 동시 갱신 충돌 확인(낙관적 잠금)
  version                    integer     not null default 0,
  updated_at                 timestamptz not null default now(),

  constraint web_target_state_target_check
    check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_target_state_verdict_check
    check (current_verdict in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL', 'UNVERIFIED', 'NOT_RUN')),
  constraint web_target_state_counts_check
    check (incident_no >= 0 and ongoing_count >= 0 and consecutive_degraded >= 0 and consecutive_unverifiable >= 0 and alerts_today >= 0 and version >= 0),
  -- 열린 사건에는 사건 번호가 있다
  constraint web_target_state_incident_check
    check (not incident_open or incident_no >= 1),
  constraint web_target_state_aux_state_check
    check (jsonb_typeof(aux_state) = 'object' and octet_length(aux_state::text) <= 4096)
);

comment on table public.web_target_state is '대상별 확정 상태(설계서 6.1). 연속 횟수는 정시 점검 1회당 1 센다. 쓰기는 서버(상태 전환 함수)만.';

create trigger web_target_state_set_updated_at
  before update on public.web_target_state
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- D. web_retry_queue : 재확인·대체 실행 예약
-- ===========================================================================
create table public.web_retry_queue (
  id             bigint generated always as identity primary key,
  target_key     text        not null,
  -- confirm(일시 실패 확인 재시도) / replace(정시 점검이 차단되어 1분 뒤 대신 실행)
  kind           text        not null,
  origin_run_id  bigint      references public.web_check_runs (id) on delete set null,
  due_at         timestamptz not null,
  status         text        not null default 'pending',
  claimed_at     timestamptz,
  attempts       integer     not null default 0,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz,

  constraint web_retry_queue_target_check
    check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_retry_queue_kind_check
    check (kind in ('confirm', 'replace')),
  constraint web_retry_queue_status_check
    check (status in ('pending', 'claimed', 'done', 'cancelled')),
  constraint web_retry_queue_attempts_check
    check (attempts >= 0),
  -- 상태와 시각 칸이 맞아야 한다: 대기=둘 다 비어 있음, 처리 중=선점 시각, 끝=처리 시각
  constraint web_retry_queue_state_check
    check (
      (status = 'pending' and claimed_at is null and processed_at is null)
      or (status = 'claimed' and claimed_at is not null and processed_at is null)
      or (status in ('done', 'cancelled') and processed_at is not null)
    )
);

comment on table public.web_retry_queue is '재확인·대체 실행 예약(설계서 5.2). 대상별 대기/처리 중 줄은 1개. 쓰기는 서버와 DB 함수만.';

-- 대상별로 대기(pending)·처리 중(claimed) 줄은 하나만
create unique index web_retry_queue_one_active_per_target
  on public.web_retry_queue (target_key)
  where status in ('pending', 'claimed');

create index web_retry_queue_due_idx on public.web_retry_queue (due_at) where status = 'pending';

-- ===========================================================================
-- E. 출입 규칙 (RLS): 로그인 사용자 읽기, 쓰기는 서버(관리용 키)와 DB 함수만
-- ===========================================================================
alter table public.web_check_runs enable row level security;
alter table public.web_probe_results enable row level security;
alter table public.web_target_state enable row level security;
alter table public.web_retry_queue enable row level security;

revoke all on public.web_check_runs, public.web_probe_results, public.web_target_state, public.web_retry_queue from anon, authenticated;
grant select on public.web_check_runs, public.web_probe_results, public.web_target_state, public.web_retry_queue to authenticated;

create policy "로그인 사용자는 web_check_runs를 읽을 수 있다"
  on public.web_check_runs for select to authenticated using (true);
create policy "로그인 사용자는 web_probe_results를 읽을 수 있다"
  on public.web_probe_results for select to authenticated using (true);
create policy "로그인 사용자는 web_target_state를 읽을 수 있다"
  on public.web_target_state for select to authenticated using (true);
create policy "로그인 사용자는 web_retry_queue를 읽을 수 있다"
  on public.web_retry_queue for select to authenticated using (true);

-- ===========================================================================
-- F. start_web_check_run : 웹 점검을 안전하게 시작하는 입구
-- ===========================================================================
-- 한 트랜잭션에서: 1) 멈춘 running 정리(web_stale_running_seconds) 2) 새 running 시작
--   3) 이미 실행 중이면 blocked 줄을 남기고, 정시 점검이면 1분 뒤 대체 실행(replace)을 예약한다.
--   같은 정시 칸의 점검이 이미 있어 막힌 경우(정시 중복 호출)에는 대체 실행을 예약하지 않는다(칸이 이미 채워졌으므로).
-- 누가 부르나: 서버의 점검 실행기(서버 관리용 키 = service_role)만.
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
begin
  -- 멈춘 실행 정리 기준은 코드에 숫자를 쓰지 않고 web_settings에서 읽는다. 값이 없으면 기본값으로 대신하지 않고 멈춘다.
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
    insert into public.web_check_runs (target_key, "trigger", triggered_by, origin_run_id, slot_at)
    values (p_target, p_trigger, p_triggered_by, p_origin_run_id, p_slot_at)
    returning id into v_id;

    return query select v_id, 'running'::text;
    return;
  exception when unique_violation then
    -- 어느 제약에 걸렸는지 본다: 이미 실행 중(web_check_runs_only_one_running) / 같은 정시 칸 중복(web_check_runs_slot_once)
    get stacked diagnostics v_constraint = constraint_name;
  end;

  -- 3) 차단 기록
  insert into public.web_check_runs (target_key, "trigger", status, finished_at, triggered_by, origin_run_id, slot_at)
  values (p_target, p_trigger, 'blocked', now(), p_triggered_by, p_origin_run_id, p_slot_at)
  returning id into v_id;

  -- 정시 점검이 다른 실행 때문에 막혔으면 같은 칸을 대신 실행하도록 1분 뒤로 예약한다. 이미 대기/처리 중 줄이 있으면 새로 만들지 않는다
  if p_trigger = 'scheduled' and v_constraint = 'web_check_runs_only_one_running' then
    insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at)
    values (p_target, 'replace', v_id, now() + interval '1 minute')
    on conflict do nothing;
  end if;

  return query select v_id, 'blocked'::text;
end;
$$;

comment on function public.start_web_check_run(text, text, uuid, bigint, timestamptz) is
  '웹 점검 시작 입구. 멈춘 running 정리 → 시작 또는 blocked 기록(정시면 대체 실행 예약). 서버 관리용 키(service_role)만 실행할 수 있다.';

-- ===========================================================================
-- G. finish_web_check_run : 실행 종료와 대표 판정 기록
-- ===========================================================================
-- 실행 중(running)인 줄만 마감한다. 이미 멈춘 실행으로 정리되었거나 끝난 줄이면 false를 돌려주고 아무것도 바꾸지 않는다.
create or replace function public.finish_web_check_run(
  p_run                 bigint,
  p_status              text,
  p_overall_verdict     text default null,
  p_request_count       integer default 0,
  p_planned_maintenance boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception '종료 상태는 succeeded, partial, failed 중 하나여야 합니다' using errcode = '22023';
  end if;

  update public.web_check_runs
     set status = p_status,
         finished_at = now(),
         overall_verdict = p_overall_verdict,
         request_count = p_request_count,
         planned_maintenance = coalesce(p_planned_maintenance, false)
   where id = p_run
     and status = 'running';

  return found;
end;
$$;

comment on function public.finish_web_check_run(bigint, text, text, integer, boolean) is
  '웹 점검 종료 기록. running인 줄만 마감하고 마감했으면 true. 서버 관리용 키(service_role)만 실행할 수 있다.';

-- 실행 권한: 기본으로 모두에게 열려 있으므로 먼저 모두 닫고, 서버 관리용 키에게만 연다.
revoke all on function public.start_web_check_run(text, text, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_web_check_run(bigint, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.start_web_check_run(text, text, uuid, bigint, timestamptz) to service_role;
grant execute on function public.finish_web_check_run(bigint, text, text, integer, boolean) to service_role;

-- PLAN 작업 7: 점검 실행 이력(check_runs), 실행 메모(run_logs), API 점검 결과(api_checks) 테이블
-- Design Ref: DESIGN §6.1(테이블), §6.2(관계), §6.4(RLS), §5.1(점검 흐름), PRD 5-2 규칙 4·5·7·11
--
-- 한 줄 설명
--   check_runs : 점검을 한 번 돌릴 때마다 한 줄 ("언제, 누가/자동으로, 어떤 출처를, 어떻게 끝났나")
--   api_checks : 그 점검 중 API를 한 번 부를 때마다 한 줄 ("얼마나 걸렸고, 성공했나")
--   run_logs   : 점검 중 남기는 메모 ("상한 도달", "비교 제외 사유", "예약 누락" 등)
-- 쓰기는 서버의 점검 엔진(관리용 키)만 한다. 로그인 사용자는 읽기만 한다. (DESIGN 6.4)

-- ---------------------------------------------------------------------------
-- 1. check_runs : 점검 실행 1회
-- ---------------------------------------------------------------------------
create table public.check_runs (
  id             bigint generated always as identity primary key,
  -- 어떻게 시작됐나: 예약 점검(scheduled) 또는 팀장의 수동 점검(manual)
  "trigger"      text        not null,
  -- 어느 데이터를 점검했나 (PRD: DEMO와 PUBLIC을 항상 구분)
  source         text        not null,
  -- running(실행 중) / succeeded(완료) / partial(일부만 완료) / failed(실패) / blocked(이미 실행 중이라 차단됨)
  status         text        not null default 'running',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  api_call_count integer     not null default 0,
  -- 수동 점검을 누른 팀장. 예약 점검은 비어 있다.
  triggered_by   uuid        references public.profiles (id) on delete set null,

  constraint check_runs_trigger_check
    check ("trigger" in ('scheduled', 'manual')),
  constraint check_runs_source_check
    check (source in ('DEMO', 'PUBLIC')),
  constraint check_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed', 'blocked')),
  -- 실행 중일 때만 종료 시각이 비어 있다. 끝난 줄(차단 포함)에는 반드시 종료 시각이 있다.
  constraint check_runs_finished_at_check
    check ((status = 'running') = (finished_at is null)),
  constraint check_runs_time_order_check
    check (finished_at is null or finished_at >= started_at),
  constraint check_runs_api_call_count_check
    check (api_call_count >= 0),
  -- 예약 점검은 사람이 시작한 것이 아니므로 triggered_by가 없다.
  constraint check_runs_scheduled_no_user_check
    check ("trigger" <> 'scheduled' or triggered_by is null)
);

comment on table public.check_runs is '점검 실행 1회. 쓰기는 서버 점검 엔진만 한다.';
comment on column public.check_runs.status is 'running/succeeded/partial/failed/blocked(중복 실행 차단 기록)';

-- 동시 실행 방지: status가 running인 줄은 전체에서 최대 1개 (PRD 5-2 규칙 7)
-- 이미 실행 중일 때 새로 시도하면 이 제약에 걸려 거부되고, 서버는 blocked 줄로 기록한다.
create unique index check_runs_only_one_running
  on public.check_runs ((true))
  where status = 'running';

create index check_runs_started_at_idx on public.check_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 2. api_checks : API 호출 1번의 결과
-- ---------------------------------------------------------------------------
create table public.api_checks (
  id            bigint generated always as identity primary key,
  run_id        bigint      not null references public.check_runs (id),
  -- API 이름만 적는다. 주소(URL)나 인증키가 섞이지 않도록 형식을 제한한다. (PRD 7-3 규칙 6, SEC-10)
  endpoint_name text        not null,
  -- 응답을 받지 못한 경우(타임아웃 등)에는 비어 있다.
  http_status   integer,
  duration_ms   integer     not null,
  -- 요청 결과 구분 (PRD 5-2 규칙 4·6): HTTP 200이어도 데이터가 비었는지는 별도로 구분한다.
  outcome       text        not null,
  record_count  integer,
  -- 응답 데이터가 규칙상 유효한지 (HTTP 200이어도 업무적으로 비정상일 수 있음). 판단할 데이터가 없으면 비어 있다.
  data_valid    boolean,
  checked_at    timestamptz not null default now(),

  constraint api_checks_endpoint_name_check
    check (endpoint_name ~ '^[A-Za-z0-9_.-]{1,60}$'),
  constraint api_checks_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint api_checks_duration_check
    check (duration_ms >= 0),
  constraint api_checks_outcome_check
    check (outcome in ('success', 'http_error', 'timeout', 'auth_or_quota', 'empty_result')),
  constraint api_checks_record_count_check
    check (record_count is null or record_count >= 0)
);

comment on table public.api_checks is 'API 호출 1번의 결과(응답시간·성공·실패). 쓰기는 서버 점검 엔진만 한다.';
comment on column public.api_checks.endpoint_name is 'API 이름(키·주소 없음). 예: demo-list';
comment on column public.api_checks.outcome is 'success/http_error/timeout/auth_or_quota(서비스키·한도 문제)/empty_result(빈 결과)';

create index api_checks_run_id_idx on public.api_checks (run_id);
create index api_checks_checked_at_idx on public.api_checks (checked_at desc);

-- ---------------------------------------------------------------------------
-- 3. run_logs : 점검 중 남기는 메모
-- ---------------------------------------------------------------------------
create table public.run_logs (
  id        bigint generated always as identity primary key,
  -- 예약 누락처럼 실행 자체가 없었던 경우에는 비어 있다.
  run_id    bigint      references public.check_runs (id),
  -- KST 기준 날짜 (예약 누락을 날짜당 1건으로 제한할 때 쓴다)
  log_date  date        not null default ((now() at time zone 'Asia/Seoul')::date),
  level     text        not null default 'info',
  -- 메모 종류. 예: LIMIT_REACHED, TIMEOUT, COMPARE_SKIPPED, BUDGET_EXCEEDED, SCHEDULE_MISSED
  code      text        not null,
  message   text        not null,
  logged_at timestamptz not null default now(),

  constraint run_logs_level_check
    check (level in ('info', 'warn', 'error')),
  constraint run_logs_code_check
    check (code ~ '^[A-Z][A-Z0-9_]{0,59}$'),
  constraint run_logs_message_length_check
    check (char_length(message) between 1 and 500),
  -- 인증키가 메모에 그대로 남지 않게 막는다. "serviceKey=" 뒤에는 **** 만 올 수 있다. (PRD 7-3 규칙 6·7)
  constraint run_logs_no_service_key_check
    check (message !~* 'servicekey=(?!\*)')
);

comment on table public.run_logs is '점검 중 남기는 메모(상한 도달, 비교 제외 사유, 예약 누락 등). 쓰기는 서버만 한다.';

-- 예약 누락 기록은 날짜당 1건만 (PRD 5-2 규칙 11)
create unique index run_logs_schedule_missed_per_day
  on public.run_logs (log_date)
  where code = 'SCHEDULE_MISSED';

create index run_logs_run_id_idx on public.run_logs (run_id);
create index run_logs_log_date_idx on public.run_logs (log_date);

-- ---------------------------------------------------------------------------
-- 4. 출입 규칙 (RLS) — 세 테이블 모두 "로그인 사용자 읽기, 쓰기는 서버만" (DESIGN 6.4)
-- ---------------------------------------------------------------------------
alter table public.check_runs enable row level security;
alter table public.api_checks enable row level security;
alter table public.run_logs   enable row level security;

revoke all on public.check_runs, public.api_checks, public.run_logs from anon, authenticated;
grant select on public.check_runs, public.api_checks, public.run_logs to authenticated;

create policy "로그인 사용자는 check_runs를 읽을 수 있다"
  on public.check_runs for select to authenticated using (true);

create policy "로그인 사용자는 api_checks를 읽을 수 있다"
  on public.api_checks for select to authenticated using (true);

create policy "로그인 사용자는 run_logs를 읽을 수 있다"
  on public.run_logs for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.
-- → 쓰기는 RLS를 건너뛰는 서버 관리용 키(점검 엔진)만 할 수 있다.

-- PLAN 작업 11: 보고서 스냅샷(reports)과 설정값(settings) 테이블
-- Design Ref: DESIGN §6.1(reports·settings), §6.4(RLS), §5.3(보고서 흐름), PRD 5-4(일일 점검보고서), 5-5(기본 설정값),
--             7-4(감사이력은 수정·삭제 금지), 7-5 SEC-03·SEC-05, 7-3 규칙 6·7(인증키 노출 금지)
--
-- 한 줄 설명
--   settings : 앱이 쓰는 기준값(타임아웃 10초, 호출 상한 20/100회 …)을 한곳에 모아 둔 표. 값은 DB가 범위를 검사한다.
--   reports  : 팀장이 "보고서 생성"을 누를 때마다 그 시점의 결과를 통째로 한 줄씩 보관하는 표. 한번 저장하면 고칠 수 없다.

-- ===========================================================================
-- A. settings : 설정값
-- ===========================================================================

-- 값 검사용 도우미 함수 3개. CHECK 제약은 SELECT를 직접 쓸 수 없어서 함수로 감싼다.
-- 비로그인·로그인 사용자가 API로 직접 부를 수 없도록 실행 권한을 거두고, 서버 관리용 키(service_role)에게만 준다.

-- 정수이고 [최소, 최대] 범위 안인지 (소수점·문자·음수는 모두 false)
create or replace function public.settings_int_between(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^[0-9]{1,9}$'
        then (p_value::text)::integer between p_min and p_max
      else false
    end,
    false
  )
$$;

-- 필드 이름 목록(최대 30개, 영문 소문자·숫자·밑줄)인지
create or replace function public.settings_field_list_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) <= 30
        then not exists (
          select 1 from jsonb_array_elements(p_value) as e(item)
          where jsonb_typeof(e.item) <> 'string'
             or (e.item #>> '{}') !~ '^[a-z][a-z0-9_]{0,59}$'
        )
      else false
    end,
    false
  )
$$;

-- 설정 항목마다 값의 모양과 범위가 맞는지 (PRD 5-5)
create or replace function public.settings_value_is_valid(p_key text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case p_key
      -- 목록·상세 수집시각 허용 차이(분)
      when 'compare_window_minutes' then public.settings_int_between(p_value, 1, 60)
      -- API 요청별 타임아웃(초)
      when 'api_timeout_seconds' then public.settings_int_between(p_value, 1, 60)
      -- API 호출 기본 상한 / 최대 허용 상한(실행당). 최대 허용 상한 100회는 이 검증의 한계다. (PRD 5-5)
      when 'api_call_limit_default' then public.settings_int_between(p_value, 1, 100)
      when 'api_call_limit_max' then public.settings_int_between(p_value, 1, 100)
      -- PUBLIC API 일일 호출 예산: 공공데이터포털 승인 트래픽 확인 전에는 비워 둔다(JSON null).
      when 'public_daily_budget' then jsonb_typeof(p_value) = 'null' or public.settings_int_between(p_value, 1, 1000000)
      -- 점검 작업 전체 실행시간 제한(초)
      when 'run_time_limit_seconds' then public.settings_int_between(p_value, 10, 300)
      -- 조치내용·판정 사유·재개 사유의 최소 글자 수(공백 제외). anomaly_events가 10자 미만을 항상 거부하므로 10 아래로는 내릴 수 없다.
      when 'reason_min_length' then public.settings_int_between(p_value, 10, 100)
      -- 예약 점검 누락 판단: 예정 시각 후 몇 분까지 기다릴지
      when 'schedule_missed_grace_minutes' then public.settings_int_between(p_value, 1, 120)
      -- 멈춘 실행 정리 기준(초). 점검 작업 전체 실행시간 제한보다 커야 한다(값 변경 시 서버 설정 모듈이 함께 확인).
      when 'stale_running_seconds' then public.settings_int_between(p_value, 60, 600)
      -- 예약 점검이 조회하는 출처
      when 'scheduled_source' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') in ('DEMO', 'PUBLIC')
      -- 출처별 필드 이름 목록: { "DEMO": ["필드", ...] }
      when 'required_fields' then
        case when jsonb_typeof(p_value) = 'object'
          then not exists (
            select 1 from jsonb_each(p_value) as e(k, v)
            where e.k not in ('DEMO', 'PUBLIC') or not public.settings_field_list_valid(e.v)
          )
          else false end
      when 'compare_fields' then
        case when jsonb_typeof(p_value) = 'object'
          then not exists (
            select 1 from jsonb_each(p_value) as e(k, v)
            where e.k not in ('DEMO', 'PUBLIC') or not public.settings_field_list_valid(e.v)
          )
          else false end
      when 'excluded_fields' then
        case when jsonb_typeof(p_value) = 'object'
          then not exists (
            select 1 from jsonb_each(p_value) as e(k, v)
            where e.k not in ('DEMO', 'PUBLIC') or not public.settings_field_list_valid(e.v)
          )
          else false end
      -- API 이름별 "빈 결과(0건)를 정상으로 허용하는지": { "demo-list": false }
      when 'empty_allowed_by_endpoint' then
        case when jsonb_typeof(p_value) = 'object'
          then not exists (
            select 1 from jsonb_each(p_value) as e(k, v)
            where e.k !~ '^[A-Za-z0-9_.-]{1,60}$' or jsonb_typeof(e.v) <> 'boolean'
          )
          else false end
      else false
    end,
    false
  )
$$;

revoke all on function public.settings_int_between(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.settings_field_list_valid(jsonb) from public, anon, authenticated;
revoke all on function public.settings_value_is_valid(text, jsonb) from public, anon, authenticated;
grant execute on function public.settings_int_between(jsonb, integer, integer) to service_role;
grant execute on function public.settings_field_list_valid(jsonb) to service_role;
grant execute on function public.settings_value_is_valid(text, jsonb) to service_role;

create table public.settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),

  -- 정해진 14개 항목만 둘 수 있다. 새 항목은 마이그레이션으로만 추가한다.
  constraint settings_key_check
    check (key in (
      'compare_window_minutes', 'api_timeout_seconds', 'api_call_limit_default', 'api_call_limit_max',
      'public_daily_budget', 'run_time_limit_seconds', 'reason_min_length', 'schedule_missed_grace_minutes',
      'stale_running_seconds', 'scheduled_source', 'required_fields', 'compare_fields',
      'excluded_fields', 'empty_allowed_by_endpoint'
    )),
  constraint settings_value_valid_check
    check (public.settings_value_is_valid(key, value))
);

comment on table public.settings is '앱 설정값(PRD 5-5)과 탐지 설정. 값은 DB가 범위를 검사한다. 변경은 마이그레이션이나 관리 스크립트로만 한다(화면 없음).';
comment on column public.settings.value is 'JSON. 항목마다 모양과 범위가 정해져 있다(settings_value_is_valid 함수).';

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- 항목 이름은 바꿀 수 없고, 항목을 지우거나 표를 비울 수도 없다. (앱이 항상 같은 14개 항목을 찾을 수 있도록)
create or replace function public.settings_protect_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      raise exception '설정 항목의 이름은 바꿀 수 없습니다.'
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;
  raise exception '설정 항목은 삭제하거나 비울 수 없습니다. (값만 바꿀 수 있습니다)'
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger settings_protect_update
  before update on public.settings
  for each row execute function public.settings_protect_keys();
create trigger settings_protect_delete
  before delete on public.settings
  for each row execute function public.settings_protect_keys();
create trigger settings_protect_truncate
  before truncate on public.settings
  for each statement execute function public.settings_protect_keys();

-- 기본값 (PRD 5-5)
insert into public.settings (key, value) values
  ('compare_window_minutes',        '10'::jsonb),
  ('api_timeout_seconds',           '10'::jsonb),
  ('api_call_limit_default',        '20'::jsonb),
  ('api_call_limit_max',            '100'::jsonb),
  ('public_daily_budget',           'null'::jsonb),
  ('run_time_limit_seconds',        '60'::jsonb),
  ('reason_min_length',             '10'::jsonb),
  ('schedule_missed_grace_minutes', '30'::jsonb),
  ('stale_running_seconds',         '120'::jsonb),
  ('scheduled_source',              '"DEMO"'::jsonb),
  -- DEMO 필드는 PRD 부록 B. PUBLIC 항목은 부록 A 확정 후 추가한다.
  ('required_fields',  '{"DEMO": ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"]}'::jsonb),
  ('compare_fields',   '{"DEMO": ["item_name", "org_name", "bid_start_at", "bid_end_at"]}'::jsonb),
  ('excluded_fields',  '{"DEMO": ["item_status"]}'::jsonb),
  ('empty_allowed_by_endpoint', '{"demo-list": false, "demo-detail": false}'::jsonb);

-- 출입 규칙 (RLS): 로그인 사용자 읽기, 쓰기는 서버(관리용 키)만 (DESIGN 6.4)
alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;
grant select on public.settings to authenticated;

create policy "로그인 사용자는 settings를 읽을 수 있다"
  on public.settings for select to authenticated using (true);

-- ===========================================================================
-- B. reports : 일일 점검보고서 스냅샷 (추가만 가능)
-- ===========================================================================
create table public.reports (
  id           bigint generated always as identity primary key,
  -- 어느 날의 보고서인가 (KST 날짜). 같은 날 여러 번 만들 수 있고 모두 남는다. (PRD 5-4 규칙 5)
  report_date  date        not null,
  -- 보고서는 출처(DEMO/PUBLIC)별로 따로 만든다. (PRD 5-4 규칙 3)
  source       text        not null,
  generated_by uuid        not null references public.profiles (id),
  generated_at timestamptz not null default now(),
  -- 어느 시각까지 집계했나. 오늘 보고서는 생성 시각까지, 지난 날짜는 그날 끝(다음 날 00:00 KST)까지.
  covers_until timestamptz not null,
  content_md   text        not null,
  -- 숫자 요약(점검 성공·실패 건수, 신규 이상징후 수 …). 화면 목록에서 쓴다.
  summary      jsonb       not null default '{}'::jsonb,

  constraint reports_source_check
    check (source in ('DEMO', 'PUBLIC')),
  -- 아직 오지 않은 날짜의 보고서는 만들 수 없다.
  constraint reports_date_not_future_check
    check (report_date <= ((generated_at at time zone 'Asia/Seoul')::date)),
  -- 집계 시각은 그 날짜 안에 있어야 하고(KST), 생성 시각을 넘을 수 없다.
  constraint reports_covers_within_day_check
    check (
      covers_until >= (report_date::timestamp at time zone 'Asia/Seoul')
      and covers_until <= ((report_date + 1)::timestamp at time zone 'Asia/Seoul')
    ),
  constraint reports_covers_not_future_check
    check (covers_until <= generated_at),
  constraint reports_content_length_check
    check (char_length(btrim(content_md)) between 1 and 500000),
  constraint reports_summary_object_check
    check (jsonb_typeof(summary) = 'object'),
  constraint reports_summary_size_check
    check (octet_length(summary::text) <= 20000),
  -- 인증키가 보고서에 그대로 남지 않게 막는다. (PRD 7-3 규칙 7)
  constraint reports_no_service_key_check
    check (content_md !~* 'servicekey=(?!\*)')
);

comment on table public.reports is '일일 점검보고서 스냅샷. 추가만 가능하고 수정·삭제·비우기는 누구도 할 수 없다(SEC-05). 추가는 서버가 팀장(admin) 확인 후에만 한다.';
comment on column public.reports.covers_until is '집계한 마지막 시각. 오늘 보고서는 생성 시각, 지난 날짜는 그날 끝(KST)';

create index reports_date_idx on public.reports (report_date desc, source, generated_at desc);

-- 팀장(admin)만 만들 수 있다: 만든 사람(generated_by)이 admin 역할이 아니면 거부한다. (SEC-03)
-- 서버가 admin을 먼저 확인하지만, 그 확인이 빠지더라도 DB가 한 번 더 막는다.
create or replace function public.reports_check_generator()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = new.generated_by;
  if v_role is distinct from 'admin' then
    raise exception '보고서는 팀장(admin)만 만들 수 있습니다.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger reports_check_generator
  before insert on public.reports
  for each row execute function public.reports_check_generator();

-- 추가만 가능: 수정·삭제·비우기를 소유자 권한으로도 막는다. (SEC-05)
create or replace function public.reports_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '보고서 스냅샷은 추가만 가능하며 수정·삭제·비우기는 할 수 없습니다.'
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger reports_no_update_delete
  before update or delete on public.reports
  for each row execute function public.reports_block_change();
create trigger reports_no_truncate
  before truncate on public.reports
  for each statement execute function public.reports_block_change();

-- 출입 규칙 (RLS)과 권한
--   로그인 사용자 : 읽기만
--   서버 관리용 키 : 읽기 + 추가만 (수정·삭제 권한 없음). 서버가 팀장(admin)을 확인한 뒤 보고서를 추가한다.
--   비로그인      : 아무것도 못 함
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated, service_role;
grant select on public.reports to authenticated, service_role;
grant insert on public.reports to service_role;

create policy "로그인 사용자는 reports를 읽을 수 있다"
  on public.reports for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.
-- → 사용자 권한(로그인 사용자)으로는 보고서를 만들거나 고칠 수 없다.

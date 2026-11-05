-- W05: 홈페이지 모니터링 전용 설정 테이블 web_settings
-- Design Ref: docs/design-homepage-monitoring.md §6.5(웹 전용 설정 테이블), docs/plan-homepage-monitoring.md §4.4·D8
--
-- 한 줄 설명: 홈페이지 점검 설정 20개를 기존 settings 테이블과 "따로" 둔다.
-- 왜 따로 두나: 기존 설정 읽기(loadSettings)는 settings 테이블의 모든 줄을 읽고 모르는 항목이 있으면 오류로 멈춘다.
--   웹 항목을 같은 테이블에 넣으면 OpenAPI 점검·대시보드·보고서가 한꺼번에 멈추므로, 이 파일은 settings를 전혀 건드리지 않는다.
-- 규칙: 항목 이름은 정해진 20개만, 값은 DB가 범위를 검사, 읽기는 로그인 사용자, 쓰기는 서버(관리용 키)·마이그레이션만.
-- 항목 사이의 관계(느림 기준 < 타임아웃, 실행 한도 < 멈춘 실행 기준)는 DB가 한 줄씩만 보므로 웹 설정 읽기 코드(lib/web-monitor/settings.ts)가 확인한다.
-- updated_at은 web_monitor_enabled를 "다시 켠 시각"으로 쓰는 감시 기준이 된다(설계서 FR-8).
-- 정수 범위 검사는 기존 함수 public.settings_int_between을 그대로 쓴다(바꾸지 않음).

-- ① 값 검사 함수: 항목 이름별 허용 범위 (코드의 lib/web-monitor/settings.ts WEB_INT_RANGES와 같아야 하며 tests/unit/web-settings-drift.test.ts가 확인)
create or replace function public.web_settings_value_is_valid(p_key text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case p_key
      -- 요청 타임아웃(ms) / 응답이 느리다고 보는 기준(ms, 타임아웃보다 작아야 함: 코드가 확인)
      when 'web_http_timeout_ms' then public.settings_int_between(p_value, 1000, 30000)
      when 'web_http_slow_ms' then public.settings_int_between(p_value, 500, 29999)
      -- 일시 실패 확인 재시도까지 기다리는 시간(초)
      when 'web_confirm_retry_delay_sec' then public.settings_int_between(p_value, 30, 600)
      -- 장애가 계속될 때 다시 알리는 간격(시간)
      when 'web_realert_after_hours' then public.settings_int_between(p_value, 1, 24)
      -- 저하 알림 / 검증 불가 알림 / 보조 점검 이상 알림의 연속 횟수
      when 'web_degraded_alert_count' then public.settings_int_between(p_value, 1, 10)
      when 'web_unverifiable_alert_count' then public.settings_int_between(p_value, 1, 10)
      when 'web_aux_alert_count' then public.settings_int_between(p_value, 1, 10)
      -- 인증서 만료 임박 경고 기준(일)
      when 'web_cert_warn_days' then public.settings_int_between(p_value, 1, 60)
      -- 자체 감시: 정상 점검이 이 시간(분) 없으면 모니터 정지 알림(1시간 주기보다 커야 해서 90분부터) / 재알림 간격(시간)
      when 'web_heartbeat_stale_min' then public.settings_int_between(p_value, 90, 1440)
      when 'web_heartbeat_realert_hours' then public.settings_int_between(p_value, 1, 168)
      -- 신선도 기준(시간, M3)
      when 'web_freshness_max_hours' then public.settings_int_between(p_value, 1, 168)
      -- 점검 결과 보존 기간(일)
      when 'web_result_retention_days' then public.settings_int_between(p_value, 7, 365)
      -- 하루 알림 상한(건)
      when 'web_alert_daily_cap' then public.settings_int_between(p_value, 1, 100)
      -- 한 번의 웹 점검 전체 시간 제한(초). 점검 경로 maxDuration 90초보다 작아야 한다
      when 'web_run_time_limit_seconds' then public.settings_int_between(p_value, 10, 85)
      -- 멈춘 실행 정리 기준(초). 실행 시간 제한보다 커야 함(코드가 확인)
      when 'web_stale_running_seconds' then public.settings_int_between(p_value, 60, 600)
      -- 요청과 요청 사이 최소 간격(ms). 0이면 쉬지 않음
      when 'web_request_gap_ms' then public.settings_int_between(p_value, 0, 5000)
      -- 텔레그램 요청 타임아웃(ms)
      when 'web_notify_timeout_ms' then public.settings_int_between(p_value, 1000, 30000)
      -- 계획 점검 창 최대 길이(시간) / 점검 문구가 창 없이 이어지면 일반 실패로 승격하는 시간(시간)
      when 'web_window_max_hours' then public.settings_int_between(p_value, 1, 720)
      when 'web_unplanned_escalate_hours' then public.settings_int_between(p_value, 1, 48)
      -- 웹 점검 켜기/끄기 (true/false만)
      when 'web_monitor_enabled' then jsonb_typeof(p_value) = 'boolean'
      else false
    end,
    false
  );
$$;

-- ② 테이블
create table public.web_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),

  constraint web_settings_key_check
    check (key in (
      'web_http_timeout_ms', 'web_http_slow_ms', 'web_confirm_retry_delay_sec', 'web_realert_after_hours',
      'web_degraded_alert_count', 'web_unverifiable_alert_count', 'web_aux_alert_count', 'web_cert_warn_days',
      'web_heartbeat_stale_min', 'web_heartbeat_realert_hours', 'web_freshness_max_hours', 'web_result_retention_days',
      'web_alert_daily_cap', 'web_run_time_limit_seconds', 'web_stale_running_seconds', 'web_request_gap_ms',
      'web_notify_timeout_ms', 'web_window_max_hours', 'web_unplanned_escalate_hours', 'web_monitor_enabled'
    )),
  constraint web_settings_value_valid_check
    check (public.web_settings_value_is_valid(key, value))
);

comment on table public.web_settings is '홈페이지 가용성 모니터링 설정(설계서 6.5). 기존 settings와 분리. 값은 DB가 범위를 검사한다. 변경은 마이그레이션이나 관리 스크립트로만 한다(화면 없음).';
comment on column public.web_settings.updated_at is '마지막 변경 시각. web_monitor_enabled의 경우 "다시 켠 시각"으로 자체 감시 기준에 쓴다.';

create trigger web_settings_set_updated_at
  before update on public.web_settings
  for each row execute function public.set_updated_at();

-- ③ 항목 이름은 바꿀 수 없고, 항목을 지우거나 표를 비울 수도 없다 (앱이 항상 같은 20개 항목을 찾을 수 있도록)
create or replace function public.web_settings_protect_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      raise exception '웹 설정 항목의 이름은 바꿀 수 없습니다.'
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;
  raise exception '웹 설정 항목은 삭제하거나 비울 수 없습니다. (값만 바꿀 수 있습니다)'
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger web_settings_protect_update
  before update on public.web_settings
  for each row execute function public.web_settings_protect_keys();
create trigger web_settings_protect_delete
  before delete on public.web_settings
  for each row execute function public.web_settings_protect_keys();
create trigger web_settings_protect_truncate
  before truncate on public.web_settings
  for each statement execute function public.web_settings_protect_keys();

-- ④ 기본값 (계획서 4.4)
insert into public.web_settings (key, value) values
  ('web_http_timeout_ms',          '10000'::jsonb),
  ('web_http_slow_ms',             '3000'::jsonb),
  ('web_confirm_retry_delay_sec',  '90'::jsonb),
  ('web_realert_after_hours',      '3'::jsonb),
  ('web_degraded_alert_count',     '2'::jsonb),
  ('web_unverifiable_alert_count', '3'::jsonb),
  ('web_aux_alert_count',          '3'::jsonb),
  ('web_cert_warn_days',           '14'::jsonb),
  ('web_heartbeat_stale_min',      '130'::jsonb),
  ('web_heartbeat_realert_hours',  '24'::jsonb),
  ('web_freshness_max_hours',      '24'::jsonb),
  ('web_result_retention_days',    '90'::jsonb),
  ('web_alert_daily_cap',          '12'::jsonb),
  ('web_run_time_limit_seconds',   '60'::jsonb),
  ('web_stale_running_seconds',    '180'::jsonb),
  ('web_request_gap_ms',           '500'::jsonb),
  ('web_notify_timeout_ms',        '5000'::jsonb),
  ('web_window_max_hours',         '168'::jsonb),
  ('web_unplanned_escalate_hours', '6'::jsonb),
  ('web_monitor_enabled',          'true'::jsonb);

-- ⑤ 출입 규칙 (RLS): 로그인 사용자 읽기, 쓰기는 서버(관리용 키)만
alter table public.web_settings enable row level security;
revoke all on public.web_settings from anon, authenticated;
grant select on public.web_settings to authenticated;

create policy "로그인 사용자는 web_settings를 읽을 수 있다"
  on public.web_settings for select to authenticated using (true);

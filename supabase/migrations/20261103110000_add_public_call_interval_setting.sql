-- R04: 서비스(배치)별 호출 간격 조절을 위한 설정 항목 1개를 더한다 (같은 서비스에 연달아 보내는 PUBLIC 요청 사이의 최소 간격, 밀리초).
-- Design Ref: PRD 5-2-3(호출 예산·속도 제한), 부록 E-3(R04), CLAUDE.md(숫자는 코드에 흩어 두지 않고 설정값 한곳에서 관리)
--
-- 바꾸는 것: ① 허용 항목 이름에 public_call_interval_ms 추가(15개 → 16개)  ② 값 검사 함수에 범위(0~5000) 추가  ③ 기본값 200 넣기
-- 배포 순서: 앱 코드가 이 항목을 "없어도 되는 항목"으로 읽도록 먼저 배포한 뒤 이 파일을 적용한다 (모르는 항목을 만나면 이전 코드는 설정 읽기에 실패하므로).
-- 앞 마이그레이션은 이미 적용되어 고치지 않는다. 제약·함수는 다시 만들고, 지우는 데이터는 없다.

alter table public.settings drop constraint settings_key_check;

alter table public.settings add constraint settings_key_check
  check (key in (
    'compare_window_minutes', 'api_timeout_seconds', 'api_call_limit_default', 'api_call_limit_max',
    'public_daily_budget', 'run_time_limit_seconds', 'reason_min_length', 'schedule_missed_grace_minutes',
    'stale_running_seconds', 'api_fail_streak_threshold', 'public_call_interval_ms', 'scheduled_source', 'required_fields', 'compare_fields',
    'excluded_fields', 'empty_allowed_by_endpoint'
  ));

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
      -- 같은 오퍼레이션이 연속 몇 번 FAIL이면 API 상태 이상징후를 만들지 (R04)
      when 'api_fail_streak_threshold' then public.settings_int_between(p_value, 2, 10)
      -- 같은 서비스에 연달아 보내는 PUBLIC 요청 사이의 최소 간격(밀리초). 0이면 기다리지 않는다
      when 'public_call_interval_ms' then public.settings_int_between(p_value, 0, 5000)
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

insert into public.settings (key, value) values ('public_call_interval_ms', '200'::jsonb);

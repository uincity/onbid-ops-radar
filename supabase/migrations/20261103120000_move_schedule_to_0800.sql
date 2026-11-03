-- 예약 점검 시각을 KST 09:00에서 08:00으로 옮긴다 (2026-11-03 사용자 요청). 누락 감지 함수의 "예정 시각" 계산과 기록 문구만 바꾼다.
-- 앞 마이그레이션(20261029080000)은 이미 적용되어 고치지 않는다. 함수를 같은 이름·같은 인자로 다시 만들고(create or replace), 권한은 그대로 다시 지정한다. 지우는 데이터는 없다.
-- 하는 일은 같다: 오늘(KST) 예약 점검 실행 기록이 없고 확인 기한(예정 08:00 + 설정값 schedule_missed_grace_minutes, 기본 30분 = 08:30)이 지났으면 SCHEDULE_MISSED를 날짜당 1줄 남긴다.
-- 배포 순서: 앱 코드(예약 시각 표시) 먼저, 이 파일은 나중, Cron 재등록은 마지막.

create or replace function public.mark_schedule_missed(p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date     date;
  v_start    timestamptz;
  v_deadline timestamptz;
  v_grace    integer;
  v_rows     integer;
begin
  v_date := (p_now at time zone 'Asia/Seoul')::date;
  v_start := (v_date::timestamp) at time zone 'Asia/Seoul';

  -- 대기 시간(분)은 설정값에서 읽는다. 읽지 못하면 임의 값으로 대신하지 않고 멈춘다.
  select (value #>> '{}')::integer into v_grace from public.settings where key = 'schedule_missed_grace_minutes';
  if v_grace is null then
    raise exception '설정값 schedule_missed_grace_minutes를 읽지 못했습니다.' using errcode = 'data_exception';
  end if;
  v_deadline := v_start + interval '8 hours' + make_interval(mins => v_grace);

  if p_now < v_deadline then
    return 'not_due';
  end if;

  -- 예약 점검 실행 기록이 하나라도 있으면(차단 포함) 시작은 한 것이다
  if exists (
    select 1 from public.check_runs
     where "trigger" = 'scheduled' and started_at >= v_start and started_at < v_start + interval '1 day'
  ) then
    return 'run_exists';
  end if;

  insert into public.run_logs (run_id, log_date, level, code, message)
  values (null, v_date, 'warn', 'SCHEDULE_MISSED',
          '예약 점검(KST 08:00)의 시작 기록이 확인 기한까지 없어 누락으로 기록했습니다.')
  on conflict (log_date) where code = 'SCHEDULE_MISSED' do nothing;
  get diagnostics v_rows = row_count;

  return case when v_rows > 0 then 'recorded' else 'already_recorded' end;
end;
$$;

revoke all on function public.mark_schedule_missed(timestamptz) from public, anon, authenticated;
grant execute on function public.mark_schedule_missed(timestamptz) to service_role;

comment on function public.mark_schedule_missed(timestamptz) is
  '예약 점검 누락 감지. 오늘(KST) 예약 실행 기록이 없고 확인 기한이 지났으면 SCHEDULE_MISSED를 날짜당 1줄 남긴다. 결과: not_due/run_exists/recorded/already_recorded. 서버 관리용 키와 Cron만 실행할 수 있다.';

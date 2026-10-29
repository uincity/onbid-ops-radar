-- R07: 예약 점검 누락 감지 DB 함수 mark_schedule_missed() (PLAN 32, PRD 5-2-5, DESIGN §5.4)
-- 매일 KST 09:30(UTC 00:30)에 Supabase Cron이 이 함수를 부른다. (Cron 등록은 npm run setup:cron — 비밀값·운영 주소가 필요해 마이그레이션에 넣지 않는다)
--
-- 하는 일: 오늘(KST) 예약 점검(scheduled)의 실행 기록이 하나도 없으면(blocked 포함) run_logs에 SCHEDULE_MISSED 1줄을 남긴다.
--   - 시작 확인 기한(예정 09:00 + 설정값 schedule_missed_grace_minutes, 기본 30분 = 09:30) 전에는 아무것도 하지 않는다 ('not_due').
--   - 날짜당 1건만 남는다 (run_logs_schedule_missed_per_day 유일 제약). 이미 있으면 'already_recorded'.
--   - 예약 점검이 blocked·partial·failed로 끝났더라도 "기록이 있음"이므로 누락으로 보지 않는다. 그 경고(SCHEDULE_INCOMPLETE)는 대시보드가 check_runs를 읽어 보여 준다.
-- p_now는 시험(pgTAP)에서 시각을 바꿔 보려는 인자다. 서버 관리용 키(service_role)와 Cron(postgres)만 실행할 수 있다.

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
  v_deadline := v_start + interval '9 hours' + make_interval(mins => v_grace);

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
          '예약 점검(KST 09:00)의 시작 기록이 확인 기한까지 없어 누락으로 기록했습니다.')
  on conflict (log_date) where code = 'SCHEDULE_MISSED' do nothing;
  get diagnostics v_rows = row_count;

  return case when v_rows > 0 then 'recorded' else 'already_recorded' end;
end;
$$;

revoke all on function public.mark_schedule_missed(timestamptz) from public, anon, authenticated;
grant execute on function public.mark_schedule_missed(timestamptz) to service_role;

comment on function public.mark_schedule_missed(timestamptz) is
  '예약 점검 누락 감지. 오늘(KST) 예약 실행 기록이 없고 확인 기한이 지났으면 SCHEDULE_MISSED를 날짜당 1줄 남긴다. 결과: not_due/run_exists/recorded/already_recorded. 서버 관리용 키와 Cron만 실행할 수 있다.';

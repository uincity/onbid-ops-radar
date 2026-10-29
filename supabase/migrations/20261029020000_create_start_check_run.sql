-- PLAN 작업 22: DB 함수 start_check_run — 점검 실행을 "안전하게 시작"하는 입구
-- Design Ref: DESIGN §5.1(1. 시작), §6.3(DB 함수), PRD 5-2 규칙 7(동시 실행 차단), 5-5(멈춘 실행 정리 stale_running_seconds)
--
-- 한 줄 설명
--   점검을 시작하기 전에 이 함수를 부른다. 함수가 한 트랜잭션 안에서 아래를 차례로 한다.
--     1) 시작한 지 stale_running_seconds(기본 120초)가 지난 'running'을 실패(시간 초과)로 마감한다. (멈춘 실행 정리)
--     2) 실행 중인 점검이 없으면 새 'running' 줄을 만들어 돌려준다.
--     3) 이미 실행 중이면 새 실행을 시작하지 않고, 'blocked' 줄 1개와 메모(RUN_BLOCKED)를 남기고 돌려준다.
--   동시에 두 곳에서 불러도 check_runs_only_one_running 제약 덕분에 한쪽만 'running'이 된다.
--
-- 누가 부르나: 서버의 점검 엔진(서버 관리용 키 = service_role)만. 로그인 사용자나 비로그인은 부를 수 없다.

create or replace function public.start_check_run(
  p_trigger      text,
  p_source       text,
  p_triggered_by uuid default null
)
returns table (out_run_id bigint, out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale_seconds integer;
  v_id            bigint;
begin
  -- 멈춘 실행을 정리하는 기준은 코드에 숫자를 쓰지 않고 settings에서 읽는다 (CLAUDE.md 설정값 규칙).
  -- 값이 없으면 기본값으로 대신하지 않고 멈춘다.
  select (s.value #>> '{}')::integer into v_stale_seconds
    from public.settings s
   where s.key = 'stale_running_seconds';
  if v_stale_seconds is null then
    raise exception 'stale_running_seconds 설정값이 없습니다' using errcode = 'P0001';
  end if;

  -- 1) 멈춘 실행 마감 + 메모 남기기
  with closed as (
    update public.check_runs
       set status = 'failed', finished_at = now()
     where status = 'running'
       and started_at < now() - make_interval(secs => v_stale_seconds)
    returning id
  )
  insert into public.run_logs (run_id, level, code, message)
  select id, 'error', 'RUN_STALE_CLOSED',
         '시작 후 ' || v_stale_seconds || '초가 지나도 끝나지 않아 실패(시간 초과)로 마감했습니다.'
    from closed;

  -- 2) 실행 중인 점검이 없으면 시작
  begin
    insert into public.check_runs ("trigger", source, triggered_by)
    values (p_trigger, p_source, p_triggered_by)
    returning id into v_id;

    return query select v_id, 'running'::text;
    return;
  exception when unique_violation then
    -- 3) 이미 실행 중 → 차단 기록만 남긴다 (동시 실행 차단, PRD 5-2 규칙 7)
    null;
  end;

  insert into public.check_runs ("trigger", source, status, finished_at, triggered_by)
  values (p_trigger, p_source, 'blocked', now(), p_triggered_by)
  returning id into v_id;

  insert into public.run_logs (run_id, level, code, message)
  values (v_id, 'warn', 'RUN_BLOCKED', '이미 점검이 실행 중이라 새 실행을 시작하지 않았습니다.');

  return query select v_id, 'blocked'::text;
end;
$$;

comment on function public.start_check_run(text, text, uuid) is
  '점검 시작 입구. 멈춘 running 정리 → 시작 또는 blocked 기록. 서버 관리용 키(service_role)만 실행할 수 있다.';

-- 실행 권한: 기본으로 모두에게 열려 있으므로 먼저 모두 닫고, 서버 관리용 키에게만 연다.
revoke all on function public.start_check_run(text, text, uuid) from public, anon, authenticated;
grant execute on function public.start_check_run(text, text, uuid) to service_role;

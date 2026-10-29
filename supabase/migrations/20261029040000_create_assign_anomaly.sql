-- PLAN 작업 26: DB 함수 assign_anomaly — 이상징후 담당자 배정(운영 담당자 자율 배정 / 팀장 지정·재배정)
-- Design Ref: DESIGN §6.3(DB 함수), §6.4(RLS), PRD 4-1·4-2(담당자 배정 방식), 5-3 규칙 5·6·7·8, 7-5 SEC-08
--
-- 한 줄 설명
--   사용자가 로그인한 권한으로 불러서 이상징후의 담당자를 정한다. 담당자 변경과 이력(assigned) 추가를 한 트랜잭션에서 한다.
--   처리상태는 바꾸지 않는다. (배정 뒤 [검토 시작]은 change_anomaly_status로 따로 한다)
--
-- 권한 규칙 (함수 안에서 auth.uid()와 profiles의 역할을 직접 확인한다)
--   · 로그인하지 않았거나 profiles에 없는 사용자                → FORBIDDEN
--   · operator : 담당자가 없는 건을 "본인에게만" 배정
--                남에게 배정하려 하면 FORBIDDEN, 이미 담당자가 있으면 ALREADY_ASSIGNED
--   · admin    : 존재하는 사용자 누구에게나 지정·재배정. 없는 사용자(또는 빈 값)면 INVALID_ASSIGNEE
--   · 이미 같은 담당자인데 다시 배정하는 것은 ALREADY_ASSIGNED (바뀌는 것이 없으므로 이력도 버전도 남기지 않는다)
--   · 종결(resolved/dismissed) 건의 배정도 허용한다: PRD는 배정이 상태를 바꾸지 않는다고만 하고 막지 않았다.
-- 확인 순서: 로그인·역할 → 건 존재(NOT_FOUND) → 권한(FORBIDDEN) → 버전(VERSION_CONFLICT) → 나머지 규칙
--   (권한 없는 사람에게는 건의 버전 같은 정보를 알려 주지 않으려고 권한을 먼저 본다)
-- 실패는 raise exception '코드' (SQLSTATE P0001)로 낸다. 코드 목록은 lib/anomalies/rpc.ts의 AnomalyActionErrorCode와 같다.

create or replace function public.assign_anomaly(
  p_id               bigint,
  p_assignee         uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_row     public.anomalies%rowtype;
  v_version integer;
begin
  -- 1. 누구인가 (로그인 + 역할)
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null or v_role not in ('operator', 'admin') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2. 건을 잠그고 읽는다 (같은 건을 동시에 배정하려는 요청은 한 줄로 선다)
  select * into v_row from public.anomalies a where a.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 3. 권한
  if v_role = 'operator' then
    -- 운영 담당자는 본인에게만 배정할 수 있다
    if p_assignee is distinct from v_uid then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  else
    -- 팀장은 존재하는 사용자에게만 배정할 수 있다
    if p_assignee is null or not exists (select 1 from public.profiles p where p.id = p_assignee) then
      raise exception 'INVALID_ASSIGNEE' using errcode = 'P0001';
    end if;
  end if;

  -- 4. 버전 (화면이 오래된 경우)
  if p_expected_version is distinct from v_row.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  -- 5. 나머지 규칙
  if v_row.assignee_id is not distinct from p_assignee then
    raise exception 'ALREADY_ASSIGNED' using errcode = 'P0001'; -- 바뀌는 것이 없음
  end if;
  if v_role = 'operator' and v_row.assignee_id is not null then
    raise exception 'ALREADY_ASSIGNED' using errcode = 'P0001'; -- 운영 담당자는 담당자 없는 건만 가져갈 수 있음
  end if;

  -- 6. 변경 + 이력 (같은 트랜잭션)
  update public.anomalies
     set assignee_id = p_assignee, version = version + 1
   where id = p_id
  returning version into v_version;

  insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value)
  values (p_id, 'user', v_uid, v_role, 'assigned', v_row.assignee_id::text, p_assignee::text);

  return v_version;
end;
$$;

comment on function public.assign_anomaly(bigint, uuid, integer) is
  '담당자 배정: 운영 담당자는 담당자 없는 건을 본인에게만, 팀장은 누구에게나 지정·재배정. 버전 확인·이력 추가를 한 트랜잭션으로 한다. 로그인 사용자(authenticated)만 실행.';

revoke all on function public.assign_anomaly(bigint, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.assign_anomaly(bigint, uuid, integer) to authenticated;

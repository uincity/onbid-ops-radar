-- PLAN 작업 27: DB 함수 set_verdict(판정만 변경)와 change_anomaly_status(처리상태 변경)
-- Design Ref: DESIGN §6.3(DB 함수·change_anomaly_status 세부 규칙), PRD 4-1, 5-3 규칙 1~8, 7-5 SEC-02·SEC-08·SEC-12
--
-- 한 줄 설명
--   사용자가 로그인한 권한으로 불러서 이상징후의 판정·처리상태를 바꾼다. 변경과 이력 추가를 한 트랜잭션에서 하고, 바뀌면 version을 1 올린다.
--
-- 권한 규칙 (함수 안에서 auth.uid()와 profiles의 역할을 직접 확인한다)
--   · 로그인하지 않았거나 profiles에 없는 사용자 → FORBIDDEN
--   · operator : "본인이 담당자인 건"만 판정·상태변경 가능. 담당자가 없거나 남의 건이면 FORBIDDEN
--                (미배정 건은 먼저 본인에게 배정해야 [검토 시작]을 할 수 있다 — PRD 4-1·4-2)
--   · admin    : 모든 건 가능. 이력에는 actor_role='admin'으로 남는다
-- 확인 순서: 로그인·역할 → 건 존재(NOT_FOUND) → 권한(FORBIDDEN) → 버전(VERSION_CONFLICT) → 나머지 규칙
-- 실패는 raise exception '코드' (SQLSTATE P0001)로 낸다. 코드 목록은 lib/anomalies/rpc.ts의 AnomalyActionErrorCode와 같다.

-- ---------------------------------------------------------------------------
-- 1. set_verdict : 검토 중(investigating)에서 판정만 바꾼다. 처리상태는 그대로.
--    · investigating이 아니면 NOT_INVESTIGATING
--    · 모르는 판정 값이거나 현재 판정과 같으면 VERDICT_MISMATCH (바뀌는 것이 없으면 이력·버전을 남기지 않는다)
-- ---------------------------------------------------------------------------
create or replace function public.set_verdict(
  p_id               bigint,
  p_verdict          text,
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
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null or v_role not in ('operator', 'admin') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from public.anomalies a where a.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 운영 담당자는 본인 담당 건만 (SEC-02, SEC-08)
  if v_role = 'operator' and v_row.assignee_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_expected_version is distinct from v_row.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  if v_row.status <> 'investigating' then
    raise exception 'NOT_INVESTIGATING' using errcode = 'P0001';
  end if;
  if p_verdict is null or p_verdict not in ('undetermined', 'confirmed_issue', 'false_positive')
     or p_verdict = v_row.verdict then
    raise exception 'VERDICT_MISMATCH' using errcode = 'P0001';
  end if;

  update public.anomalies
     set verdict = p_verdict, version = version + 1
   where id = p_id
  returning version into v_version;

  insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value)
  values (p_id, 'user', v_uid, v_role, 'verdict_changed', v_row.verdict, p_verdict);

  return v_version;
end;
$$;

comment on function public.set_verdict(bigint, text, integer) is
  '판정만 변경: 검토 중(investigating)에서만. 운영 담당자는 본인 담당 건만, 팀장은 모든 건. 이력(verdict_changed)을 같은 트랜잭션으로 추가. 로그인 사용자만 실행.';

revoke all on function public.set_verdict(bigint, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_verdict(bigint, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. change_anomaly_status : 처리상태를 바꾼다.
--    허용 전이(그 밖은 INVALID_TRANSITION, PRD 5-3 규칙 1)
--      open→investigating(검토 시작) / investigating→resolved / investigating→dismissed / resolved→investigating / dismissed→investigating(재개)
--    판정 짝(맞지 않으면 VERDICT_MISMATCH, 규칙 2)
--      resolved는 confirmed_issue, dismissed는 false_positive. p_verdict가 비어 있으면 현재 판정으로 본다(이미 set_verdict로 정해 둔 경우).
--      검토 시작은 판정을 바꾸지 않고, 재개는 undetermined로 되돌리므로 p_verdict는 비우거나 undetermined만 허용.
--    사유 p_note(규칙 2·3): 조치 완료·정상 판정·재개는 공백을 뺀 10자 이상이 아니면 REASON_TOO_SHORT. 검토 시작은 사유가 선택.
--    재개(규칙 3): 판정을 undetermined로 되돌리고 이전 판정은 이력에 남긴다. 같은 출처·물건·규칙의 열린 건이 이미 있으면
--                 ACTIVE_DUPLICATE_EXISTS:<그 건 번호>
--    이력: 판정이 함께 바뀌면 verdict_changed 1줄 + status_changed 1줄(사유 note는 status_changed에), 아니면 status_changed 1줄
-- ---------------------------------------------------------------------------
create or replace function public.change_anomaly_status(
  p_id               bigint,
  p_to_status        text,
  p_verdict          text,
  p_note             text,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_role        text;
  v_row         public.anomalies%rowtype;
  v_new_verdict text;
  v_note        text := nullif(btrim(p_note), '');
  v_dup_id      bigint;
  v_version     integer;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null or v_role not in ('operator', 'admin') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from public.anomalies a where a.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 운영 담당자는 본인 담당 건만 (SEC-02, SEC-08). 담당자가 없는 건도 거부한다.
  if v_role = 'operator' and v_row.assignee_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_expected_version is distinct from v_row.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  -- 허용되는 전이만 (PRD 5-3 규칙 1)
  -- (p_to_status가 비어 있으면 비교 결과가 null이 되므로 coalesce로 거부 쪽에 둔다)
  if coalesce((v_row.status, p_to_status) not in (
       ('open', 'investigating'),
       ('investigating', 'resolved'),
       ('investigating', 'dismissed'),
       ('resolved', 'investigating'),
       ('dismissed', 'investigating')
     ), true) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;

  -- 전이별 판정 짝
  if p_to_status = 'resolved' then
    v_new_verdict := coalesce(p_verdict, v_row.verdict);
    if v_new_verdict is distinct from 'confirmed_issue' then
      raise exception 'VERDICT_MISMATCH' using errcode = 'P0001';
    end if;
  elsif p_to_status = 'dismissed' then
    v_new_verdict := coalesce(p_verdict, v_row.verdict);
    if v_new_verdict is distinct from 'false_positive' then
      raise exception 'VERDICT_MISMATCH' using errcode = 'P0001';
    end if;
  elsif v_row.status = 'open' then
    -- 검토 시작: 판정은 아직 미판정이어야 하고 바뀌지 않는다
    if p_verdict is not null and p_verdict <> 'undetermined' then
      raise exception 'VERDICT_MISMATCH' using errcode = 'P0001';
    end if;
    v_new_verdict := v_row.verdict;
  else
    -- 재개: 판정은 undetermined로 되돌린다
    if p_verdict is not null and p_verdict <> 'undetermined' then
      raise exception 'VERDICT_MISMATCH' using errcode = 'P0001';
    end if;
    v_new_verdict := 'undetermined';
  end if;

  -- 조치 완료·정상 판정·재개는 공백 제외 10자 이상의 사유가 필요 (이력 제약과 같은 기준)
  if v_row.status <> 'open'
     and coalesce(char_length(regexp_replace(v_note, '\s', '', 'g')), 0) < 10 then
    raise exception 'REASON_TOO_SHORT' using errcode = 'P0001';
  end if;

  -- 재개할 때 같은 출처·물건·규칙의 열린 건이 이미 있으면 그 건으로 안내
  if v_row.status in ('resolved', 'dismissed') then
    select a.id into v_dup_id
      from public.anomalies a
     where a.source = v_row.source and a.item_key = v_row.item_key and a.rule_id = v_row.rule_id
       and a.status in ('open', 'investigating') and a.id <> p_id
     limit 1;
    if found then
      raise exception 'ACTIVE_DUPLICATE_EXISTS:%', v_dup_id using errcode = 'P0001';
    end if;
  end if;

  -- 변경 + 이력 (같은 트랜잭션)
  update public.anomalies
     set status = p_to_status, verdict = v_new_verdict, version = version + 1
   where id = p_id
  returning version into v_version;

  if v_new_verdict <> v_row.verdict then
    insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value, note)
    values (p_id, 'user', v_uid, v_role, 'verdict_changed', v_row.verdict, v_new_verdict,
            case when p_to_status = 'investigating' then '검토 재개로 판정을 초기화' end);
  end if;

  insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value, note)
  values (p_id, 'user', v_uid, v_role, 'status_changed', v_row.status, p_to_status, v_note);

  return v_version;
end;
$$;

comment on function public.change_anomaly_status(bigint, text, text, text, integer) is
  '처리상태 변경: 허용 전이·판정 짝·공백 제외 10자 사유·재개 시 열린 중복 건 확인. 운영 담당자는 본인 담당 건만, 팀장은 모든 건. 이력을 같은 트랜잭션으로 추가. 로그인 사용자만 실행.';

revoke all on function public.change_anomaly_status(bigint, text, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.change_anomaly_status(bigint, text, text, text, integer) to authenticated;

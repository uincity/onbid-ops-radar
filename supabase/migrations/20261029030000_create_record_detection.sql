-- PLAN 작업 23: DB 함수 record_detection — 탐지 결과를 이상징후로 "등록"하는 입구
-- Design Ref: DESIGN §5.1(5. 등록), §6.3(DB 함수), PRD 5-2 규칙 8(중복 탐지)·9(재발)·10(표현 원칙)
--
-- 한 줄 설명
--   탐지된 결과 1건(출처·물건·규칙)이 들어오면, 한 트랜잭션 안에서 아래 중 하나를 하고 이력(anomaly_events)을 같이 남긴다.
--     ① 같은 출처·물건·규칙의 열린(open/investigating) 건이 있다   → 새로 만들지 않고 탐지 횟수·마지막 탐지 시각만 갱신 (detected_again)
--     ② 없고, 가장 최근 종결 건이 dismissed(정상 판정)이며 원본 값 지문이 같다
--                                                                     → 새로 만들지 않고 횟수·시각만 갱신 (suppressed, 이력은 detected_again)
--     ③ 그 밖(처음 탐지 / resolved 뒤 재발 / 값이 바뀐 dismissed 뒤 재발)
--                                                                     → 새 건 생성. 종결 건이 있으면 previous_anomaly_id로 연결 (created / recurred)
--   새 건의 상태는 항상 open, 판정은 항상 undetermined(미판정)이다. 시스템이 찾은 사실과 사람의 판정을 구분한다. (PRD 5-2 규칙 10)
--   시스템이 갱신할 때는 version을 올리지 않는다. version은 사람이 같은 건을 동시에 고칠 때를 막는 번호라서, 자동 재탐지가 사용자의 저장을 방해하면 안 된다.
--
-- 누가 부르나: 서버의 점검 엔진(서버 관리용 키 = service_role)만. anomaly_events에는 직접 추가 권한을 아무에게도 주지 않았으므로
--              이 함수가 소유자 권한(SECURITY DEFINER)으로 이력 줄을 추가한다.

create or replace function public.record_detection(
  p_source     text,
  p_item_key   text,
  p_rule_id    text,
  p_evidence   jsonb,
  p_value_hash text
)
returns table (out_anomaly_id bigint, out_action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active   record;
  v_last     record;
  v_has_last boolean;
  v_id       bigint;
  v_count    integer;
begin
  -- 같은 출처·물건·규칙을 동시에 등록하려는 요청은 한 줄로 세운다 (동시에 두 건이 만들어지는 일을 막는 1차 장치.
  -- 최후의 장치는 anomalies_one_active_per_identity 제약이다)
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_source, '') || '|' || coalesce(p_item_key, '') || '|' || coalesce(p_rule_id, ''), 0));

  -- ① 열린 건이 있으면 횟수·시각만 갱신
  select a.id into v_active
    from public.anomalies a
   where a.source = p_source and a.item_key = p_item_key and a.rule_id = p_rule_id
     and a.status in ('open', 'investigating');
  if found then
    update public.anomalies
       set detect_count = detect_count + 1, last_detected_at = now()
     where id = v_active.id
    returning detect_count into v_count;

    insert into public.anomaly_events (anomaly_id, actor_type, event_type, from_value, to_value)
    values (v_active.id, 'system', 'detected_again', (v_count - 1)::text, v_count::text);

    return query select v_active.id, 'detected_again'::text;
    return;
  end if;

  -- 열린 건이 없으면 남은 건은 모두 종결(resolved/dismissed)이다. 그중 가장 최근 건이 비교 기준이다. (PRD 5-2 규칙 9)
  select a.id, a.status, a.value_hash into v_last
    from public.anomalies a
   where a.source = p_source and a.item_key = p_item_key and a.rule_id = p_rule_id
   order by a.id desc
   limit 1;
  v_has_last := found;

  -- ② 정상 판정(dismissed)한 건과 원본 값이 같으면 새 건을 만들지 않고 횟수만 기록
  if v_has_last and v_last.status = 'dismissed' and v_last.value_hash = p_value_hash then
    update public.anomalies
       set detect_count = detect_count + 1, last_detected_at = now()
     where id = v_last.id
    returning detect_count into v_count;

    insert into public.anomaly_events (anomaly_id, actor_type, event_type, from_value, to_value)
    values (v_last.id, 'system', 'detected_again', (v_count - 1)::text, v_count::text);

    return query select v_last.id, 'suppressed'::text;
    return;
  end if;

  -- ③ 새 건 생성. 종결 건이 있으면 재발로 연결한다.
  insert into public.anomalies (source, item_key, rule_id, evidence, value_hash, previous_anomaly_id)
  values (p_source, p_item_key, p_rule_id, coalesce(p_evidence, '{}'::jsonb), p_value_hash,
          case when v_has_last then v_last.id end)
  returning id into v_id;

  insert into public.anomaly_events (anomaly_id, actor_type, event_type, from_value, to_value, note)
  values (v_id, 'system', 'created', null, 'open',
          case when v_has_last then '재발: 이전 이상징후 #' || v_last.id || '(' || v_last.status || ')와 연결' end);

  return query select v_id, (case when v_has_last then 'recurred' else 'created' end)::text;
end;
$$;

comment on function public.record_detection(text, text, text, jsonb, text) is
  '탐지 결과 등록: 열린 건 갱신 / 정상 판정 건과 같은 값이면 억제 / 그 밖은 새 건(재발 연결). 서버 관리용 키(service_role)만 실행할 수 있다.';

-- 실행 권한: 기본으로 모두에게 열려 있으므로 먼저 모두 닫고, 서버 관리용 키에게만 연다.
revoke all on function public.record_detection(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_detection(text, text, text, jsonb, text) to service_role;

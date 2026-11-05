-- 홈페이지 가용성 모니터링 W10a: 알림 테이블 2개와 상태 전환·알림 DB 함수, 기존 이상징후 표의 WEB 출처 허용
-- Design Ref: docs/design-homepage-monitoring.md §5.3·§5.4·§6.1·§6.3·§6.4 / Plan W10a
--
-- 만드는 것
--   web_notification_keys : 알림 멱등 키 선점 (추가 전용). 같은 키는 한 번만 만들어진다
--   web_notifications     : 알림 줄 — 대기(queued, attempt 0)와 발송 시도(sent/failed, attempt 1~5)를 한 줄씩 추가 (추가 전용)
--   claim_notification            : 키 선점 + 대기 줄 만들기 (성공 여부 반환)
--   record_notification_attempt   : 발송 시도 한 줄 추가
--   record_recovery_event         : 이상징후 이력에 '복구 확인됨(recovered)' 추가 (열린 WEB 이상징후에만)
--   record_web_transition         : 상태 전환 한 트랜잭션 (대상별 잠금 → 버전 충돌이면 CONFLICT → 상태 갱신 → 이상징후 → 복구 → 알림 키 선점 → 확정 판정 채움)
-- 바꾸는 기존 제약 3개: anomalies.source(WEB 허용), anomalies.rule_id(WEB_AVAILABILITY·WEB_FRESHNESS 허용), anomaly_events 사건 종류(recovered 허용; 모양·행위자 검사 포함)
-- 이 파일이 만들지 않는 것(뒤 작업): 상태 전환 판단(decide, W10), 재확인 큐 흐름(W11), 발송(W12), 계획 점검 창(W15), 자체 감시(W16), 일별 요약(W19)
-- 규칙: 읽기는 로그인 사용자만, 쓰기는 아래 DB 함수만(서버 관리용 키도 표에 직접 쓰지 못함). 새 함수는 서버 관리용 키(service_role)만 실행할 수 있다.

-- ===========================================================================
-- A. 기존 이상징후 표·이력 표 확장 (제약 3개)
-- ===========================================================================
alter table public.anomalies drop constraint anomalies_source_check;
alter table public.anomalies add constraint anomalies_source_check
  check (source in ('DEMO', 'PUBLIC', 'WEB'));

alter table public.anomalies drop constraint anomalies_rule_id_check;
alter table public.anomalies add constraint anomalies_rule_id_check
  check (rule_id in (
    -- 이전 규칙 (기존 기록·DEMO 회귀 테스트 보존)
    'DATE_ORDER', 'REQUIRED_FIELD', 'LIST_DETAIL_MISMATCH', 'EMPTY_RESULT',
    -- 데이터 품질 핵심 4규칙 (PRD 5-2A)
    'DQ_SCHEMA', 'DQ_REQUIRED', 'DQ_LIST_DETAIL_REF', 'DQ_CROSS_API_REF',
    -- API 상태 이상징후
    'API_HTTP_ERROR', 'API_TIMEOUT', 'API_BUSINESS_ERROR', 'API_SCHEMA_ERROR', 'API_POSITIVE_DATA_MISSING', 'API_AUTH_ERROR', 'API_QUOTA_EXCEEDED',
    -- 홈페이지 가용성 모니터링 (WEB_FRESHNESS는 M3에서 쓴다)
    'WEB_AVAILABILITY', 'WEB_FRESHNESS'
  ));

-- 이력: 사건 종류에 recovered(복구 확인됨)를 더한다. 시스템이 남기는 기록이고, 사건 번호를 to_value에 적는다 (상태는 바뀌지 않는다)
alter table public.anomaly_events drop constraint anomaly_events_event_type_check;
alter table public.anomaly_events add constraint anomaly_events_event_type_check
  check (event_type in ('created', 'detected_again', 'assigned', 'status_changed', 'verdict_changed', 'recovered'));

alter table public.anomaly_events drop constraint anomaly_events_actor_matches_event_check;
alter table public.anomaly_events add constraint anomaly_events_actor_matches_event_check
  check ((event_type in ('created', 'detected_again', 'recovered')) = (actor_type = 'system'));

alter table public.anomaly_events drop constraint anomaly_events_values_check;
alter table public.anomaly_events add constraint anomaly_events_values_check
  check (
    coalesce(
      case event_type
        when 'created' then
          from_value is null and to_value = 'open'
        when 'detected_again' then
          from_value ~ '^[0-9]{1,9}$' and to_value ~ '^[0-9]{1,9}$'
        when 'assigned' then
          to_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (from_value is null or from_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          and from_value is distinct from to_value
        when 'status_changed' then
          (from_value, to_value) in (
            ('open', 'investigating'),
            ('investigating', 'resolved'),
            ('investigating', 'dismissed'),
            ('resolved', 'investigating'),
            ('dismissed', 'investigating')
          )
        when 'verdict_changed' then
          from_value in ('undetermined', 'confirmed_issue', 'false_positive')
          and to_value in ('undetermined', 'confirmed_issue', 'false_positive')
          and from_value <> to_value
        when 'recovered' then
          from_value is null and to_value ~ '^[0-9]{1,9}$'
      end,
      false
    )
  );

-- 같은 이상징후에 같은 사건 번호의 복구 확인을 두 번 적지 않는다
create unique index anomaly_events_one_recovered_per_incident
  on public.anomaly_events (anomaly_id, to_value)
  where event_type = 'recovered';

-- ===========================================================================
-- B. web_notification_keys : 알림 멱등 키 (추가 전용)
-- ===========================================================================
create table public.web_notification_keys (
  key          text        primary key,
  kind         text        not null,
  target_key   text        not null,
  incident_no  integer,
  created_at   timestamptz not null default now(),

  -- 종류 11가지: 설계서 5.4의 멱등 키 모양과 같다
  constraint web_notification_keys_kind_check
    check (kind in ('down', 'degraded', 'recovered', 'ongoing', 'cert', 'unverifiable', 'unplanned', 'aux', 'suppressed', 'stale', 'resumed')),
  -- 키는 "종류:" 로 시작한다 (예: down:3, ongoing:3:2, cert:onbid-home:2026-11-05)
  constraint web_notification_keys_shape_check
    check (char_length(key) between 3 and 200 and key like kind || ':%' and key !~ '\s'),
  constraint web_notification_keys_target_check
    check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_notification_keys_incident_check
    check (incident_no is null or incident_no >= 1),
  -- 알림 줄이 키와 종류·대상이 어긋나지 않게 묶는 바탕
  constraint web_notification_keys_identity_key
    unique (key, kind, target_key)
);

comment on table public.web_notification_keys is '알림 멱등 키 선점. 같은 키는 한 번만 만들어진다. 추가 전용(수정·삭제·비우기 불가).';

-- ===========================================================================
-- C. web_notifications : 알림 줄 (대기·시도). 키마다 마지막 줄이 그 알림의 현재 상태다 (추가 전용)
-- ===========================================================================
create table public.web_notifications (
  id             bigint generated always as identity primary key,
  key            text        not null,
  -- 0 = 대기(queued, 키 선점 직후), 1~5 = 발송 시도
  attempt        smallint    not null,
  -- 대기 줄은 아직 채널이 정해지지 않았다(WEB_NOTIFY_MODE는 발송할 때 정한다)
  channel        text,
  kind           text        not null,
  target_key     text        not null,
  status         text        not null,
  response_code  integer,
  -- 감시 함수(pg_net) 알림의 요청 번호
  net_request_id bigint,
  -- 오류의 분류 이름만 (내부 문구·토큰·응답 본문 금지)
  error_class    text,
  -- 메시지를 만들 때 쓰는 값 (지속 시간, 판정 등). 비밀값·응답 본문 금지, 2KB 이하
  payload        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint web_notifications_key_fkey
    foreign key (key, kind, target_key) references public.web_notification_keys (key, kind, target_key),
  constraint web_notifications_attempt_check
    check (attempt between 0 and 5),
  constraint web_notifications_status_check
    check (status in ('queued', 'sent', 'failed')),
  constraint web_notifications_queued_check
    check ((attempt = 0) = (status = 'queued')),
  constraint web_notifications_channel_check
    check ((attempt = 0 and channel is null) or (attempt >= 1 and channel in ('telegram', 'log'))),
  constraint web_notifications_response_code_check
    check (response_code is null or (attempt >= 1 and response_code between 100 and 599)),
  constraint web_notifications_error_class_check
    check (error_class is null or (status = 'failed' and error_class ~ '^[a-z0-9_]{1,40}$')),
  constraint web_notifications_payload_check
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2048),
  constraint web_notifications_attempt_once_key
    unique (key, attempt)
);

comment on table public.web_notifications is '알림 줄. 시도마다 한 줄 추가(수정 불가), 키마다 마지막 줄이 현재 상태. 추가 전용.';

create index web_notifications_key_idx on public.web_notifications (key, attempt desc);
create index web_notifications_recent_idx on public.web_notifications (created_at desc);

-- ===========================================================================
-- D. 추가 전용 장치 + 출입 규칙 (RLS)
-- ===========================================================================
create or replace function public.web_notifications_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '알림 키·알림 기록은 추가만 가능하며 수정·삭제·비우기는 할 수 없습니다.'
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger web_notification_keys_no_update_delete
  before update or delete on public.web_notification_keys
  for each row execute function public.web_notifications_block_change();
create trigger web_notification_keys_no_truncate
  before truncate on public.web_notification_keys
  for each statement execute function public.web_notifications_block_change();
create trigger web_notifications_no_update_delete
  before update or delete on public.web_notifications
  for each row execute function public.web_notifications_block_change();
create trigger web_notifications_no_truncate
  before truncate on public.web_notifications
  for each statement execute function public.web_notifications_block_change();

alter table public.web_notification_keys enable row level security;
alter table public.web_notifications enable row level security;

-- 비로그인·로그인 사용자·서버 관리용 키 모두 기본 권한을 거두고, 읽기만 다시 준다. 추가는 소유자 권한 DB 함수만 한다.
revoke all on public.web_notification_keys, public.web_notifications from anon, authenticated, service_role;
grant select on public.web_notification_keys, public.web_notifications to authenticated, service_role;

create policy "로그인 사용자는 web_notification_keys를 읽을 수 있다"
  on public.web_notification_keys for select to authenticated using (true);
create policy "로그인 사용자는 web_notifications를 읽을 수 있다"
  on public.web_notifications for select to authenticated using (true);

-- ===========================================================================
-- E. claim_notification : 키 선점 + 대기 줄 만들기
-- ===========================================================================
create or replace function public.claim_notification(
  p_key            text,
  p_kind           text,
  p_target_key     text,
  p_incident_no    integer default null,
  p_payload        jsonb default '{}'::jsonb,
  p_net_request_id bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.web_notification_keys (key, kind, target_key, incident_no)
  values (p_key, p_kind, p_target_key, p_incident_no)
  on conflict (key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false; -- 이미 선점된 키: 같은 알림의 중복은 막는다
  end if;

  insert into public.web_notifications (key, attempt, channel, kind, target_key, status, net_request_id, payload)
  values (p_key, 0, null, p_kind, p_target_key, 'queued', p_net_request_id, coalesce(p_payload, '{}'::jsonb));
  return true;
end;
$$;

comment on function public.claim_notification(text, text, text, integer, jsonb, bigint) is
  '알림 키 선점과 대기(queued) 줄 생성을 한 번에 한다. 선점했으면 true, 이미 있으면 false. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- F. record_notification_attempt : 발송 시도 한 줄 추가
-- ===========================================================================
create or replace function public.record_notification_attempt(
  p_key            text,
  p_attempt        integer,
  p_channel        text,
  p_status         text,
  p_response_code  integer default null,
  p_error_class    text default null,
  p_net_request_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key    record;
  v_last   integer;
  v_sent   boolean;
begin
  if p_status not in ('sent', 'failed') then
    raise exception '시도 결과는 sent 또는 failed여야 합니다' using errcode = '22023';
  end if;

  -- 같은 키의 시도를 동시에 적지 않게 한 줄로 세운다
  perform pg_advisory_xact_lock(hashtextextended('web_notify|' || coalesce(p_key, ''), 0));

  select k.kind, k.target_key into v_key from public.web_notification_keys k where k.key = p_key;
  if not found then
    raise exception '선점되지 않은 알림 키입니다' using errcode = 'P0002';
  end if;

  select max(n.attempt), coalesce(bool_or(n.status = 'sent'), false) into v_last, v_sent
    from public.web_notifications n where n.key = p_key;
  if v_sent then
    raise exception '이미 발송된 알림에는 시도를 더할 수 없습니다' using errcode = 'integrity_constraint_violation';
  end if;
  if p_attempt is distinct from v_last + 1 then
    raise exception '시도 번호는 마지막 시도 다음 번호여야 합니다' using errcode = 'integrity_constraint_violation';
  end if;

  insert into public.web_notifications (key, attempt, channel, kind, target_key, status, response_code, net_request_id, error_class)
  values (p_key, p_attempt, p_channel, v_key.kind, v_key.target_key, p_status, p_response_code, p_net_request_id, p_error_class);
end;
$$;

comment on function public.record_notification_attempt(text, integer, text, text, integer, text, bigint) is
  '발송 시도 한 줄 추가. 시도 번호는 마지막 다음 번호만, 이미 sent가 있으면 거부. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- G. record_recovery_event : 이상징후 이력에 '복구 확인됨' 추가
-- ===========================================================================
create or replace function public.record_recovery_event(
  p_anomaly_id  bigint,
  p_incident_no integer,
  p_note        text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a  record;
  v_id bigint;
begin
  select a.source, a.status into v_a from public.anomalies a where a.id = p_anomaly_id for share;
  if not found then
    raise exception '이상징후를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if v_a.source <> 'WEB' then
    raise exception '홈페이지(WEB) 이상징후에만 복구 확인을 기록할 수 있습니다' using errcode = 'integrity_constraint_violation';
  end if;
  -- 복구는 열린 이상징후에만 기록한다 (이미 종결된 건의 이력은 건드리지 않는다)
  if v_a.status not in ('open', 'investigating') then
    raise exception '종결된 이상징후에는 복구 확인을 기록할 수 없습니다' using errcode = 'integrity_constraint_violation';
  end if;

  insert into public.anomaly_events (anomaly_id, actor_type, event_type, from_value, to_value, note)
  values (p_anomaly_id, 'system', 'recovered', null, p_incident_no::text, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.record_recovery_event(bigint, integer, text) is
  '이상징후 이력에 recovered(복구 확인됨)를 추가한다. 열린 WEB 이상징후에만, 같은 사건 번호는 한 번만. 상태는 바꾸지 않는다. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- H. record_web_transition : 상태 전환 한 트랜잭션
-- 입력(p_decision, 앱의 decide가 만든 JSON):
--   state         : 새 상태 전체 (current_verdict·since 필수, 나머지는 칸 이름 그대로; open_anomaly_id는 이 함수가 정한다)
--   detection     : null 또는 { evidence, value_hash }  → record_detection('WEB', 대상, 'WEB_AVAILABILITY', …)
--   recovery      : null 또는 { note, incident_no }      → 지금 열린 이상징후에 recovered 기록 (이미 종결됐으면 건너뜀)
--   notifications : [ { key, kind, incident_no, payload } ] → 키 선점에 성공한 것만 queued 줄이 생김
--   confirm       : null 또는 { origin_run_id, confirmed_verdict, flap } → 원래 정시 실행의 확정 판정 채움(비어 있을 때만)
-- 출력: { result: 'OK'|'CONFLICT', version, anomaly_id, anomaly_action, recovered, claimed[], confirmed }
-- p_expected_version: 앱이 읽어 간 상태 버전. 상태 줄이 아직 없으면 null. 다르면 아무것도 저장하지 않고 CONFLICT를 돌려준다.
-- ===========================================================================
create or replace function public.record_web_transition(
  p_run_id           bigint,
  p_target_key       text,
  p_expected_version integer,
  p_decision         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run         record;
  v_cur         record;
  v_has         boolean;
  v_state       jsonb;
  v_det         jsonb;
  v_rec         jsonb;
  v_conf        jsonb;
  v_n           jsonb;
  v_old_anomaly bigint;
  v_anomaly_id  bigint;
  v_action      text;
  v_status      text;
  v_version     integer;
  v_recovered   boolean := false;
  v_confirmed   boolean := false;
  v_claimed     text[] := '{}';
  v_rows        integer;
begin
  if p_decision is null or jsonb_typeof(p_decision) <> 'object' or jsonb_typeof(p_decision -> 'state') is distinct from 'object' then
    raise exception '결정(decision)에는 state 객체가 있어야 합니다' using errcode = '22023';
  end if;

  -- ① 대상별 잠금: 같은 대상의 전환은 한 줄로 세운다
  perform pg_advisory_xact_lock(hashtextextended('web_state|' || coalesce(p_target_key, ''), 0));

  select r.target_key, r."trigger", r.status into v_run from public.web_check_runs r where r.id = p_run_id;
  if not found or v_run.target_key is distinct from p_target_key then
    raise exception '점검 실행을 찾을 수 없거나 대상이 다릅니다' using errcode = 'P0002';
  end if;
  -- 수동 점검은 상태·사건·알림을 바꾸지 않는다. 끝나지 않은 실행도 거부한다
  if v_run."trigger" = 'manual' then
    raise exception '수동 점검은 상태를 바꿀 수 없습니다' using errcode = 'integrity_constraint_violation';
  end if;
  if v_run.status not in ('succeeded', 'partial') then
    raise exception '정상 종료된 실행만 상태를 바꿀 수 있습니다' using errcode = 'integrity_constraint_violation';
  end if;

  select * into v_cur from public.web_target_state s where s.target_key = p_target_key for update;
  v_has := found;
  if (v_has and p_expected_version is distinct from v_cur.version) or (not v_has and p_expected_version is not null) then
    return jsonb_build_object('result', 'CONFLICT', 'version', case when v_has then v_cur.version end);
  end if;

  v_state := p_decision -> 'state';
  v_det := p_decision -> 'detection';
  v_rec := p_decision -> 'recovery';
  v_conf := p_decision -> 'confirm';
  v_old_anomaly := case when v_has then v_cur.open_anomaly_id end;
  v_anomaly_id := v_old_anomaly;

  -- ③ 이상징후 생성/발생 추가 (출처 WEB). 정상 판정으로 닫은 건과 같은 값이면 새 건이 없으므로(suppressed) 열린 건은 없다
  if jsonb_typeof(v_det) = 'object' then
    select d.out_anomaly_id, d.out_action into v_anomaly_id, v_action
      from public.record_detection('WEB', p_target_key, 'WEB_AVAILABILITY', coalesce(v_det -> 'evidence', '{}'::jsonb), v_det ->> 'value_hash') d;
    if v_action = 'suppressed' then
      v_anomaly_id := null;
    end if;
  end if;

  -- ④ 복구: 지금 열린 이상징후에 '복구 확인됨'. 담당자가 이미 닫았다면 이력을 건드리지 않고 건너뛴다
  if jsonb_typeof(v_rec) = 'object' then
    if v_old_anomaly is not null then
      select a.status into v_status from public.anomalies a where a.id = v_old_anomaly;
      if v_status in ('open', 'investigating') then
        perform public.record_recovery_event(v_old_anomaly, coalesce((v_rec ->> 'incident_no')::integer, v_cur.incident_no), v_rec ->> 'note');
        v_recovered := true;
      end if;
    end if;
    if jsonb_typeof(v_det) is distinct from 'object' then
      v_anomaly_id := null; -- 사건이 끝났으니 열린 이상징후 연결을 비운다
    end if;
  end if;

  -- ② 상태 갱신 (버전 +1). 값이 규칙(표 제약)에 어긋나면 여기서 오류가 나 전체가 취소된다
  v_version := case when v_has then v_cur.version + 1 else 1 end;
  insert into public.web_target_state (
    target_key, current_verdict, since, first_failure_at, incident_no, incident_open, incident_last_alert_at, ongoing_count, open_anomaly_id,
    consecutive_degraded, degraded_start_run_id, consecutive_unverifiable, unverifiable_start_run_id, aux_state,
    unplanned_since_run_id, unplanned_since, alerts_today, alerts_today_date, version
  ) values (
    p_target_key, v_state ->> 'current_verdict', (v_state ->> 'since')::timestamptz, (v_state ->> 'first_failure_at')::timestamptz,
    coalesce((v_state ->> 'incident_no')::integer, 0), coalesce((v_state ->> 'incident_open')::boolean, false),
    (v_state ->> 'incident_last_alert_at')::timestamptz, coalesce((v_state ->> 'ongoing_count')::integer, 0), v_anomaly_id,
    coalesce((v_state ->> 'consecutive_degraded')::integer, 0), (v_state ->> 'degraded_start_run_id')::bigint,
    coalesce((v_state ->> 'consecutive_unverifiable')::integer, 0), (v_state ->> 'unverifiable_start_run_id')::bigint,
    coalesce(v_state -> 'aux_state', '{}'::jsonb),
    (v_state ->> 'unplanned_since_run_id')::bigint, (v_state ->> 'unplanned_since')::timestamptz,
    coalesce((v_state ->> 'alerts_today')::integer, 0), (v_state ->> 'alerts_today_date')::date, v_version
  )
  on conflict (target_key) do update set
    current_verdict = excluded.current_verdict, since = excluded.since, first_failure_at = excluded.first_failure_at,
    incident_no = excluded.incident_no, incident_open = excluded.incident_open, incident_last_alert_at = excluded.incident_last_alert_at,
    ongoing_count = excluded.ongoing_count, open_anomaly_id = excluded.open_anomaly_id,
    consecutive_degraded = excluded.consecutive_degraded, degraded_start_run_id = excluded.degraded_start_run_id,
    consecutive_unverifiable = excluded.consecutive_unverifiable, unverifiable_start_run_id = excluded.unverifiable_start_run_id,
    aux_state = excluded.aux_state, unplanned_since_run_id = excluded.unplanned_since_run_id, unplanned_since = excluded.unplanned_since,
    alerts_today = excluded.alerts_today, alerts_today_date = excluded.alerts_today_date, version = excluded.version;

  -- ⑤ 알림 키 선점 + 대기 줄 (선점에 성공한 것만 돌려준다)
  for v_n in select e from jsonb_array_elements(coalesce(p_decision -> 'notifications', '[]'::jsonb)) as t(e) loop
    if public.claim_notification(v_n ->> 'key', v_n ->> 'kind', p_target_key, nullif(v_n ->> 'incident_no', '')::integer, coalesce(v_n -> 'payload', '{}'::jsonb)) then
      v_claimed := v_claimed || (v_n ->> 'key');
    end if;
  end loop;

  -- 재확인 결과 반영: 원래 정시 실행의 확정 판정·flap을 채운다 (비어 있을 때만)
  if jsonb_typeof(v_conf) = 'object' then
    update public.web_check_runs r
       set confirmed_verdict = v_conf ->> 'confirmed_verdict', flap = coalesce((v_conf ->> 'flap')::boolean, false)
     where r.id = (v_conf ->> 'origin_run_id')::bigint
       and r.target_key = p_target_key
       and r."trigger" = 'scheduled'
       and r.confirmed_verdict is null;
    get diagnostics v_rows = row_count;
    v_confirmed := v_rows > 0;
  end if;

  return jsonb_build_object(
    'result', 'OK', 'version', v_version, 'anomaly_id', v_anomaly_id, 'anomaly_action', v_action,
    'recovered', v_recovered, 'claimed', to_jsonb(v_claimed), 'confirmed', v_confirmed
  );
end;
$$;

comment on function public.record_web_transition(bigint, text, integer, jsonb) is
  '홈페이지 상태 전환을 한 트랜잭션으로 저장한다(대상별 잠금, 버전이 다르면 CONFLICT, 이상징후·복구·알림 키 선점·확정 판정). 수동 점검은 거부. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- I. 실행 권한: 기본으로 모두에게 열려 있으므로 먼저 모두 닫고, 서버 관리용 키에게만 연다.
-- ===========================================================================
revoke all on function public.claim_notification(text, text, text, integer, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.record_notification_attempt(text, integer, text, text, integer, text, bigint) from public, anon, authenticated;
revoke all on function public.record_recovery_event(bigint, integer, text) from public, anon, authenticated;
revoke all on function public.record_web_transition(bigint, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.web_notifications_block_change() from public, anon, authenticated;
grant execute on function public.claim_notification(text, text, text, integer, jsonb, bigint) to service_role;
grant execute on function public.record_notification_attempt(text, integer, text, text, integer, text, bigint) to service_role;
grant execute on function public.record_recovery_event(bigint, integer, text) to service_role;
grant execute on function public.record_web_transition(bigint, text, integer, jsonb) to service_role;

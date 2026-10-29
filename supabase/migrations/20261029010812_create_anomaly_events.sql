-- PLAN 작업 10: 추가만 가능한 이벤트 이력(감사이력) 테이블(anomaly_events)
-- Design Ref: DESIGN §6.1(anomaly_events), §6.3(DB 함수), §6.4(RLS), PRD 4-6(이력은 이벤트를 추가), 5-3(전이·종결 조건·트랜잭션),
--             7-4(감사이력은 수정·삭제 금지), 7-5 SEC-05(이력 조작 방지)
--
-- 한 줄 설명: 이상징후에 일어난 일(생성·재탐지·배정·상태변경·판정)을 "누가, 언제, 무엇을 무엇으로" 한 줄씩 남기는 장부.
-- 장부는 이어 적기만 할 수 있다. 한번 적은 줄은 누구도(관리용 키를 포함해) 고치거나 지우거나 비울 수 없다. (SEC-05)
-- 줄을 추가하는 것도 DB 함수(PLAN 23·26·27번)만 한다. 이 함수들은 소유자 권한(SECURITY DEFINER)으로 실행되도록 만든다.

-- ---------------------------------------------------------------------------
-- 1. anomaly_events : 이상징후 이력 1줄
-- ---------------------------------------------------------------------------
create table public.anomaly_events (
  id           bigint generated always as identity primary key,
  anomaly_id   bigint      not null references public.anomalies (id),

  -- 누가: 시스템(자동 탐지) 또는 사용자(담당자·팀장)
  actor_type   text        not null,
  actor_id     uuid        references public.profiles (id),
  -- 그 사용자가 행동한 "당시의" 역할. 이력에는 팀장이 처리한 것으로 기록해야 하므로(PRD 5-3 규칙 8)
  -- 나중에 역할이 바뀌어도 당시 역할이 남도록 따로 적는다.
  actor_role   text,

  -- 무엇을: created(생성) / detected_again(재탐지) / assigned(배정·재배정) / status_changed(상태변경) / verdict_changed(판정변경)
  event_type   text        not null,
  -- 무엇에서 무엇으로: 상태·판정은 값 그대로, 담당자는 사용자 ID, 재탐지는 탐지 횟수
  from_value   text,
  to_value     text,
  -- 사유·조치내용
  note         text,
  created_at   timestamptz not null default now(),

  constraint anomaly_events_actor_check
    check (
      (actor_type = 'system' and actor_id is null and actor_role is null)
      or (actor_type = 'user' and actor_id is not null and actor_role in ('operator', 'admin'))
    ),
  constraint anomaly_events_event_type_check
    check (event_type in ('created', 'detected_again', 'assigned', 'status_changed', 'verdict_changed')),
  -- 자동 탐지가 한 일(생성·재탐지)은 시스템, 사람이 한 일(배정·상태변경·판정)은 사용자로만 기록한다.
  -- "시스템이 탐지한 사실"과 "담당자가 내린 판정"을 구분하기 위함이다. (PRD 5-2 규칙 10)
  constraint anomaly_events_actor_matches_event_check
    check ((event_type in ('created', 'detected_again')) = (actor_type = 'system')),
  -- 이벤트 종류별로 "무엇에서 무엇으로"의 모양이 맞아야 한다. 허용된 상태 전이만 기록할 수 있다. (PRD 5-3 규칙 1)
  -- (값이 비어 있어 판단할 수 없는 경우도 거부하려고 coalesce로 감쌌다)
  constraint anomaly_events_values_check
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
        end,
        false
      )
    ),
  -- 조치 완료·정상 판정으로 닫거나 검토를 재개할 때는 사유가 공백을 뺀 10자 이상이어야 한다. (PRD 5-3 규칙 2·3)
  constraint anomaly_events_reason_required_check
    check (
      event_type <> 'status_changed'
      or (to_value not in ('resolved', 'dismissed') and not (from_value in ('resolved', 'dismissed') and to_value = 'investigating'))
      or coalesce(char_length(regexp_replace(note, '\s', '', 'g')) >= 10, false)
    ),
  constraint anomaly_events_note_length_check
    check (note is null or char_length(note) <= 2000),
  -- 인증키가 이력에 그대로 남지 않게 막는다. (PRD 7-3 규칙 6·7)
  constraint anomaly_events_no_service_key_check
    check (note is null or note !~* 'servicekey=(?!\*)')
);

comment on table public.anomaly_events is '이상징후 이력(감사이력). 추가만 가능하고 수정·삭제·비우기는 누구도 할 수 없다(SEC-05).';
comment on column public.anomaly_events.actor_role is '행동한 당시의 역할(operator/admin). 팀장이 처리한 것도 기록으로 구분된다.';

create index anomaly_events_anomaly_idx on public.anomaly_events (anomaly_id, created_at, id);
create index anomaly_events_created_at_idx on public.anomaly_events (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. 추가만 가능: 수정·삭제·비우기를 DB가 직접 막는다. (SEC-05)
--    권한을 거두는 것(아래 3번)과 별개로, 소유자 권한으로 실행해도 막히도록 장치를 한 번 더 건다.
-- ---------------------------------------------------------------------------
create or replace function public.anomaly_events_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '이력(anomaly_events)은 추가만 가능하며 수정·삭제·비우기는 할 수 없습니다.'
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger anomaly_events_no_update_delete
  before update or delete on public.anomaly_events
  for each row execute function public.anomaly_events_block_change();

create trigger anomaly_events_no_truncate
  before truncate on public.anomaly_events
  for each statement execute function public.anomaly_events_block_change();

-- ---------------------------------------------------------------------------
-- 3. 출입 규칙 (RLS) 과 권한 — "로그인 사용자 읽기, 추가는 DB 함수만, 수정·삭제는 아무도 못 함" (DESIGN 6.3·6.4)
-- ---------------------------------------------------------------------------
alter table public.anomaly_events enable row level security;

-- 비로그인(anon), 로그인 사용자(authenticated), 서버 관리용 키(service_role) 모두 기본 권한을 거둔다.
-- 읽기만 다시 준다. 추가(insert)는 아무에게도 주지 않는다: 소유자 권한으로 실행되는 DB 함수만 줄을 추가한다.
revoke all on public.anomaly_events from anon, authenticated, service_role;
grant select on public.anomaly_events to authenticated, service_role;

create policy "로그인 사용자는 anomaly_events를 읽을 수 있다"
  on public.anomaly_events for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.

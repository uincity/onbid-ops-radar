-- PLAN 작업 9: 이상징후 테이블(anomalies)
-- Design Ref: DESIGN §6.1(anomalies), §6.2(관계), §6.3(DB 함수), §6.4(RLS), §5.1(5단계 등록 규칙),
--             PRD 4-3(처리상태·판정), 5-2 규칙 8~10(중복·재발·표현 원칙), 5-3(전이·종결 조건·버전)
--
-- 한 줄 설명: 탐지 규칙이 찾아낸 "이상징후"를 한 건씩 적는 표. 처리 상태·판정·담당자·재발 연결이 여기에 모인다.
-- 이 표의 줄은 DB 함수(PLAN 22·23·26·27번)로만 바꾼다. 로그인 사용자는 읽기만 하고 직접 수정할 수 없다. (DESIGN 6.4)

-- ---------------------------------------------------------------------------
-- 1. anomalies : 이상징후 1건
-- ---------------------------------------------------------------------------
create table public.anomalies (
  id                  bigint generated always as identity primary key,

  -- "무엇이" 이상한가: 출처 + 물건 + 탐지 규칙. 이 세 가지로 같은 이상징후인지 가린다. (PRD 5-2 규칙 8)
  source              text        not null,
  item_key            text        not null,
  rule_id             text        not null,

  -- 처리 상태: open(미확인) / investigating(검토 중) / resolved(조치 완료) / dismissed(정상 판정)
  status              text        not null default 'open',
  -- 판정 결과(처리 상태와 별도): undetermined(미판정) / confirmed_issue(실제 오류 확인) / false_positive(정상·오탐)
  -- 시스템이 자동 탐지한 사실(이 줄의 존재)과 사람이 내린 판정은 구분한다. 최초 판정은 항상 미판정이다. (PRD 5-2 규칙 10)
  verdict             text        not null default 'undetermined',

  -- 담당자. 처음 탐지된 건은 담당자 없이 만들어진다. (PRD 4-2)
  assignee_id         uuid        references public.profiles (id) on delete set null,

  -- 낙관적 잠금용 번호. 화면이 본 번호와 다르면 그사이 다른 사람이 바꾼 것이므로 변경을 거부한다. (PRD 5-3 규칙 7)
  version             integer     not null default 1,

  -- 탐지 근거(어떤 값 때문에 걸렸는지). 객체 형태로만 저장한다.
  evidence            jsonb       not null default '{}'::jsonb,
  -- 탐지 대상 값으로 만든 지문. "정상 판정한 건과 값이 같은지" 비교할 때 쓴다. (PRD 5-2 규칙 9)
  value_hash          text        not null,

  detect_count        integer     not null default 1,
  first_detected_at   timestamptz not null default now(),
  last_detected_at    timestamptz not null default now(),

  -- 재발 연결: 종결된 이전 사례. 같은 출처·물건·규칙의 건만 가리킬 수 있다. (아래 복합 연결)
  previous_anomaly_id bigint,

  constraint anomalies_source_check
    check (source in ('DEMO', 'PUBLIC')),
  constraint anomalies_item_key_check
    check (char_length(btrim(item_key)) between 1 and 100),
  -- 탐지 규칙 3개 + API 상태 이상징후 1개만 허용 (PRD 5-1, 5-2 규칙 4)
  constraint anomalies_rule_id_check
    check (rule_id in ('DATE_ORDER', 'REQUIRED_FIELD', 'LIST_DETAIL_MISMATCH', 'EMPTY_RESULT')),
  constraint anomalies_status_check
    check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  constraint anomalies_verdict_check
    check (verdict in ('undetermined', 'confirmed_issue', 'false_positive')),
  -- 상태와 판정의 짝 (PRD 5-3 규칙 2·4)
  --   open          : 아직 아무도 판정하지 않았으므로 미판정만 가능
  --   investigating : 검토 중에는 판정만 따로 바꿀 수 있어 어느 판정이든 가능
  --   resolved      : 실제 오류로 확인된(confirmed_issue) 건만 조치 완료로 닫을 수 있다
  --   dismissed     : 정상·오탐으로 확인된(false_positive) 건만 정상 판정으로 닫을 수 있다
  constraint anomalies_status_verdict_check
    check (
      (status = 'open' and verdict = 'undetermined')
      or status = 'investigating'
      or (status = 'resolved' and verdict = 'confirmed_issue')
      or (status = 'dismissed' and verdict = 'false_positive')
    ),
  constraint anomalies_version_check
    check (version >= 1),
  constraint anomalies_detect_count_check
    check (detect_count >= 1),
  constraint anomalies_detected_time_order_check
    check (last_detected_at >= first_detected_at),
  constraint anomalies_evidence_object_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint anomalies_evidence_size_check
    check (octet_length(evidence::text) <= 10000),
  constraint anomalies_value_hash_check
    check (char_length(btrim(value_hash)) between 1 and 128),
  constraint anomalies_not_self_previous_check
    check (previous_anomaly_id is null or previous_anomaly_id <> id),

  -- 재발 연결이 다른 물건·다른 규칙의 건을 가리키지 못하게 하려는 복합 연결의 바탕
  constraint anomalies_identity_key
    unique (id, source, item_key, rule_id),
  constraint anomalies_previous_same_identity_fkey
    foreign key (previous_anomaly_id, source, item_key, rule_id)
    references public.anomalies (id, source, item_key, rule_id)
);

comment on table public.anomalies is '이상징후 1건. 탐지 사실과 사람의 판정을 구분한다. 변경은 DB 함수로만 한다.';
comment on column public.anomalies.verdict is 'undetermined/confirmed_issue/false_positive. 상태와 짝이 맞아야 한다(resolved↔confirmed_issue, dismissed↔false_positive)';
comment on column public.anomalies.version is '낙관적 잠금 번호. 사용자 변경 요청의 번호가 현재와 다르면 거부';
comment on column public.anomalies.previous_anomaly_id is '재발 연결: 같은 출처·물건·규칙의 이전 종결 건';

-- 중복 방지: 같은 출처·물건·규칙의 열린(open/investigating) 건은 하나만 (PRD 5-2 규칙 8)
create unique index anomalies_one_active_per_identity
  on public.anomalies (source, item_key, rule_id)
  where status in ('open', 'investigating');

-- "가장 최근 종결 건" 찾기와 목록 화면용
create index anomalies_identity_recent_idx
  on public.anomalies (source, item_key, rule_id, id desc);
create index anomalies_status_idx on public.anomalies (status);
create index anomalies_assignee_idx on public.anomalies (assignee_id) where assignee_id is not null;
create index anomalies_last_detected_idx on public.anomalies (last_detected_at desc);

-- ---------------------------------------------------------------------------
-- 2. 바뀌면 안 되는 칸 보호: "무엇이 이상한가"와 최초 탐지 시각, 재발 연결은 한번 정해지면 바꿀 수 없다.
--    (같은 줄을 다른 물건의 이상징후로 바꿔치기하는 실수·조작을 막는다)
-- ---------------------------------------------------------------------------
create or replace function public.anomalies_protect_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.source is distinct from old.source
     or new.item_key is distinct from old.item_key
     or new.rule_id is distinct from old.rule_id
     or new.first_detected_at is distinct from old.first_detected_at
     or new.previous_anomaly_id is distinct from old.previous_anomaly_id then
    raise exception '이상징후의 식별 정보(출처·물건·규칙·최초 탐지 시각·재발 연결)는 바꿀 수 없습니다.'
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

create trigger anomalies_protect_identity
  before update on public.anomalies
  for each row execute function public.anomalies_protect_identity();

-- ---------------------------------------------------------------------------
-- 3. 출입 규칙 (RLS) — "로그인 사용자 읽기, 변경은 DB 함수로만" (DESIGN 6.4)
-- ---------------------------------------------------------------------------
alter table public.anomalies enable row level security;

revoke all on public.anomalies from anon, authenticated;
grant select on public.anomalies to authenticated;

-- operator도 남의 담당 건을 볼 수 있다. (PRD 4-1, 7-5 SEC-08: 조회는 허용, 변경만 거부)
create policy "로그인 사용자는 anomalies를 읽을 수 있다"
  on public.anomalies for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.
-- → 사용자 권한으로는 직접 고칠 수 없고, 정해진 DB 함수(배정·판정·상태변경)와 서버 점검 엔진만 바꿀 수 있다.

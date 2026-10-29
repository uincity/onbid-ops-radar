-- PLAN 작업 8: DEMO/PUBLIC 출처를 구분해 저장하는 수집 데이터 테이블(collected_items)
-- Design Ref: DESIGN §6.1(collected_items), §5.1(점검 흐름 3단계 "정리"), §6.4(RLS),
--             PRD 4-6(DEMO와 PUBLIC 구분), 5-2 규칙 3(목록·상세 비교), 7-2(개인정보 보호), 부록 B(DEMO 가상 스키마)
--
-- 한 줄 설명: 점검 중에 가져온 물건 데이터를 "목록 한 줄 / 상세 한 줄"씩 저장하는 표.
--             탐지 규칙 3개가 이 표의 데이터를 읽어서 이상징후를 찾는다.
-- 쓰기는 서버의 점검 엔진(관리용 키)만 한다. 로그인 사용자는 읽기만 한다. (DESIGN 6.4)

-- ---------------------------------------------------------------------------
-- 1. 사전 준비: 수집 데이터의 "출처"가 점검 실행의 "출처"와 항상 같도록 묶기 위해
--    check_runs에 (id, source) 묶음이 유일하다는 제약을 추가한다.
--    (id는 이미 유일하므로 기존 데이터에는 영향이 없다)
-- ---------------------------------------------------------------------------
alter table public.check_runs
  add constraint check_runs_id_source_key unique (id, source);

-- ---------------------------------------------------------------------------
-- 2. collected_items : 수집한 물건 데이터 1건 (목록 또는 상세)
-- ---------------------------------------------------------------------------
create table public.collected_items (
  id           bigint generated always as identity primary key,
  run_id       bigint      not null,
  -- 이 줄의 출처. 아래 복합 연결 때문에 항상 점검 실행(check_runs)의 출처와 같아야 한다.
  source       text        not null,
  -- 같은 물건을 가리키는 식별값. DEMO는 demo_item_id 값 (PRD 부록 B). PUBLIC은 부록 A 확정 후 정한다.
  item_key     text        not null,
  -- list(목록 조회 결과) 또는 detail(상세 조회 결과)
  kind         text        not null,
  -- 저장이 허용된 필드만 담는다. (PRD 7-2) 값이 비었거나 형식이 틀린 "원본 그대로의 이상 데이터"도 담을 수 있어야
  -- 탐지 규칙이 찾아낼 수 있으므로, 값의 내용은 따지지 않고 "허용된 이름의 필드인지"만 따진다.
  fields       jsonb       not null default '{}'::jsonb,
  -- 수집한 시각. 목록·상세의 시간 차이가 10분 이내인지 비교할 때 쓴다. (PRD 5-2 규칙 3)
  collected_at timestamptz not null default now(),

  constraint collected_items_run_source_fkey
    foreign key (run_id, source) references public.check_runs (id, source),
  constraint collected_items_source_check
    check (source in ('DEMO', 'PUBLIC')),
  constraint collected_items_kind_check
    check (kind in ('list', 'detail')),
  constraint collected_items_item_key_check
    check (char_length(btrim(item_key)) between 1 and 100),
  constraint collected_items_fields_object_check
    check (jsonb_typeof(fields) = 'object'),
  -- 너무 큰 데이터(전체 응답 통째 저장 등)를 막는다.
  constraint collected_items_fields_size_check
    check (octet_length(fields::text) <= 10000),
  -- DEMO는 PRD 부록 B의 6개 필드만 허용한다. 그 밖의 이름(예: 이름·연락처 같은 개인정보)은 저장할 수 없다.
  -- PUBLIC의 허용 필드는 PRD 부록 A가 확정된 뒤 별도 마이그레이션으로 추가한다.
  constraint collected_items_demo_fields_check
    check (
      source <> 'DEMO'
      or (fields - array['demo_item_id', 'item_name', 'org_name', 'bid_start_at', 'bid_end_at', 'item_status']) = '{}'::jsonb
    ),
  -- 한 번의 점검에서 같은 물건의 같은 종류(목록/상세)는 한 줄만 저장한다.
  constraint collected_items_run_kind_item_key
    unique (run_id, kind, item_key)
);

comment on table public.collected_items is '점검 중 수집한 물건 데이터(목록/상세). DEMO·PUBLIC 출처를 항상 구분한다. 쓰기는 서버 점검 엔진만 한다.';
comment on column public.collected_items.item_key is '같은 물건을 가리키는 식별값. DEMO는 demo_item_id (PRD 부록 B)';
comment on column public.collected_items.fields is '저장이 허용된 필드만. DEMO 허용 목록은 PRD 부록 B, PUBLIC은 부록 A 확정 후 추가';

-- 같은 물건의 목록·상세·이전 수집 데이터를 찾는 용도
create index collected_items_source_item_key_idx
  on public.collected_items (source, item_key, collected_at desc);
create index collected_items_run_id_idx
  on public.collected_items (run_id);

-- ---------------------------------------------------------------------------
-- 3. 출입 규칙 (RLS) — "로그인 사용자 읽기, 쓰기는 서버만" (DESIGN 6.4)
-- ---------------------------------------------------------------------------
alter table public.collected_items enable row level security;

revoke all on public.collected_items from anon, authenticated;
grant select on public.collected_items to authenticated;

create policy "로그인 사용자는 collected_items를 읽을 수 있다"
  on public.collected_items for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.
-- → 쓰기는 RLS를 건너뛰는 서버 관리용 키(점검 엔진)만 할 수 있다.

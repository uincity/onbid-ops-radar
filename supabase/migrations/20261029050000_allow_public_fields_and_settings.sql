-- PUBLIC 조회기(PLAN 33) 준비: 부록 A가 확정되어 PUBLIC 수집 필드와 설정값을 DB에 반영한다.
-- Design Ref: PRD 부록 A(온비드 부동산 물건목록 getRlstCltrList2 · 물건상세 getRlstDtlInf2), 5-2 규칙 3~6, 5-5, DESIGN §6.1
--
-- 바꾸는 것 세 가지
--   1) collected_items: PUBLIC 출처도 "허용된 필드만" 저장할 수 있게 한다. (응답 전체·개인정보가 섞여 들어오는 것을 막는 장치는 그대로)
--   2) settings 필드 이름 검사: 실제 API 필드는 cltrMngNo처럼 영문 대소문자(camelCase)라서 소문자만 허용하던 검사를 넓힌다.
--   3) settings 값: PUBLIC 필수·비교·제외 필드, API별 빈 결과 허용 여부, PUBLIC 일일 호출 예산(900)을 정한다.
--      (승인된 일일 트래픽은 서비스별 개발계정 1,000회라서 여유 100회를 남긴다)
-- 코드의 기본값(lib/settings/schema.ts)도 같은 값으로 고쳤고, tests/unit/settings-drift.test.ts가 둘이 같은지 확인한다.

-- ---------------------------------------------------------------------------
-- 1. collected_items: 출처별 허용 필드
-- ---------------------------------------------------------------------------
alter table public.collected_items drop constraint collected_items_demo_fields_check;

alter table public.collected_items add constraint collected_items_allowed_fields_check
  check (
    case source
      when 'DEMO' then
        (fields - array['demo_item_id', 'item_name', 'org_name', 'bid_start_at', 'bid_end_at', 'item_status']) = '{}'::jsonb
      when 'PUBLIC' then
        (fields - array['cltrMngNo', 'pbctCdtnNo', 'onbidCltrNm', 'orgNm', 'cltrBidBgngDt', 'cltrBidEndDt', 'pbctStatCd']) = '{}'::jsonb
      else false
    end
  );

comment on column public.collected_items.fields is '저장이 허용된 필드만. DEMO는 PRD 부록 B, PUBLIC은 부록 A(온비드 부동산 물건목록·상세)의 7개 필드';
comment on column public.collected_items.item_key is '같은 물건을 가리키는 식별값. DEMO는 demo_item_id(부록 B), PUBLIC은 물건관리번호 cltrMngNo(부록 A)';

-- ---------------------------------------------------------------------------
-- 2. settings: 필드 이름에 영문 대소문자(camelCase)를 허용한다
-- ---------------------------------------------------------------------------
create or replace function public.settings_field_list_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) <= 30
        then not exists (
          select 1 from jsonb_array_elements(p_value) as e(item)
          where jsonb_typeof(e.item) <> 'string'
             or (e.item #>> '{}') !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$'
        )
      else false
    end,
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. settings: PUBLIC 값 (DEMO 값은 그대로 두고 PUBLIC만 더한다)
-- ---------------------------------------------------------------------------
update public.settings set value = '{"DEMO": ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"], "PUBLIC": ["cltrMngNo", "pbctCdtnNo", "onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"]}'::jsonb
 where key = 'required_fields';

update public.settings set value = '{"DEMO": ["item_name", "org_name", "bid_start_at", "bid_end_at"], "PUBLIC": ["onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"]}'::jsonb
 where key = 'compare_fields';

update public.settings set value = '{"DEMO": ["item_status"], "PUBLIC": ["pbctStatCd"]}'::jsonb
 where key = 'excluded_fields';

-- 목록이 0건이면 이상(입찰 중 물건이 없을 수 없다), 상세는 목록과 호출 사이에 입찰이 끝날 수 있어 0건을 정상으로 본다
update public.settings set value = '{"demo-list": false, "demo-detail": false, "public-list": false, "public-detail": true}'::jsonb
 where key = 'empty_allowed_by_endpoint';

update public.settings set value = '900'::jsonb
 where key = 'public_daily_budget';

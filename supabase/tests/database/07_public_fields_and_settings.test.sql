-- pgTAP 테스트 07: PUBLIC 수집 필드 허용과 PUBLIC 설정값 (PLAN 작업 33, PRD 부록 A)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- 시험용 점검 실행 (실행 중인 점검이 있어도 흔들리지 않게 이 트랜잭션 안에서만 마감해 둔다)
update public.check_runs set status = 'failed', finished_at = now() where status = 'running';
insert into public.check_runs ("trigger", source) values ('manual', 'PUBLIC');
create temp table pub_run as select id from public.check_runs where source = 'PUBLIC' and status = 'running' order by id desc limit 1;
-- DEMO 줄은 같은 실행에 넣을 수 없으므로(실행과 출처가 같아야 함) DEMO용 실행은 마감 뒤에 따로 만든다
update public.check_runs set status = 'succeeded', finished_at = now() where id = (select id from pub_run);
insert into public.check_runs ("trigger", source) values ('manual', 'DEMO');
create temp table demo_run as select id from public.check_runs where source = 'DEMO' and status = 'running' order by id desc limit 1;

-- ---------------------------------------------------------------- collected_items: PUBLIC 허용 필드
select lives_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from pub_run), 'PUBLIC', '2026-1100-000001', 'list',
            '{"cltrMngNo":"2026-1100-000001","pbctCdtnNo":"3600001","onbidCltrNm":"물건","orgNm":"한국자산관리공사","cltrBidBgngDt":"202605180900","cltrBidEndDt":"202605201700","pbctStatCd":"0002"}'::jsonb)$$,
  'PUBLIC: 부록 A의 7개 필드는 저장할 수 있음'
);
select lives_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from pub_run), 'PUBLIC', '2026-1100-000002', 'detail', '{"cltrMngNo":"2026-1100-000002"}'::jsonb)$$,
  'PUBLIC: 일부 필드만 있어도 저장할 수 있음 (필수정보 누락도 수집은 해야 하므로)'
);
select throws_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from pub_run), 'PUBLIC', 'X-1', 'list', '{"cltrMngNo":"X-1","cltrRadr":"서울시 주소"}'::jsonb)$$,
  '23514', null, 'PUBLIC: 허용 목록에 없는 필드(주소)는 저장할 수 없음'
);
select throws_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from pub_run), 'PUBLIC', 'X-2', 'list', '{"cltrMngNo":"X-2","phone":"010-0000-0000"}'::jsonb)$$,
  '23514', null, 'PUBLIC: 개인정보 같은 이름의 필드도 저장할 수 없음'
);
select throws_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from pub_run), 'PUBLIC', 'X-3', 'list', '{"demo_item_id":"DEMO-0001"}'::jsonb)$$,
  '23514', null, 'PUBLIC 줄에 DEMO 필드 이름은 저장할 수 없음'
);

-- ---------------------------------------------------------------- collected_items: DEMO는 그대로
select lives_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from demo_run), 'DEMO', 'DEMO-0001', 'list', '{"demo_item_id":"DEMO-0001","item_name":"물건","item_status":"ready"}'::jsonb)$$,
  'DEMO: 부록 B의 필드는 그대로 저장할 수 있음'
);
select throws_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from demo_run), 'DEMO', 'DEMO-0002', 'list', '{"cltrMngNo":"2026-1100-000001"}'::jsonb)$$,
  '23514', null, 'DEMO 줄에 PUBLIC 필드 이름은 저장할 수 없음'
);
select throws_ok(
  $$insert into public.collected_items (run_id, source, item_key, kind, fields)
    values ((select id from demo_run), 'DEMO', 'DEMO-0003', 'list', '{"demo_item_id":"DEMO-0003","contact":"x"}'::jsonb)$$,
  '23514', null, 'DEMO: 허용 목록에 없는 필드는 여전히 저장할 수 없음'
);

-- ---------------------------------------------------------------- settings: 필드 이름 검사 (camelCase 허용)
select ok(public.settings_value_is_valid('required_fields', '{"PUBLIC":["cltrMngNo","onbidCltrNm"]}'::jsonb), '필드 이름에 영문 대문자(camelCase)를 쓸 수 있음');
select ok(public.settings_value_is_valid('required_fields', '{"DEMO":["demo_item_id"]}'::jsonb), '기존 소문자 이름도 그대로 허용');
select ok(not public.settings_value_is_valid('required_fields', '{"PUBLIC":["bad-name"]}'::jsonb), '하이픈이 든 이름은 여전히 거부');
select ok(not public.settings_value_is_valid('required_fields', '{"PUBLIC":["1abc"]}'::jsonb), '숫자로 시작하는 이름은 여전히 거부');

-- ---------------------------------------------------------------- settings: PUBLIC 값
select is(
  (select value #>> '{PUBLIC}' from public.settings where key = 'required_fields'),
  '["cltrMngNo", "pbctCdtnNo", "onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"]',
  'PUBLIC 필수 필드 6개가 정해져 있음'
);
select is(
  (select value #>> '{PUBLIC}' from public.settings where key = 'compare_fields'),
  '["onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"]',
  'PUBLIC 목록·상세 비교 필드 4개가 정해져 있음 (진행상태 pbctStatCd는 제외)'
);
select is((select value::text from public.settings where key = 'public_daily_budget'), '900', 'PUBLIC 일일 호출 예산은 900회');
select is(
  (select value::text from public.settings where key = 'empty_allowed_by_endpoint'),
  '{"demo-list": false, "demo-detail": false, "public-list": false, "public-detail": true}',
  'API별 빈 결과 허용: 목록은 불허, 상세는 허용'
);

select * from finish();
rollback;

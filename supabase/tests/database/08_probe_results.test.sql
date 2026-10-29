-- pgTAP 테스트 08: 점검 판정(probe_results)·api_checks 새 칸·확장된 규칙 ID  (R03, PRD 5-2-3·4-6·D-1)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- 시험용 점검 실행 (실행 중인 점검이 있어도 흔들리지 않게 이 트랜잭션 안에서만 마감해 둔다)
update public.check_runs set status = 'failed', finished_at = now() where status = 'running';
insert into public.check_runs ("trigger", source) values ('manual', 'PUBLIC');
create temp table pub_run as select id from public.check_runs where source = 'PUBLIC' and status = 'running' order by id desc limit 1;
update public.check_runs set status = 'succeeded', finished_at = now() where id = (select id from pub_run);
insert into public.check_runs ("trigger", source) values ('manual', 'DEMO');
create temp table demo_run as select id from public.check_runs where source = 'DEMO' and status = 'running' order by id desc limit 1;
update public.check_runs set status = 'succeeded', finished_at = now() where id = (select id from demo_run);

-- 한 줄 넣는 도우미
create function pg_temp.ins(p_status text, p_attempted boolean, p_reason text, p_op text default 'getRlstCltrList', p_extra text default '')
returns void language plpgsql as $$
begin
  execute format(
    'insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, reason %s) values (%s, ''PUBLIC'', ''SVC-API-001'', %L, %L, %L, %L %s)',
    case when p_extra = '' then '' else ', had_data' end,
    (select id from pub_run), p_op, p_status, p_attempted, p_reason,
    case when p_extra = '' then '' else ', ' || p_extra end);
end $$;

-- ---------------------------------------------------------------- 권한·RLS (4)
select ok((select relrowsecurity from pg_class where oid = 'public.probe_results'::regclass), 'probe_results에 RLS가 켜져 있음');
select ok(not has_table_privilege('anon', 'public.probe_results', 'SELECT,INSERT,UPDATE,DELETE'), '비로그인(anon)은 아무 권한이 없음');
select ok(has_table_privilege('authenticated', 'public.probe_results', 'SELECT') and not has_table_privilege('authenticated', 'public.probe_results', 'INSERT,UPDATE,DELETE'), '로그인 사용자는 읽기만 가능');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'probe_results'), 1, '정책은 "로그인 사용자 읽기" 하나뿐 (쓰기 정책 없음)');

-- ---------------------------------------------------------------- 정상 저장: 상태 6종 (7)
select lives_ok($$select pg_temp.ins('PASS_DATA', true, null, 'op1')$$, 'PASS_DATA 저장');
select lives_ok($$select pg_temp.ins('PASS_NO_DATA', true, null, 'op2')$$, 'PASS_NO_DATA 저장');
select lives_ok($$select pg_temp.ins('DEGRADED', true, 'RETRIED_THEN_OK', 'op3', 'true')$$, 'DEGRADED(사유 + 데이터 여부) 저장');
select lives_ok($$select pg_temp.ins('FAIL', true, 'TIMEOUT', 'op4')$$, 'FAIL(세부 코드) 저장');
select lives_ok($$select pg_temp.ins('UNVERIFIED', false, 'NO_VALID_INPUT', 'op5')$$, 'UNVERIFIED(요청 안 보냄) 저장');
select lives_ok($$select pg_temp.ins('UNVERIFIED', true, 'NO_DATA_UNCONFIRMED', 'op6')$$, 'UNVERIFIED(요청은 보냈지만 판단 못 함) 저장');
select lives_ok($$select pg_temp.ins('NOT_RUN', false, 'BUDGET_SKIP', 'op7')$$, 'NOT_RUN(미점검 사유) 저장');

-- ---------------------------------------------------------------- 맞지 않는 상태·사유 조합은 거부 (12)
select throws_ok($$select pg_temp.ins('PASS_DATA', true, 'TIMEOUT', 'bad1')$$, '23514', null, 'PASS는 사유를 가질 수 없음');
select throws_ok($$select pg_temp.ins('PASS_DATA', false, null, 'bad2')$$, '23514', null, 'PASS인데 요청을 안 보낸 것으로 기록할 수 없음');
select throws_ok($$select pg_temp.ins('FAIL', true, null, 'bad3')$$, '23514', null, 'FAIL은 세부 코드가 필요함');
select throws_ok($$select pg_temp.ins('FAIL', true, 'NO_VALID_INPUT', 'bad4')$$, '23514', null, 'FAIL에 UNVERIFIED 사유를 쓸 수 없음');
select throws_ok($$select pg_temp.ins('FAIL', false, 'TIMEOUT', 'bad5')$$, '23514', null, 'FAIL인데 요청을 안 보낸 것으로 기록할 수 없음');
select throws_ok($$select pg_temp.ins('NOT_RUN', true, 'BUDGET_SKIP', 'bad6')$$, '23514', null, 'NOT_RUN은 요청을 보냈다고 기록할 수 없음');
select throws_ok($$select pg_temp.ins('NOT_RUN', false, 'TIMEOUT', 'bad7')$$, '23514', null, 'NOT_RUN에 FAIL 코드를 쓸 수 없음');
select throws_ok($$select pg_temp.ins('UNVERIFIED', false, null, 'bad8')$$, '23514', null, 'UNVERIFIED는 사유가 필요함');
select throws_ok($$select pg_temp.ins('DEGRADED', true, 'TIMEOUT', 'bad9', 'true')$$, '23514', null, 'DEGRADED에 FAIL 코드를 쓸 수 없음');
select throws_ok($$select pg_temp.ins('DEGRADED', true, 'SLOW_RESPONSE', 'bad10')$$, '23514', null, 'DEGRADED는 데이터 여부(had_data)가 필요함');
select throws_ok($$select pg_temp.ins('PASS_DATA', true, null, 'bad11', 'true')$$, '23514', null, 'DEGRADED가 아니면 had_data를 둘 수 없음');
select throws_ok($$select pg_temp.ins('GOOD', true, null, 'bad12')$$, '23514', null, '모르는 상태는 거부');

-- ---------------------------------------------------------------- 식별값·연결·중복 (7)
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from pub_run), 'PUBLIC', 'SVC-1', 'op', 'PASS_DATA', true)$$, '23514', null, '서비스ID 형식(SVC-API-NNN)이 아니면 거부');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'bad name!', 'PASS_DATA', true)$$, '23514', null, '오퍼레이션 ID 형식이 아니면 거부');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'op1', 'PASS_DATA', true)$$, '23505', null, '같은 점검에서 같은 오퍼레이션의 판정은 1줄만');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from demo_run), 'PUBLIC', 'SVC-API-001', 'opx', 'PASS_DATA', true)$$, '23503', null, '점검 실행은 DEMO인데 PUBLIC으로 저장하면 거부 (출처 섞임 방지)');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values (-1, 'PUBLIC', 'SVC-API-001', 'opy', 'PASS_DATA', true)$$, '23503', null, '없는 점검 실행은 거부');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from pub_run), 'TEST', 'SVC-API-001', 'opz', 'PASS_DATA', true)$$, '23514', null, '모르는 출처는 거부');
select lives_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted) values ((select id from pub_run), 'PUBLIC', 'SVC-API-002', 'op1', 'PASS_DATA', true)$$, '다른 서비스의 같은 오퍼레이션 이름은 별개로 저장됨');

-- ---------------------------------------------------------------- 값의 모양 (6)
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, request_summary) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k1', 'PASS_DATA', true, 'pageNo=1&serviceKey=abc')$$, '23514', null, '요청 요약에 인증키가 있으면 거부 (SEC-10)');
select lives_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, request_summary, schema_summary, result_code, http_status, duration_ms, record_count) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k2', 'PASS_DATA', true, 'pageNo=1&numOfRows=19', '{"checked":true,"ok":true,"inspected":3,"warnings":0,"problems":[]}', '00', 200, 321, 19)$$, '마스킹된 요청 요약·응답 구조 요약·응답 값은 저장됨');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, http_status) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k3', 'PASS_DATA', true, 700)$$, '23514', null, 'HTTP 상태는 100~599만');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, duration_ms) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k4', 'PASS_DATA', true, -1)$$, '23514', null, '응답시간은 음수가 될 수 없음');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, schema_summary) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k5', 'PASS_DATA', true, '[]')$$, '23514', null, '응답 구조 요약은 객체여야 함');
select throws_ok($$insert into public.probe_results (run_id, source, api_id, operation_id, status, attempted, result_code) values ((select id from pub_run), 'PUBLIC', 'SVC-API-001', 'k6', 'PASS_DATA', true, 'bad code!')$$, '23514', null, '결과코드 모양이 이상하면 거부');

-- ---------------------------------------------------------------- api_checks 새 칸: 이전 행 보존 + 새 제약 (6)
select lives_ok(
  $$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome) values ((select id from pub_run), 'demo-list', 1, 'success')$$,
  '이전 방식의 api_checks 줄(새 칸이 모두 비어 있음)도 그대로 저장됨 (보존형)'
);
select lives_ok(
  $$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome, api_id, operation_id, result_code, request_summary) values ((select id from pub_run), 'public-list', 5, 'success', 'SVC-API-001', 'getRlstCltrList', '00', 'pageNo=1&numOfRows=19')$$,
  '새 칸(서비스ID·오퍼레이션 ID·결과코드·요청 요약)이 저장됨'
);
select throws_ok($$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome, api_id) values ((select id from pub_run), 'public-list', 5, 'success', 'SVC-API-001')$$, '23514', null, '서비스ID만 있고 오퍼레이션 ID가 없으면 거부');
select throws_ok($$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome, api_id, operation_id) values ((select id from pub_run), 'public-list', 5, 'success', 'x', 'getRlstCltrList')$$, '23514', null, '서비스ID 형식이 아니면 거부');
select throws_ok($$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome, request_summary) values ((select id from pub_run), 'public-list', 5, 'success', 'serviceKey=abc')$$, '23514', null, 'api_checks 요청 요약에도 인증키는 거부');
select throws_ok($$insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome, result_code) values ((select id from pub_run), 'public-list', 5, 'success', 'bad code!')$$, '23514', null, 'api_checks 결과코드 모양이 이상하면 거부');

-- ---------------------------------------------------------------- 확장된 규칙 ID (4): 이전 ID는 그대로, 새 ID 추가, 그 밖은 거부
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'R03-OLD', 'EMPTY_RESULT', 'h')$$, '이전 규칙 ID(EMPTY_RESULT)는 그대로 저장됨 (이전 기록 호환)');
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('PUBLIC', '2026-1100-000001', 'DQ_LIST_DETAIL_REF', 'h')$$, '데이터 품질 규칙 ID(DQ_*)가 저장됨');
select lives_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('PUBLIC', 'SVC-API-001/getRlstCltrList', 'API_TIMEOUT', 'h')$$, 'API 상태 이상징후는 대상 = 서비스ID/오퍼레이션ID, 규칙 = API_<오류 코드>로 저장됨');
select throws_ok($$insert into public.anomalies (source, item_key, rule_id, value_hash) values ('PUBLIC', 'x', 'API_UNKNOWN', 'h')$$, '23514', null, '목록에 없는 규칙 ID는 거부 (범위 밖 규칙 차단)');

select * from finish();
rollback;

-- pgTAP 테스트 05: record_detection — 중복 방지 · 재발 · 정상 판정 억제  (PLAN 작업 23, PRD 5-2 규칙 8~10)
-- Design Ref: DESIGN §5.1(5. 등록), §6.3(record_detection)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다. (이력 장부는 지울 수 없으므로 반드시 롤백으로만 시험한다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------- 권한 (4)
select ok(not has_function_privilege('anon', 'public.record_detection(text, text, text, jsonb, text)', 'EXECUTE'), '비로그인(anon)은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.record_detection(text, text, text, jsonb, text)', 'EXECUTE'), '로그인 사용자(authenticated)도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.record_detection(text, text, text, jsonb, text)', 'EXECUTE'), '서버 관리용 키(service_role)는 실행할 수 있음');
select ok(
  (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'public.record_detection(text, text, text, jsonb, text)'::regprocedure),
  '소유자 권한으로 실행되고 search_path가 비어 있음'
);

-- ---------------------------------------------------------------- 처음 탐지 (5)
create temp table r1 as select * from public.record_detection('DEMO', 'T-1', 'DATE_ORDER', '{"k":1}'::jsonb, 'h1');
select is((select out_action from r1), 'created', '처음 탐지하면 새 건이 만들어짐');
select is(
  (select status || '/' || verdict || '/' || detect_count || '/' || version || '/' || (assignee_id is null)::text from public.anomalies where id = (select out_anomaly_id from r1)),
  'open/undetermined/1/1/true',
  '새 건은 미확인(open)·미판정(undetermined)·횟수 1·버전 1·담당자 없음'
);
select is(
  (select actor_type || '/' || event_type || '/' || coalesce(from_value, 'null') || '/' || to_value from public.anomaly_events where anomaly_id = (select out_anomaly_id from r1)),
  'system/created/null/open',
  '시스템이 만든 created 이력이 1줄 남음'
);
select is((select evidence ->> 'k' from public.anomalies where id = (select out_anomaly_id from r1)), '1', '탐지 근거가 저장됨');
select is((select previous_anomaly_id from public.anomalies where id = (select out_anomaly_id from r1)), null, '처음 탐지는 재발 연결이 없음');

-- ---------------------------------------------------------------- 같은 건 다시 탐지 = 중복 방지 (5)
create temp table r2 as select * from public.record_detection('DEMO', 'T-1', 'DATE_ORDER', '{"k":1}'::jsonb, 'h1');
select is((select out_action from r2), 'detected_again', '열린 건이 있으면 새로 만들지 않고 다시 탐지로 처리');
select is((select out_anomaly_id from r2), (select out_anomaly_id from r1), '같은 건의 번호가 돌아옴');
select is(
  (select detect_count || '/' || version from public.anomalies where id = (select out_anomaly_id from r1)),
  '2/1',
  '탐지 횟수만 2로 늘고 버전은 그대로 (자동 재탐지가 사람의 저장을 방해하지 않음)'
);
select is((select count(*)::int from public.anomalies where source = 'DEMO' and item_key = 'T-1' and rule_id = 'DATE_ORDER'), 1, '같은 출처·물건·규칙의 건은 1개뿐');
select is(
  (select from_value || '>' || to_value from public.anomaly_events where anomaly_id = (select out_anomaly_id from r1) and event_type = 'detected_again'),
  '1>2',
  '재탐지 이력(횟수 1→2)이 남음'
);

-- ---------------------------------------------------------------- 검토 중(investigating)도 열린 건 (1)
update public.anomalies set status = 'investigating' where id = (select out_anomaly_id from r1);
create temp table r2b as select * from public.record_detection('DEMO', 'T-1', 'DATE_ORDER', '{"k":1}'::jsonb, 'h1');
select is(
  (select out_action || '/' || (select detect_count from public.anomalies where id = r2b.out_anomaly_id) from r2b),
  'detected_again/3',
  '검토 중인 건도 열린 건이라 횟수만 늘어남'
);

-- ---------------------------------------------------------------- resolved 뒤 재발: 값이 같아도 새 건 (6)
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select out_anomaly_id from r1);
create temp table r3 as select * from public.record_detection('DEMO', 'T-1', 'DATE_ORDER', '{"k":1}'::jsonb, 'h1');
select is((select out_action from r3), 'recurred', '조치 완료(resolved) 뒤 다시 발견되면 값이 같아도 재발로 새 건');
select isnt((select out_anomaly_id from r3), (select out_anomaly_id from r1), '새 건의 번호는 이전 건과 다름');
select is((select previous_anomaly_id from public.anomalies where id = (select out_anomaly_id from r3)), (select out_anomaly_id from r1), '새 건이 이전 건을 재발 연결로 가리킴');
select is(
  (select status || '/' || verdict || '/' || detect_count from public.anomalies where id = (select out_anomaly_id from r3)),
  'open/undetermined/1',
  '재발 건도 미확인·미판정·횟수 1로 시작'
);
select is((select status || '/' || detect_count from public.anomalies where id = (select out_anomaly_id from r1)), 'resolved/3', '이전 종결 건은 그대로');
select ok(
  (select note like '재발:%' from public.anomaly_events where anomaly_id = (select out_anomaly_id from r3) and event_type = 'created'),
  '재발 건의 created 이력에 재발 메모가 남음'
);

-- ---------------------------------------------------------------- dismissed + 같은 값 = 억제 (8)
create temp table r4 as select * from public.record_detection('DEMO', 'T-2', 'REQUIRED_FIELD', '{}'::jsonb, 'h1');
update public.anomalies set status = 'dismissed', verdict = 'false_positive' where id = (select out_anomaly_id from r4);
create temp table r5 as select * from public.record_detection('DEMO', 'T-2', 'REQUIRED_FIELD', '{}'::jsonb, 'h1');
select is((select out_action from r5), 'suppressed', '정상 판정한 건과 값이 같으면 새 건을 만들지 않고 억제');
select is((select out_anomaly_id from r5), (select out_anomaly_id from r4), '억제된 건의 번호는 정상 판정한 그 건');
select is(
  (select status || '/' || detect_count from public.anomalies where id = (select out_anomaly_id from r4)),
  'dismissed/2',
  '상태는 정상 판정 그대로이고 탐지 횟수만 2로 늘어남'
);
select is((select count(*)::int from public.anomalies where item_key = 'T-2'), 1, '새 건이 만들어지지 않음');
select is((select count(*)::int from public.anomaly_events where anomaly_id = (select out_anomaly_id from r4) and event_type = 'detected_again'), 1, '억제된 탐지도 재탐지 이력으로 남음');

-- 값이 바뀌면 재발
create temp table r6 as select * from public.record_detection('DEMO', 'T-2', 'REQUIRED_FIELD', '{}'::jsonb, 'h2');
select is((select out_action from r6), 'recurred', '정상 판정 뒤 원본 값이 바뀌면 재발로 새 건');
select is((select previous_anomaly_id from public.anomalies where id = (select out_anomaly_id from r6)), (select out_anomaly_id from r4), '재발 건이 정상 판정한 건을 가리킴');
select is((select status || '/' || detect_count from public.anomalies where id = (select out_anomaly_id from r4)), 'dismissed/2', '정상 판정 건은 그대로');

-- ---------------------------------------------------------------- 비교 기준은 "가장 최근 종결 건" (2)
-- T-2: 옛 dismissed(h1) → 최근 건(h2)을 resolved로 닫음. 이제 h1이 다시 와도 가장 최근 종결 건은 resolved이므로 억제되지 않는다.
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select out_anomaly_id from r6);
create temp table r7 as select * from public.record_detection('DEMO', 'T-2', 'REQUIRED_FIELD', '{}'::jsonb, 'h1');
select is((select out_action from r7), 'recurred', '가장 최근 종결 건이 resolved면 옛 정상 판정과 값이 같아도 재발');
select is((select previous_anomaly_id from public.anomalies where id = (select out_anomaly_id from r7)), (select out_anomaly_id from r6), '연결은 가장 최근 종결 건');

-- ---------------------------------------------------------------- 출처·규칙이 다르면 별개 (2)
create temp table r8 as
  select * from public.record_detection('DEMO', 'T-3', 'DATE_ORDER', '{}'::jsonb, 'h1')
  union all select * from public.record_detection('PUBLIC', 'T-3', 'DATE_ORDER', '{}'::jsonb, 'h1')
  union all select * from public.record_detection('DEMO', 'T-3', 'REQUIRED_FIELD', '{}'::jsonb, 'h1');
select is((select count(*)::int from public.anomalies where item_key = 'T-3'), 3, '출처나 규칙이 다르면 같은 물건이어도 별개의 건');
select is((select count(*)::int from r8 where out_action = 'created'), 3, '세 건 모두 새로 만들어짐');

-- ---------------------------------------------------------------- 잘못된 입력은 거부 (4)
select throws_ok($$select * from public.record_detection('DEMO', 'T-9', 'DATE_FORMAT', '{}'::jsonb, 'h1')$$, '23514', null, '허용되지 않은 규칙 ID는 거부');
select throws_ok($$select * from public.record_detection('DEMO', 'T-9', 'DATE_ORDER', '[]'::jsonb, 'h1')$$, '23514', null, '근거(evidence)가 객체가 아니면 거부');
select throws_ok($$select * from public.record_detection('DEMO', '   ', 'DATE_ORDER', '{}'::jsonb, 'h1')$$, '23514', null, '물건 식별값이 공백이면 거부');
select throws_ok($$select * from public.record_detection('TEST', 'T-9', 'DATE_ORDER', '{}'::jsonb, 'h1')$$, '23514', null, '허용되지 않은 출처는 거부');

select * from finish();
rollback;

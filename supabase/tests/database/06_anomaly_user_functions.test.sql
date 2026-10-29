-- pgTAP 테스트 06: 사용자가 이상징후를 바꾸는 DB 함수 3개  (PLAN 작업 26·27, PRD 5-3, SEC-02·SEC-08·SEC-12)
-- Design Ref: DESIGN §6.3(assign_anomaly · set_verdict · change_anomaly_status)
-- 시험 방식: 시험용 계정(운영 담당자 2명·팀장 1명·프로필 없는 계정)을 이 안에서만 만들고, 실제 로그인 사용자 권한(authenticated)으로
--           바꿔서 함수를 불러 본다. 이력 장부(anomaly_events)는 지울 수 없으므로 반드시 begin ... rollback 안에서만 시험한다.

begin;
create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------- 시험 도구 (이 트랜잭션 안에서만 존재)
-- 누구로 부를지: A·B(운영 담당자), ADM(팀장), X(프로필 없는 로그인 계정), NONE(로그인 정보 없음), ANON(비로그인)
create function pg_temp.uid_of(p_who text) returns uuid language sql as $$
  select case p_who
    when 'A'   then '11111111-1111-4111-8111-111111111111'::uuid
    when 'B'   then '33333333-3333-4333-8333-333333333333'::uuid
    when 'ADM' then '22222222-2222-4222-8222-222222222222'::uuid
    when 'X'   then '44444444-4444-4444-8444-444444444444'::uuid
  end
$$;

-- 지정한 역할·사용자로 SQL을 실행해 본다. 성공하면 'OK:결과', 우리 함수의 오류(P0001)면 오류 메시지, 그 밖의 오류는 SQLSTATE를 돌려준다.
create function pg_temp.r(p_who text, p_sql text) returns text language plpgsql as $$
declare
  v_role text := case when p_who = 'ANON' then 'anon' else 'authenticated' end;
  v_out  text;
  -- 역할을 바꾸면 임시 영역(pg_temp)을 읽을 수 없으므로 로그인 정보는 바꾸기 전에 만들어 둔다
  v_claims text := case when pg_temp.uid_of(p_who) is null then '{}' else json_build_object('sub', pg_temp.uid_of(p_who), 'role', case when p_who = 'ANON' then 'anon' else 'authenticated' end)::text end;
begin
  execute format('set local role %I', v_role);
  perform set_config('request.jwt.claims', v_claims, true);
  execute p_sql into v_out;
  reset role;
  return 'OK:' || coalesce(v_out, 'null');
exception when others then
  reset role;
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- 시험용 이상징후 한 건 만들기 (직접 넣으므로 이력은 0줄)
create function pg_temp.mk(p_item text, p_status text, p_verdict text, p_assignee text default null, p_rule text default 'DATE_ORDER', p_version integer default 1)
returns bigint language sql as $$
  insert into public.anomalies (source, item_key, rule_id, status, verdict, assignee_id, version, value_hash)
  values ('DEMO', p_item, p_rule, p_status, p_verdict, pg_temp.uid_of(p_assignee), p_version, 'h')
  returning id
$$;

create function pg_temp.ver(p_id bigint) returns integer language sql as $$ select version from public.anomalies where id = p_id $$;
create function pg_temp.st(p_id bigint) returns text language sql as $$ select status || '/' || verdict || '/' || version from public.anomalies where id = p_id $$;
create function pg_temp.nev(p_id bigint) returns integer language sql as $$ select count(*)::int from public.anomaly_events where anomaly_id = p_id $$;
-- 이력 요약: 종류:이전>이후@역할 (번호 순서대로)
create function pg_temp.ev(p_id bigint) returns text language sql as $$
  select string_agg(event_type || ':' || coalesce(from_value, '-') || '>' || to_value || '@' || actor_role, ' | ' order by id) from public.anomaly_events where anomaly_id = p_id
$$;

-- 함수 호출 도구 (버전을 안 주면 지금 버전으로 부른다)
create function pg_temp.asg(p_who text, p_id bigint, p_assignee text, p_ver integer default null) returns text language sql as $$
  select pg_temp.r(p_who, format('select public.assign_anomaly(%s, %L::uuid, %s)', p_id, coalesce(pg_temp.uid_of(p_assignee)::text, p_assignee), coalesce(p_ver, pg_temp.ver(p_id), 1)))
$$;
create function pg_temp.vd(p_who text, p_id bigint, p_verdict text, p_ver integer default null) returns text language sql as $$
  select pg_temp.r(p_who, format('select public.set_verdict(%s, %L, %s)', p_id, p_verdict, coalesce(p_ver, pg_temp.ver(p_id), 1)))
$$;
create function pg_temp.cs(p_who text, p_id bigint, p_to text, p_verdict text default null, p_note text default null, p_ver integer default null) returns text language sql as $$
  select pg_temp.r(p_who, format('select public.change_anomaly_status(%s, %L, %L, %L, %s)', p_id, p_to, p_verdict, p_note, coalesce(p_ver, pg_temp.ver(p_id), 1)))
$$;

select plan(179);

-- ---------------------------------------------------------------- 시험용 계정
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-op-a@example.invalid', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'pgtap-op-b@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-admin@example.invalid', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'pgtap-noprofile@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '담당자 A', 'operator'),
  ('33333333-3333-4333-8333-333333333333', '담당자 B', 'operator'),
  ('22222222-2222-4222-8222-222222222222', '시험 팀장', 'admin');

-- ================================================================ 1. 실행 권한 · 함수 설정 (11)
select ok(not has_function_privilege('anon', 'public.assign_anomaly(bigint, uuid, integer)', 'EXECUTE'), 'assign_anomaly: 비로그인(anon)은 실행할 수 없음');
select ok(not has_function_privilege('anon', 'public.set_verdict(bigint, text, integer)', 'EXECUTE'), 'set_verdict: 비로그인(anon)은 실행할 수 없음');
select ok(not has_function_privilege('anon', 'public.change_anomaly_status(bigint, text, text, text, integer)', 'EXECUTE'), 'change_anomaly_status: 비로그인(anon)은 실행할 수 없음');
select ok(has_function_privilege('authenticated', 'public.assign_anomaly(bigint, uuid, integer)', 'EXECUTE'), 'assign_anomaly: 로그인 사용자는 실행할 수 있음');
select ok(has_function_privilege('authenticated', 'public.set_verdict(bigint, text, integer)', 'EXECUTE'), 'set_verdict: 로그인 사용자는 실행할 수 있음');
select ok(has_function_privilege('authenticated', 'public.change_anomaly_status(bigint, text, text, text, integer)', 'EXECUTE'), 'change_anomaly_status: 로그인 사용자는 실행할 수 있음');
select ok(
  not has_function_privilege('service_role', 'public.assign_anomaly(bigint, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.set_verdict(bigint, text, integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.change_anomaly_status(bigint, text, text, text, integer)', 'EXECUTE'),
  '서버 관리용 키(service_role)는 세 함수를 실행할 수 없음 (사용자 로그인 정보로만 부른다)');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in ('public.assign_anomaly(bigint, uuid, integer)'::regprocedure, 'public.set_verdict(bigint, text, integer)'::regprocedure,
                    'public.change_anomaly_status(bigint, text, text, text, integer)'::regprocedure)),
  '세 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음');
do $$ begin perform pg_temp.mk('G1', 'open', 'undetermined'); end $$;
select is(pg_temp.asg('ANON', (select id from public.anomalies where item_key = 'G1'), 'A', 1), '42501', '비로그인(anon)이 배정 함수를 부르면 권한 없음(42501)');
select is(pg_temp.vd('ANON', (select id from public.anomalies where item_key = 'G1'), 'confirmed_issue', 1), '42501', '비로그인(anon)이 판정 함수를 부르면 권한 없음(42501)');
select is(pg_temp.cs('ANON', (select id from public.anomalies where item_key = 'G1'), 'investigating', null, null, 1), '42501', '비로그인(anon)이 상태 변경 함수를 부르면 권한 없음(42501)');

-- ================================================================ 2. 로그인 정보가 없거나 프로필이 없는 사용자 (7)
create temp table g2 as select pg_temp.mk('G2-open', 'open', 'undetermined') as oid, pg_temp.mk('G2-inv', 'investigating', 'undetermined') as iid;
select is(pg_temp.asg('NONE', (select oid from g2), 'A'), 'FORBIDDEN', '로그인 정보(사용자 ID)가 없으면 배정 FORBIDDEN');
select is(pg_temp.vd('NONE', (select iid from g2), 'confirmed_issue'), 'FORBIDDEN', '로그인 정보가 없으면 판정 FORBIDDEN');
select is(pg_temp.cs('NONE', (select oid from g2), 'investigating'), 'FORBIDDEN', '로그인 정보가 없으면 상태 변경 FORBIDDEN');
select is(pg_temp.asg('X', (select oid from g2), 'X'), 'FORBIDDEN', '프로필(역할)이 없는 계정은 배정 FORBIDDEN');
select is(pg_temp.vd('X', (select iid from g2), 'confirmed_issue'), 'FORBIDDEN', '프로필이 없는 계정은 판정 FORBIDDEN');
select is(pg_temp.cs('X', (select oid from g2), 'investigating'), 'FORBIDDEN', '프로필이 없는 계정은 상태 변경 FORBIDDEN');
select is(pg_temp.nev((select oid from g2)) + pg_temp.nev((select iid from g2)), 0, '거부된 요청은 이력을 남기지 않음');

-- ================================================================ 3. assign_anomaly (33)
create temp table g3 as select
  pg_temp.mk('G3-1', 'open', 'undetermined') as u1,          -- 담당자 없음
  pg_temp.mk('G3-2', 'open', 'undetermined') as u2,
  pg_temp.mk('G3-3', 'open', 'undetermined', null, 'DATE_ORDER', 3) as u3, -- 버전 3
  pg_temp.mk('G3-4', 'open', 'undetermined') as u4,
  pg_temp.mk('G3-5', 'resolved', 'confirmed_issue') as closed;

select is(pg_temp.asg('A', 999999999, 'A', 1), 'NOT_FOUND', '없는 건은 NOT_FOUND');
-- 운영 담당자: 미배정 건을 본인에게
select is(pg_temp.asg('A', (select u1 from g3), 'A'), 'OK:2', 'operator가 미배정 건을 본인에게 배정하면 성공하고 새 버전 2를 돌려줌');
select is((select assignee_id from public.anomalies where id = (select u1 from g3)), pg_temp.uid_of('A'), '담당자가 본인으로 바뀜');
select is(pg_temp.st((select u1 from g3)), 'open/undetermined/2', '배정은 처리상태·판정을 바꾸지 않고 버전만 1 올림');
select is(pg_temp.nev((select u1 from g3)), 1, '이력이 정확히 1줄 남음');
select is(
  (select actor_type || '/' || actor_id::text || '/' || actor_role || '/' || event_type || '/' || coalesce(from_value, 'null') || '/' || to_value from public.anomaly_events where anomaly_id = (select u1 from g3)),
  'user/' || pg_temp.uid_of('A')::text || '/operator/assigned/null/' || pg_temp.uid_of('A')::text,
  '이력: 사용자 A(operator)가 assigned, 이전 담당자 없음(null) → A');
select is(pg_temp.asg('A', (select u1 from g3), 'A'), 'ALREADY_ASSIGNED', '같은 담당자로 다시 배정하면 ALREADY_ASSIGNED');
select is(pg_temp.asg('B', (select u1 from g3), 'B'), 'ALREADY_ASSIGNED', '이미 담당자가 있는 건을 다른 operator가 가져가려 하면 ALREADY_ASSIGNED');
select is(pg_temp.asg('B', (select u1 from g3), 'A'), 'FORBIDDEN', 'operator가 남에게 배정하려 하면 FORBIDDEN (SEC-08)');
select is(pg_temp.st((select u1 from g3)) || '/' || pg_temp.nev((select u1 from g3)), 'open/undetermined/2/1', '거부된 요청은 버전·이력을 바꾸지 않음');
select is(pg_temp.asg('A', (select u2 from g3), 'B'), 'FORBIDDEN', 'operator가 미배정 건을 남(B)에게 배정하려 하면 FORBIDDEN');
select is(pg_temp.asg('A', (select u2 from g3), null), 'FORBIDDEN', 'operator가 담당자를 비우려(null) 하면 FORBIDDEN');
select is((select assignee_id is null from public.anomalies where id = (select u2 from g3)) and pg_temp.nev((select u2 from g3)) = 0, true, '거부된 건은 여전히 미배정이고 이력도 없음');
select is(pg_temp.asg('A', (select u3 from g3), 'A', 2), 'VERSION_CONFLICT', '화면의 버전이 오래되면 VERSION_CONFLICT');
select is(pg_temp.st((select u3 from g3)) || '/' || pg_temp.nev((select u3 from g3)), 'open/undetermined/3/0', '버전 충돌 때 아무것도 바뀌지 않음');
select is(pg_temp.asg('A', (select u3 from g3), 'A', 3), 'OK:4', '맞는 버전이면 성공 (3 → 4)');
-- 팀장
select is(pg_temp.asg('ADM', (select u4 from g3), 'A'), 'OK:2', 'admin이 미배정 건을 A에게 지정');
select is(pg_temp.asg('ADM', (select u4 from g3), 'B'), 'OK:3', 'admin이 A의 건을 B로 재배정');
select is(
  (select string_agg(coalesce(from_value, 'null') || '>' || to_value || '@' || actor_role, ' | ' order by id) from public.anomaly_events where anomaly_id = (select u4 from g3)),
  'null>' || pg_temp.uid_of('A')::text || '@admin | ' || pg_temp.uid_of('A')::text || '>' || pg_temp.uid_of('B')::text || '@admin',
  '이력 2줄: 지정(null→A)과 재배정(A→B), 둘 다 팀장(admin)이 처리한 것으로 기록');
select is(pg_temp.asg('ADM', (select u4 from g3), 'B'), 'ALREADY_ASSIGNED', 'admin이 같은 담당자로 다시 배정하면 ALREADY_ASSIGNED');
select is(pg_temp.asg('ADM', (select u4 from g3), '55555555-5555-4555-8555-555555555555'), 'INVALID_ASSIGNEE', '존재하지 않는 사용자에게 배정하면 INVALID_ASSIGNEE');
select is(pg_temp.asg('ADM', (select u4 from g3), null), 'INVALID_ASSIGNEE', '담당자를 비우려(null) 하면 INVALID_ASSIGNEE');
select is(pg_temp.asg('ADM', (select u4 from g3), 'X'), 'INVALID_ASSIGNEE', '프로필이 없는 계정에게는 배정할 수 없음 (INVALID_ASSIGNEE)');
select is(pg_temp.asg('ADM', (select u4 from g3), 'A', 1), 'VERSION_CONFLICT', 'admin도 오래된 버전이면 VERSION_CONFLICT');
select is(pg_temp.st((select u4 from g3)) || '/' || pg_temp.nev((select u4 from g3)), 'open/undetermined/3/2', '거부된 요청은 버전·이력을 바꾸지 않음');
select is(pg_temp.asg('ADM', (select closed from g3), 'A'), 'OK:2', '종결(resolved) 건도 배정할 수 있음 (PRD: 배정은 상태를 바꾸지 않음)');
select is(pg_temp.st((select closed from g3)), 'resolved/confirmed_issue/2', '종결 건의 상태·판정은 그대로');
select is(pg_temp.asg('A', 999999999, 'B', 1), 'NOT_FOUND', '없는 건은 권한 확인보다 먼저 NOT_FOUND (건 정보 노출 없음)');
select is(pg_temp.asg('A', (select closed from g3), 'B'), 'FORBIDDEN', 'operator의 남에게 배정은 종결 건에서도 FORBIDDEN');
select is(pg_temp.asg('B', (select closed from g3), 'B', 1), 'VERSION_CONFLICT', '권한이 맞으면 그다음에 버전을 봄 (오래된 버전이 ALREADY_ASSIGNED보다 먼저)');
select is((select count(*)::int from public.anomaly_events where anomaly_id in (select u1 from g3 union select u2 from g3 union select u3 from g3 union select u4 from g3 union select closed from g3)), 5, '배정 이력 합계: 성공한 5번만 남음 (u1 1 + u3 1 + u4 2 + closed 1)');

-- ================================================================ 4. set_verdict (21)
create temp table g4 as select
  pg_temp.mk('G4-open', 'open', 'undetermined', 'A') as o,
  pg_temp.mk('G4-inv', 'investigating', 'undetermined', 'A') as i,
  pg_temp.mk('G4-unas', 'investigating', 'undetermined') as unas,
  pg_temp.mk('G4-res', 'resolved', 'confirmed_issue', 'A') as res,
  pg_temp.mk('G4-inv2', 'investigating', 'confirmed_issue', 'B') as i2;

select is(pg_temp.vd('A', 999999999, 'confirmed_issue', 1), 'NOT_FOUND', '없는 건은 NOT_FOUND');
select is(pg_temp.vd('A', (select o from g4), 'confirmed_issue'), 'NOT_INVESTIGATING', 'open 상태에서는 판정만 바꿀 수 없음 (NOT_INVESTIGATING)');
select is(pg_temp.vd('A', (select res from g4), 'false_positive'), 'NOT_INVESTIGATING', 'resolved 상태에서도 NOT_INVESTIGATING');
select is(pg_temp.vd('B', (select i from g4), 'confirmed_issue'), 'FORBIDDEN', '남(A)의 담당 건 판정은 operator B에게 FORBIDDEN (SEC-08)');
select is(pg_temp.vd('A', (select unas from g4), 'confirmed_issue'), 'FORBIDDEN', '담당자 없는 건 판정은 operator에게 FORBIDDEN');
select is(pg_temp.st((select i from g4)) || '/' || pg_temp.nev((select i from g4)), 'investigating/undetermined/1/0', '거부된 요청은 아무것도 바꾸지 않음');
select is(pg_temp.vd('A', (select i from g4), 'confirmed_issue', 7), 'VERSION_CONFLICT', '오래된 버전이면 VERSION_CONFLICT');
select is(pg_temp.vd('A', (select i from g4), 'undetermined'), 'VERDICT_MISMATCH', '현재 판정과 같은 값으로 바꾸려 하면 거부 (바뀌는 것이 없음)');
select is(pg_temp.vd('A', (select i from g4), 'bogus'), 'VERDICT_MISMATCH', '모르는 판정 값은 거부');
select is(pg_temp.vd('A', (select i from g4), null), 'VERDICT_MISMATCH', '판정 값이 비어 있으면 거부');
select is(pg_temp.vd('A', (select i from g4), 'confirmed_issue'), 'OK:2', '본인 담당 건 판정 변경 성공 (새 버전 2)');
select is(pg_temp.st((select i from g4)), 'investigating/confirmed_issue/2', '판정만 바뀌고 처리상태는 investigating 그대로');
select is(pg_temp.ev((select i from g4)), 'verdict_changed:undetermined>confirmed_issue@operator', '이력 1줄: verdict_changed, 이전 → 이후, 역할 operator');
select is((select actor_id from public.anomaly_events where anomaly_id = (select i from g4)), pg_temp.uid_of('A'), '이력의 행위자는 A');
select is(pg_temp.vd('A', (select i from g4), 'false_positive'), 'OK:3', '판정을 다시 바꿀 수 있음 (confirmed_issue → false_positive)');
select is(pg_temp.vd('A', (select i from g4), 'undetermined'), 'OK:4', '미판정으로 되돌릴 수도 있음');
select is(pg_temp.nev((select i from g4)), 3, '변경마다 이력이 1줄씩 (합계 3줄)');
select is(pg_temp.vd('ADM', (select i2 from g4), 'false_positive'), 'OK:2', 'admin은 남(B)의 담당 건 판정도 가능');
select is(pg_temp.ev((select i2 from g4)), 'verdict_changed:confirmed_issue>false_positive@admin', '이력에는 팀장(admin)이 처리한 것으로 기록');
select is(pg_temp.vd('ADM', (select unas from g4), 'false_positive'), 'OK:2', 'admin은 담당자 없는 건 판정도 가능');
select is(pg_temp.vd('ADM', (select o from g4), 'confirmed_issue'), 'NOT_INVESTIGATING', 'admin도 investigating이 아니면 NOT_INVESTIGATING');

-- ================================================================ 5. change_anomaly_status: 허용 전이 5개 + 이력 (28)
create temp table g5 as select
  pg_temp.mk('G5-a', 'open', 'undetermined', 'A') as a,       -- A: 검토 시작 → 조치 완료 → 재개
  pg_temp.mk('G5-b', 'investigating', 'undetermined', 'B') as b, -- 팀장: 정상 판정 → 재개
  pg_temp.mk('G5-c', 'investigating', 'confirmed_issue', 'A') as c, -- 판정을 미리 정해 둔 건
  pg_temp.mk('G5-d', 'open', 'undetermined') as d;            -- 담당자 없음

-- ① open → investigating (검토 시작)
select is(pg_temp.cs('A', (select a from g5), 'investigating'), 'OK:2', '① 본인 담당 open → investigating 성공 (새 버전 2, 사유는 선택)');
select is(pg_temp.st((select a from g5)), 'investigating/undetermined/2', '검토 시작: 판정은 미판정 그대로');
select is(pg_temp.ev((select a from g5)), 'status_changed:open>investigating@operator', '이력 1줄: status_changed open → investigating (operator)');
-- ② investigating → resolved (판정 짝 + 조치내용)
select is(pg_temp.cs('A', (select a from g5), 'resolved', 'confirmed_issue', '담당 부서에 수정 요청하여 조치 완료'), 'OK:3', '② investigating → resolved 성공');
select is(pg_temp.st((select a from g5)), 'resolved/confirmed_issue/3', '상태 resolved, 판정 confirmed_issue, 버전 3');
select is(
  pg_temp.ev((select a from g5)),
  'status_changed:open>investigating@operator | verdict_changed:undetermined>confirmed_issue@operator | status_changed:investigating>resolved@operator',
  '판정이 함께 바뀌면 이력 2줄: verdict_changed 1줄 + status_changed 1줄 (판정 먼저)');
select is((select note from public.anomaly_events where anomaly_id = (select a from g5) and to_value = 'resolved'), '담당 부서에 수정 요청하여 조치 완료', '조치내용은 상태 변경 이력의 note에 남음');
-- ⑤ resolved → investigating (재개)
select is(pg_temp.cs('A', (select a from g5), 'investigating', null, '수정 후에도 같은 값이 다시 보여 재검토'), 'OK:4', '⑤ resolved → investigating(재개) 성공');
select is(pg_temp.st((select a from g5)), 'investigating/undetermined/4', '재개하면 판정이 undetermined로 초기화');
select is(
  (select string_agg(event_type || ':' || from_value || '>' || to_value, ' | ' order by id desc) from (select * from public.anomaly_events where anomaly_id = (select a from g5) order by id desc limit 2) t),
  'status_changed:resolved>investigating | verdict_changed:confirmed_issue>undetermined',
  '재개 이력 2줄: 이전 판정(confirmed_issue)이 verdict_changed로 남고 status_changed가 이어짐');
select is(pg_temp.nev((select a from g5)), 5, '이 건의 이력 합계 5줄 (1 + 2 + 2)');
-- ③ investigating → dismissed (팀장이 남의 건을)
select is(pg_temp.cs('ADM', (select b from g5), 'dismissed', 'false_positive', '원본 공고가 정상이어서 오탐으로 판정'), 'OK:2', '③ admin이 남(B)의 investigating → dismissed 성공');
select is(pg_temp.st((select b from g5)), 'dismissed/false_positive/2', '상태 dismissed, 판정 false_positive');
select is(pg_temp.ev((select b from g5)), 'verdict_changed:undetermined>false_positive@admin | status_changed:investigating>dismissed@admin', '이력 2줄 모두 팀장(admin)이 처리한 것으로 기록');
-- ④ dismissed → investigating (재개)
select is(pg_temp.cs('ADM', (select b from g5), 'investigating', 'undetermined', '새 증거가 나와 정상 판정을 철회'), 'OK:3', '④ dismissed → investigating 성공 (판정에 undetermined를 명시해도 됨)');
select is(pg_temp.st((select b from g5)), 'investigating/undetermined/3', '재개 후 미판정');
-- 판정을 미리 정해 둔 건은 판정을 비워도 현재 판정으로 닫을 수 있고 이력은 1줄
select is(pg_temp.cs('A', (select c from g5), 'resolved', null, '현장 확인 후 정정 조치함'), 'OK:2', '미리 confirmed_issue로 판정해 둔 건은 판정을 비워도 resolved로 닫힘');
select is(pg_temp.ev((select c from g5)), 'status_changed:investigating>resolved@operator', '판정이 안 바뀌면 이력은 status_changed 1줄만');
-- 팀장은 담당자 없는 건도 검토 시작 가능
select is(pg_temp.cs('ADM', (select d from g5), 'investigating'), 'OK:2', 'admin은 담당자 없는 건도 검토 시작 가능');
select is(pg_temp.ev((select d from g5)), 'status_changed:open>investigating@admin', '이력은 팀장(admin) 처리');
-- 없는 건
select is(pg_temp.cs('A', 999999999, 'investigating', null, null, 1), 'NOT_FOUND', '없는 건은 NOT_FOUND');
-- 이력 행위자
select is((select count(*)::int from public.anomaly_events where anomaly_id in (select a from g5 union select b from g5 union select c from g5 union select d from g5) and actor_type = 'user' and actor_id is not null and actor_role in ('operator', 'admin')), 11, '이 그룹의 이력 11줄 모두 사용자(actor_type=user)·행위자·당시 역할이 기록됨');
select is((select count(*)::int from public.anomaly_events where anomaly_id in (select a from g5) and actor_role = 'operator' and actor_id = pg_temp.uid_of('A')), 5, 'A가 한 이력의 행위자 ID가 A로 남음');
select is((select count(*)::int from public.anomaly_events where anomaly_id in (select b from g5) and actor_role = 'admin' and actor_id = pg_temp.uid_of('ADM')), 4, '팀장이 한 이력의 행위자 ID가 팀장으로 남음');
select is(pg_temp.cs('B', (select b from g5), 'resolved', 'confirmed_issue', '권한이 맞는 B가 정상적으로 닫음'), 'OK:4', '담당자 B는 자기 담당 건(팀장이 재개한 건)을 닫을 수 있음');
select is(pg_temp.st((select b from g5)), 'resolved/confirmed_issue/4', '결과 상태 확인');
select is(pg_temp.cs('B', (select b from g5), 'investigating', null, '다시 살펴보기 위해 재개합니다'), 'OK:5', '담당자는 자기 담당 종결 건도 재개할 수 있음');
select is(pg_temp.st((select b from g5)), 'investigating/undetermined/5', '재개 후 상태');

-- ================================================================ 6. 허용되지 않는 전이 (17)
create temp table g6 as select
  pg_temp.mk('G6-open', 'open', 'undetermined', 'A') as o,
  pg_temp.mk('G6-inv', 'investigating', 'undetermined', 'A') as i,
  pg_temp.mk('G6-res', 'resolved', 'confirmed_issue', 'A') as r,
  pg_temp.mk('G6-dis', 'dismissed', 'false_positive', 'A') as d;

select is(
  pg_temp.cs('ADM', (select case t.f when 'open' then o when 'investigating' then i when 'resolved' then r else d end from g6), t.to_s, t.v, '충분히 긴 사유 문장입니다 열자 넘음'),
  'INVALID_TRANSITION', t.f || ' → ' || coalesce(t.to_s, 'NULL') || ' 는 거부')
from (values
  ('open', 'open', null), ('open', 'resolved', 'confirmed_issue'), ('open', 'dismissed', 'false_positive'),
  ('investigating', 'open', null), ('investigating', 'investigating', null),
  ('resolved', 'open', null), ('resolved', 'resolved', 'confirmed_issue'), ('resolved', 'dismissed', 'false_positive'),
  ('dismissed', 'open', null), ('dismissed', 'resolved', 'confirmed_issue'), ('dismissed', 'dismissed', 'false_positive'),
  ('open', 'bogus', null), ('open', null, null)
) as t(f, to_s, v);
select is(
  (select string_agg(pg_temp.st(x), ',' order by x) from (select o as x from g6 union all select i from g6 union all select r from g6 union all select d from g6) s),
  'open/undetermined/1,investigating/undetermined/1,resolved/confirmed_issue/1,dismissed/false_positive/1',
  '거부된 요청은 네 건 모두 상태·판정·버전을 바꾸지 않음');
select is((select count(*)::int from public.anomaly_events where anomaly_id in (select o from g6 union select i from g6 union select r from g6 union select d from g6)), 0, '거부된 요청은 이력을 남기지 않음');
select is(pg_temp.cs('ADM', (select o from g6), 'investigating', null, null, 1), 'OK:2', '같은 건도 허용 전이(open → investigating)는 성공 (대조군)');
select is(pg_temp.cs('ADM', (select i from g6), 'open', null, null), 'INVALID_TRANSITION', 'investigating → open (되돌리기)는 거부');
select is(pg_temp.cs('ADM', (select r from g6), 'dismissed', 'false_positive', '충분히 긴 사유 문장입니다 열자 넘음'), 'INVALID_TRANSITION', '종결 건끼리 바로 바꾸는 것(resolved → dismissed)은 거부 — 재개를 거쳐야 함');
select is(pg_temp.st((select r from g6)), 'resolved/confirmed_issue/1', '종결 건은 그대로');

-- ================================================================ 7. 판정 짝 (VERDICT_MISMATCH) (12)
create temp table g7 as select
  pg_temp.mk('G7-1', 'investigating', 'undetermined', 'A') as i1,
  pg_temp.mk('G7-2', 'investigating', 'confirmed_issue', 'A') as i2,
  pg_temp.mk('G7-3', 'open', 'undetermined', 'A') as o,
  pg_temp.mk('G7-4', 'resolved', 'confirmed_issue', 'A') as r;

select is(pg_temp.cs('A', (select i1 from g7), 'resolved', 'false_positive', '충분히 긴 조치내용 문장입니다'), 'VERDICT_MISMATCH', 'resolved는 false_positive와 짝이 안 맞음');
select is(pg_temp.cs('A', (select i1 from g7), 'resolved', 'undetermined', '충분히 긴 조치내용 문장입니다'), 'VERDICT_MISMATCH', 'resolved는 미판정(undetermined)으로 닫을 수 없음');
select is(pg_temp.cs('A', (select i1 from g7), 'resolved', null, '충분히 긴 조치내용 문장입니다'), 'VERDICT_MISMATCH', '판정을 비웠고 현재도 미판정이면 resolved로 닫을 수 없음');
select is(pg_temp.cs('A', (select i1 from g7), 'dismissed', 'confirmed_issue', '충분히 긴 판정 사유 문장입니다'), 'VERDICT_MISMATCH', 'dismissed는 confirmed_issue와 짝이 안 맞음');
select is(pg_temp.cs('A', (select i1 from g7), 'dismissed', null, '충분히 긴 판정 사유 문장입니다'), 'VERDICT_MISMATCH', '판정을 비웠고 현재 미판정이면 dismissed로 닫을 수 없음');
select is(pg_temp.cs('A', (select i2 from g7), 'dismissed', null, '충분히 긴 판정 사유 문장입니다'), 'VERDICT_MISMATCH', '현재 판정이 confirmed_issue인 건을 판정 없이 dismissed로 닫을 수 없음');
select is(pg_temp.cs('A', (select i2 from g7), 'dismissed', 'false_positive', '충분히 긴 판정 사유 문장입니다'), 'OK:2', '판정을 false_positive로 함께 바꾸면 dismissed로 닫을 수 있음');
select is(pg_temp.ev((select i2 from g7)), 'verdict_changed:confirmed_issue>false_positive@operator | status_changed:investigating>dismissed@operator', '판정이 바뀌는 종결도 이력 2줄');
select is(pg_temp.cs('A', (select o from g7), 'investigating', 'confirmed_issue'), 'VERDICT_MISMATCH', '검토 시작 때 판정을 정해 넘기면 거부');
select is(pg_temp.cs('A', (select r from g7), 'investigating', 'confirmed_issue', '다시 살펴보기 위한 재개 사유'), 'VERDICT_MISMATCH', '재개 때 판정을 유지하려 하면 거부 (재개는 항상 미판정으로 되돌림)');
select is(pg_temp.st((select i1 from g7)) || ' ' || pg_temp.st((select o from g7)) || ' ' || pg_temp.st((select r from g7)), 'investigating/undetermined/1 open/undetermined/1 resolved/confirmed_issue/1', '거부된 요청은 아무것도 바꾸지 않음');
select is(pg_temp.nev((select i1 from g7)) + pg_temp.nev((select o from g7)) + pg_temp.nev((select r from g7)), 0, '거부된 요청은 이력도 남기지 않음');

-- ================================================================ 8. 사유 10자 경계 (REASON_TOO_SHORT) (17)
create temp table g8 as select
  pg_temp.mk('G8-res9', 'investigating', 'undetermined', 'A') as res9,
  pg_temp.mk('G8-res10', 'investigating', 'undetermined', 'A') as res10,
  pg_temp.mk('G8-dis9', 'investigating', 'undetermined', 'A') as dis9,
  pg_temp.mk('G8-dis10', 'investigating', 'undetermined', 'A') as dis10,
  pg_temp.mk('G8-reo9', 'resolved', 'confirmed_issue', 'A') as reo9,
  pg_temp.mk('G8-reo10', 'resolved', 'confirmed_issue', 'A') as reo10,
  pg_temp.mk('G8-sp', 'investigating', 'undetermined', 'A') as sp;

select is(pg_temp.cs('A', (select res9 from g8), 'resolved', 'confirmed_issue', '가나다라마바사아자'), 'REASON_TOO_SHORT', '조치내용 9자는 거부');
select is(pg_temp.cs('A', (select res10 from g8), 'resolved', 'confirmed_issue', '가나다라마바사아자차'), 'OK:2', '조치내용 10자는 허용 (경계)');
select is(pg_temp.cs('A', (select dis9 from g8), 'dismissed', 'false_positive', '가나다라마바사아자'), 'REASON_TOO_SHORT', '판정 사유 9자는 거부');
select is(pg_temp.cs('A', (select dis10 from g8), 'dismissed', 'false_positive', '가나다라마바사아자차'), 'OK:2', '판정 사유 10자는 허용 (경계)');
select is(pg_temp.cs('A', (select reo9 from g8), 'investigating', null, '가나다라마바사아자'), 'REASON_TOO_SHORT', '재개 사유 9자는 거부');
select is(pg_temp.cs('A', (select reo10 from g8), 'investigating', null, '가나다라마바사아자차'), 'OK:2', '재개 사유 10자는 허용 (경계)');
select is(pg_temp.cs('A', (select sp from g8), 'resolved', 'confirmed_issue', '가나다라마바사아자' || repeat(' ', 30)), 'REASON_TOO_SHORT', '공백을 아무리 붙여도 공백 제외 9자면 거부');
select is(pg_temp.cs('A', (select sp from g8), 'resolved', 'confirmed_issue', E'가나다\n라마바\t사아자'), 'REASON_TOO_SHORT', '줄바꿈·탭도 공백으로 세지 않음 (9자 거부)');
select is(pg_temp.cs('A', (select sp from g8), 'resolved', 'confirmed_issue', null), 'REASON_TOO_SHORT', '사유가 비어 있으면(null) 거부');
select is(pg_temp.cs('A', (select sp from g8), 'resolved', 'confirmed_issue', '          '), 'REASON_TOO_SHORT', '공백만 있는 사유는 거부');
select is(pg_temp.cs('A', (select sp from g8), 'dismissed', 'false_positive', ''), 'REASON_TOO_SHORT', '빈 문자열 사유는 거부');
select is(pg_temp.st((select sp from g8)) || '/' || pg_temp.nev((select sp from g8)), 'investigating/undetermined/1/0', '거부된 요청은 아무것도 바꾸지 않음');
select is(pg_temp.cs('A', (select sp from g8), 'resolved', 'confirmed_issue', '가나다 라마바 사아자차'), 'OK:2', '글자 사이 공백은 세지 않고 공백 제외 10자면 허용');
select is(pg_temp.st((select res9 from g8)) || ' ' || pg_temp.st((select dis9 from g8)) || ' ' || pg_temp.st((select reo9 from g8)), 'investigating/undetermined/1 investigating/undetermined/1 resolved/confirmed_issue/1', '9자로 거부된 세 건은 그대로');
select is((select note from public.anomaly_events where anomaly_id = (select sp from g8) and event_type = 'status_changed'), '가나다 라마바 사아자차', '사유는 앞뒤 공백만 잘라서 그대로 저장');
select is(pg_temp.cs('A', (select sp from g8), 'investigating', null, '    재개합니다    재개합니다'), 'OK:3', '앞뒤 공백이 있어도 공백 제외 10자 이상이면 허용');
select is((select note from public.anomaly_events where anomaly_id = (select sp from g8) and to_value = 'investigating' and event_type = 'status_changed'), '재개합니다    재개합니다', '앞뒤 공백은 저장 때 잘림');

-- ================================================================ 9. 재개 시 열린 중복 건 (ACTIVE_DUPLICATE_EXISTS) (11)
create temp table g9 as select
  pg_temp.mk('G9-same', 'resolved', 'confirmed_issue', 'A') as old_res,
  pg_temp.mk('G9-same2', 'dismissed', 'false_positive', 'A') as old_dis,
  pg_temp.mk('G9-other', 'resolved', 'confirmed_issue', 'A', 'REQUIRED_FIELD') as other_rule;
-- 같은 출처·물건·규칙의 열린 건 (재발 건)
create temp table g9b as select
  pg_temp.mk('G9-same', 'open', 'undetermined') as act1,
  pg_temp.mk('G9-same2', 'investigating', 'undetermined', 'B') as act2,
  pg_temp.mk('G9-other', 'open', 'undetermined', 'B', 'DATE_ORDER') as diff_rule_open; -- 규칙이 다르면 중복이 아님

select is(pg_temp.cs('A', (select old_res from g9), 'investigating', null, '다시 살펴보기 위해 재개합니다'), 'ACTIVE_DUPLICATE_EXISTS:' || (select act1 from g9b), 'open 재발 건이 있으면 재개 거부 + 그 건 번호를 알려 줌');
select is(pg_temp.cs('A', (select old_dis from g9), 'investigating', null, '다시 살펴보기 위해 재개합니다'), 'ACTIVE_DUPLICATE_EXISTS:' || (select act2 from g9b), 'investigating 재발 건이 있어도 재개 거부');
select is(pg_temp.cs('ADM', (select old_res from g9), 'investigating', null, '팀장도 열린 중복 건은 못 넘어갑니다'), 'ACTIVE_DUPLICATE_EXISTS:' || (select act1 from g9b), 'admin도 거부');
select is(pg_temp.st((select old_res from g9)) || ' ' || pg_temp.st((select old_dis from g9)), 'resolved/confirmed_issue/1 dismissed/false_positive/1', '거부된 재개는 아무것도 바꾸지 않음');
select is(pg_temp.nev((select old_res from g9)) + pg_temp.nev((select old_dis from g9)), 0, '거부된 재개는 이력도 남기지 않음');
select is(pg_temp.cs('A', (select other_rule from g9), 'investigating', null, '규칙이 다른 열린 건은 중복이 아님'), 'OK:2', '규칙이 다른 열린 건은 중복이 아니므로 재개 가능');
-- 열린 건이 종결되면 재개할 수 있다
update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = (select act1 from g9b);
select is(pg_temp.cs('A', (select old_res from g9), 'investigating', null, '이제 열린 건이 없어 재개합니다'), 'OK:2', '열린 건이 종결되면 재개 성공');
select is(pg_temp.st((select old_res from g9)), 'investigating/undetermined/2', '재개된 건 상태');
-- 사유가 부족하면 중복 안내보다 사유 오류가 먼저 (사용자가 사유부터 고치게)
select is(pg_temp.cs('A', (select old_dis from g9), 'investigating', null, '짧은사유'), 'REASON_TOO_SHORT', '사유가 짧으면 중복 확인에 앞서 REASON_TOO_SHORT');
-- 재개로 두 번째 열린 건이 생기지 않는다 (재개 후 같은 신원의 열린 건은 1개)
select is((select count(*)::int from public.anomalies where item_key = 'G9-same' and rule_id = 'DATE_ORDER' and status in ('open', 'investigating')), 1, '재개 후에도 같은 출처·물건·규칙의 열린 건은 1개');
select is((select count(*)::int from public.anomalies where item_key = 'G9-same2' and rule_id = 'DATE_ORDER' and status in ('open', 'investigating')), 1, '다른 쪽도 열린 건은 1개');

-- ================================================================ 10. 권한 · 버전 · 원자성 (change_anomaly_status) (22)
create temp table g10 as select
  pg_temp.mk('G10-A', 'open', 'undetermined', 'A') as a_open,
  pg_temp.mk('G10-B', 'investigating', 'undetermined', 'B') as b_inv,
  pg_temp.mk('G10-U', 'open', 'undetermined') as unas,
  pg_temp.mk('G10-V', 'open', 'undetermined', 'A', 'DATE_ORDER', 5) as ver5,
  pg_temp.mk('G10-N', 'investigating', 'undetermined', 'A') as atomic;

select is(pg_temp.cs('B', (select a_open from g10), 'investigating'), 'FORBIDDEN', 'operator B가 남(A)의 담당 건 상태를 바꾸려 하면 FORBIDDEN (SEC-02)');
select is(pg_temp.cs('A', (select b_inv from g10), 'resolved', 'confirmed_issue', '남의 담당 건을 닫으려는 시도'), 'FORBIDDEN', 'operator A가 남(B)의 investigating 건을 닫으려 하면 FORBIDDEN');
select is(pg_temp.cs('A', (select unas from g10), 'investigating'), 'FORBIDDEN', 'operator는 담당자 없는 건의 검토 시작도 FORBIDDEN (먼저 본인에게 배정해야 함)');
select is(pg_temp.st((select a_open from g10)) || ' ' || pg_temp.st((select b_inv from g10)) || ' ' || pg_temp.st((select unas from g10)), 'open/undetermined/1 investigating/undetermined/1 open/undetermined/1', '거부된 요청은 아무것도 바꾸지 않음');
select is(pg_temp.nev((select a_open from g10)) + pg_temp.nev((select b_inv from g10)) + pg_temp.nev((select unas from g10)), 0, '거부된 요청은 이력도 남기지 않음 (SEC-08)');
select is(pg_temp.cs('B', (select a_open from g10), 'resolved', 'confirmed_issue', '남의 건을 직접 ID로 입력한 시도'), 'FORBIDDEN', '타인 담당 건 ID를 직접 입력한 무단 변경은 FORBIDDEN (전이 오류보다 권한이 먼저)');
select is(pg_temp.cs('A', (select ver5 from g10), 'investigating', null, null, 4), 'VERSION_CONFLICT', '오래된 버전이면 VERSION_CONFLICT');
select is(pg_temp.cs('A', (select ver5 from g10), 'investigating', null, null, 6), 'VERSION_CONFLICT', '앞서간 버전도 VERSION_CONFLICT');
select is(pg_temp.cs('A', (select ver5 from g10), 'investigating', null, null, null), 'OK:6', '맞는 버전이면 성공하고 버전이 5 → 6');
select is(pg_temp.cs('A', (select ver5 from g10), 'investigating', null, null, 5), 'VERSION_CONFLICT', '같은 오래된 화면으로 다시 보내면 VERSION_CONFLICT (이중 제출 방지)');
select is(pg_temp.nev((select ver5 from g10)), 1, '버전 충돌은 이력을 남기지 않음 (성공한 1줄만)');
select is(pg_temp.cs('A', (select ver5 from g10), 'resolved', 'confirmed_issue', '버전이 맞고 권한도 맞는 요청', 6), 'OK:7', '버전을 올려 가며 이어서 처리');
select is(pg_temp.cs('A', (select ver5 from g10), 'investigating', null, '충분히 긴 재개 사유 문장입니다', 7), 'OK:8', '재개도 이어서 처리 (버전 8)');
-- 팀장은 모든 건
select is(pg_temp.cs('ADM', (select b_inv from g10), 'dismissed', 'false_positive', '팀장이 부재한 담당자 대신 처리'), 'OK:2', 'admin은 담당자 B의 건을 처리할 수 있음');
select is(pg_temp.ev((select b_inv from g10)), 'verdict_changed:undetermined>false_positive@admin | status_changed:investigating>dismissed@admin', '팀장이 처리한 이력으로 기록');
-- 원자성: 이력 추가가 실패하면 상태 변경도 함께 취소 (SEC-12)
select is(pg_temp.cs('A', (select atomic from g10), 'resolved', 'confirmed_issue', repeat('가', 2001)), '23514', '이력의 사유 길이 제한(2000자)을 넘으면 함수 전체가 실패 (SEC-12)');
select is(pg_temp.st((select atomic from g10)) || '/' || pg_temp.nev((select atomic from g10)), 'investigating/undetermined/1/0', '이력이 실패하면 상태·판정·버전 변경도 함께 취소되고 이력도 없음');
select is(pg_temp.cs('A', (select atomic from g10), 'resolved', 'confirmed_issue', '인증키가 들어간 servicekey=ABCDEFG1234 사유'), '23514', '인증키가 섞인 사유는 이력 제약에 걸려 함수 전체가 실패');
select is(pg_temp.st((select atomic from g10)), 'investigating/undetermined/1', '그때도 상태·판정·버전은 그대로');
-- 같은 건의 상태·판정 짝 제약과 정상 동작
select is(pg_temp.cs('A', (select atomic from g10), 'resolved', 'confirmed_issue', '정상적인 사유 문장입니다요'), 'OK:2', '문제가 없는 요청은 성공 (대조군)');
select is(pg_temp.ev((select atomic from g10)), 'verdict_changed:undetermined>confirmed_issue@operator | status_changed:investigating>resolved@operator', '대조군 이력 2줄');
select is(pg_temp.vd('A', (select atomic from g10), 'false_positive'), 'NOT_INVESTIGATING', '종결된 건은 판정만 바꿀 수 없음 (상태·판정 짝 유지)');

select * from finish();
rollback;

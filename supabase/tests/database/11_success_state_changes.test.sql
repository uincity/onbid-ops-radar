-- pgTAP 테스트 11: 성공 기준 "배정·상태 변경 20건 이상, 이력 누락 0건" (R08, PRD 3-1 조치 이력, PLAN 35)
-- 이상징후 20건에 배정 → 검토 시작 → 판정 → 종결을 실제 DB 함수로 거치고(10건은 팀장이 재개까지), 함수가 성공한 횟수와 이력(anomaly_events) 줄 수가 같은지 본다.
-- 이력 장부는 지울 수 없으므로 반드시 begin ... rollback 안에서만 시험한다. 시험용 계정은 이 안에서만 만든다.

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

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-op-a@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-admin@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '담당자 A', 'operator'),
  ('22222222-2222-4222-8222-222222222222', '시험 팀장', 'admin');

-- 이상징후 20건을 만들고 단계별 결과를 모은다
create temp table steps (n integer, step text, res text);
create temp table made (n integer, id bigint);

do $do$
declare
  v_id bigint;
begin
  for i in 1..20 loop
    v_id := pg_temp.mk('SUCCESS-' || i, 'open', 'undetermined');
    insert into made values (i, v_id);
    insert into steps values (i, 'assign', pg_temp.asg('A', v_id, 'A'));
    insert into steps values (i, 'start', pg_temp.cs('A', v_id, 'investigating'));
    if i % 2 = 1 then
      insert into steps values (i, 'verdict', pg_temp.vd('A', v_id, 'confirmed_issue'));
      insert into steps values (i, 'close', pg_temp.cs('A', v_id, 'resolved', null, '담당 부서에 수정 요청하여 조치 완료'));
    else
      insert into steps values (i, 'verdict', pg_temp.vd('A', v_id, 'false_positive'));
      insert into steps values (i, 'close', pg_temp.cs('A', v_id, 'dismissed', null, '원본 공고가 정상이어서 오탐으로 판정'));
    end if;
    -- 앞 10건은 팀장이 재개 사유를 적고 다시 검토를 시작한다
    if i <= 10 then
      insert into steps values (i, 'reopen', pg_temp.cs('ADM', v_id, 'investigating', null, '재확인이 필요해 팀장이 다시 검토합니다'));
    end if;
  end loop;
end
$do$;

select is((select count(*)::int from made), 20, '시험한 이상징후는 20건');
select is((select count(*)::int from steps), 90, '배정·상태 변경·판정을 합쳐 90번 요청함 (20건 × 4단계 + 재개 10번)');
select is((select count(*)::int from steps where res not like 'OK:%'), 0, '90번 모두 성공함 (거부된 요청 0건)');
-- 재개(종결 → 검토 중)는 판정을 미판정으로 되돌리면서 이전 판정을 남기는 이력이 1줄 더 생긴다 (PRD 5-3 규칙 3). 그래서 재개 10번은 이력이 2줄씩이다.
select is(
  (select count(*)::int from public.anomaly_events where anomaly_id in (select id from made)),
  100, '이력(anomaly_events) 줄 수 = 성공한 요청 90 + 재개 때 판정을 되돌린 이력 10: 이력 누락 0건');
select is(
  (select count(*)::int from made m
    join (select n, count(*) as c from steps group by n) s using (n)
   where (select count(*) from public.anomaly_events e where e.anomaly_id = m.id) <> s.c + (case when m.n <= 10 then 1 else 0 end)),
  0, '이상징후마다 이력 줄 수가 (성공한 요청 수 + 재개 시 판정 되돌림 1줄)과 같음');
select is(
  (select count(*)::int from public.anomaly_events where anomaly_id in (select id from made) and actor_type = 'user' and actor_id is not null and actor_role in ('operator', 'admin')),
  100, '이력 100줄 모두 누가(사용자·역할) 했는지가 남아 있음');
select is(
  (select string_agg(st || ':' || c, ',' order by st) from (select a.status as st, count(*) as c from public.anomalies a join made m on m.id = a.id group by a.status) x),
  'dismissed:5,investigating:10,resolved:5',
  '최종 상태: 재개한 10건은 검토 중, 나머지 10건은 조치 완료 5 + 정상 판정 5');

select * from finish();
rollback;

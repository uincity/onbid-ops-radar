-- pgTAP 테스트 02: 이력·보고서는 추가만 가능하고 누구도 고치거나 지울 수 없다  (PLAN 작업 12, SEC-05)
-- Design Ref: DESIGN §6.3·6.4(이력은 DB 함수로만 추가, 수정·삭제 불가), PRD 4-6·7-4(감사이력은 수정·삭제 금지), 7-5 SEC-05
--
-- 시험 대상: anomaly_events(이상징후 이력)와 reports(보고서 스냅샷)
-- 시험 방식: 역할(소유자·서버 관리용 키·로그인 사용자·비로그인)을 바꿔 가며 수정·삭제·비우기를 시도해 본다.
--           모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- 기대하는 오류 코드: 23000 = 변경 금지 장치(트리거)가 막음 / 42501 = 권한이 없어서 거부 / OK = 허용됨

begin;
create extension if not exists pgtap with schema extensions;

create function pg_temp.try_as(p_role text, p_sql text, p_uid uuid default null)
returns text
language plpgsql
as $$
begin
  execute format('set local role %I', p_role);
  if p_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  end if;
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

select plan(39);

-- 시험용 데이터 (이 트랜잭션 안에서만 존재)
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-operator@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-admin@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '시험 담당', 'operator'),
  ('22222222-2222-4222-8222-222222222222', '시험 팀장', 'admin');
insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'DEMO-PGTAP-1', 'DATE_ORDER', 'h1');
insert into public.anomaly_events (anomaly_id, actor_type, event_type, to_value)
  select id, 'system', 'created', 'open' from public.anomalies where item_key = 'DEMO-PGTAP-1';
insert into public.reports (report_date, source, generated_by, covers_until, content_md)
  values ((now() at time zone 'Asia/Seoul')::date, 'DEMO', '22222222-2222-4222-8222-222222222222', now(), '# 원본 보고서');

-- 시험 전 줄 수 (이미 실제 데이터가 있어도 비교할 수 있도록 기록해 둔다)
create temp table base as
  select (select count(*) from public.anomaly_events) as events, (select count(*) from public.reports) as reports;

-- ===================== anomaly_events (16개) =====================
select is(pg_temp.try_as(v.role, v.sql, v.uid::uuid), v.expected, 'anomaly_events: ' || v.label)
from (values
  -- 소유자(postgres): 권한이 있어도 변경 금지 장치가 막는다
  ('postgres', $q$update public.anomaly_events set note = '조작'$q$, null, '23000', '소유자 권한으로도 수정 불가'),
  ('postgres', $q$delete from public.anomaly_events$q$, null, '23000', '소유자 권한으로도 삭제 불가'),
  ('postgres', $q$truncate table public.anomaly_events$q$, null, '23000', '소유자 권한으로도 비우기 불가'),
  -- 서버 관리용 키(service_role): 읽기만 가능, 직접 추가도 불가(추가는 DB 함수만)
  ('service_role', $q$update public.anomaly_events set note = '조작'$q$, null, '42501', '서버 관리용 키는 수정 불가'),
  ('service_role', $q$delete from public.anomaly_events$q$, null, '42501', '서버 관리용 키는 삭제 불가'),
  ('service_role', $q$truncate table public.anomaly_events$q$, null, '42501', '서버 관리용 키는 비우기 불가'),
  ('service_role', $q$insert into public.anomaly_events (anomaly_id, actor_type, event_type, to_value) values (1, 'system', 'created', 'open')$q$, null, '42501', '서버 관리용 키는 직접 추가 불가 (추가는 DB 함수만)'),
  -- 로그인 사용자(authenticated)
  ('authenticated', $q$update public.anomaly_events set note = '조작'$q$, '11111111-1111-4111-8111-111111111111', '42501', '로그인 사용자는 수정 불가'),
  ('authenticated', $q$delete from public.anomaly_events$q$, '11111111-1111-4111-8111-111111111111', '42501', '로그인 사용자는 삭제 불가'),
  ('authenticated', $q$truncate table public.anomaly_events$q$, '11111111-1111-4111-8111-111111111111', '42501', '로그인 사용자는 비우기 불가'),
  ('authenticated', $q$insert into public.anomaly_events (anomaly_id, actor_type, event_type, to_value) values (1, 'system', 'created', 'open')$q$, '11111111-1111-4111-8111-111111111111', '42501', '로그인 사용자는 직접 추가 불가'),
  -- 비로그인(anon)
  ('anon', $q$update public.anomaly_events set note = '조작'$q$, null, '42501', '비로그인은 수정 불가'),
  ('anon', $q$delete from public.anomaly_events$q$, null, '42501', '비로그인은 삭제 불가'),
  ('anon', $q$truncate table public.anomaly_events$q$, null, '42501', '비로그인은 비우기 불가'),
  ('anon', $q$insert into public.anomaly_events (anomaly_id, actor_type, event_type, to_value) values (1, 'system', 'created', 'open')$q$, null, '42501', '비로그인은 추가 불가'),
  ('anon', $q$select 1 from public.anomaly_events limit 1$q$, null, '42501', '비로그인은 읽기도 불가')
) as v(role, sql, uid, expected, label);

-- ===================== reports (17개) =====================
select is(pg_temp.try_as(v.role, v.sql, v.uid::uuid), v.expected, 'reports: ' || v.label)
from (values
  ('postgres', $q$update public.reports set content_md = '조작'$q$, null, '23000', '소유자 권한으로도 수정 불가'),
  ('postgres', $q$delete from public.reports$q$, null, '23000', '소유자 권한으로도 삭제 불가'),
  ('postgres', $q$truncate table public.reports$q$, null, '23000', '소유자 권한으로도 비우기 불가'),
  ('service_role', $q$update public.reports set content_md = '조작'$q$, null, '42501', '서버 관리용 키는 수정 불가'),
  ('service_role', $q$delete from public.reports$q$, null, '42501', '서버 관리용 키는 삭제 불가'),
  ('service_role', $q$truncate table public.reports$q$, null, '42501', '서버 관리용 키는 비우기 불가'),
  -- 보고서는 서버가 팀장 확인 후 추가한다: 팀장 명의는 가능, 운영 담당자 명의는 불가
  ('service_role', $q$insert into public.reports (report_date, source, generated_by, covers_until, content_md) values ((now() at time zone 'Asia/Seoul')::date, 'DEMO', '22222222-2222-4222-8222-222222222222', now(), '# 서버가 추가한 보고서')$q$, null, 'OK', '서버 관리용 키는 팀장 명의의 보고서를 추가할 수 있음'),
  ('service_role', $q$insert into public.reports (report_date, source, generated_by, covers_until, content_md) values ((now() at time zone 'Asia/Seoul')::date, 'DEMO', '11111111-1111-4111-8111-111111111111', now(), '# 담당자 명의')$q$, null, '42501', '서버 관리용 키로도 운영 담당자 명의의 보고서는 추가 불가 (SEC-03)'),
  ('authenticated', $q$update public.reports set content_md = '조작'$q$, '22222222-2222-4222-8222-222222222222', '42501', '팀장 계정도 API로 직접 수정 불가'),
  ('authenticated', $q$delete from public.reports$q$, '22222222-2222-4222-8222-222222222222', '42501', '팀장 계정도 API로 직접 삭제 불가'),
  ('authenticated', $q$truncate table public.reports$q$, '22222222-2222-4222-8222-222222222222', '42501', '팀장 계정도 API로 직접 비우기 불가'),
  ('authenticated', $q$insert into public.reports (report_date, source, generated_by, covers_until, content_md) values ((now() at time zone 'Asia/Seoul')::date, 'DEMO', '22222222-2222-4222-8222-222222222222', now(), '# 직접 만든 보고서')$q$, '22222222-2222-4222-8222-222222222222', '42501', '팀장 계정도 API로 직접 보고서를 만들 수 없음 (서버가 확인 후에만 추가)'),
  ('anon', $q$update public.reports set content_md = '조작'$q$, null, '42501', '비로그인은 수정 불가'),
  ('anon', $q$delete from public.reports$q$, null, '42501', '비로그인은 삭제 불가'),
  ('anon', $q$truncate table public.reports$q$, null, '42501', '비로그인은 비우기 불가'),
  ('anon', $q$insert into public.reports (report_date, source, generated_by, covers_until, content_md) values ((now() at time zone 'Asia/Seoul')::date, 'DEMO', '22222222-2222-4222-8222-222222222222', now(), '# 비로그인')$q$, null, '42501', '비로그인은 추가 불가'),
  ('anon', $q$select 1 from public.reports limit 1$q$, null, '42501', '비로그인은 읽기도 불가')
) as v(role, sql, uid, expected, label);

-- ===================== 시도 후 상태 (4개) =====================
select is((select count(*) from public.anomaly_events), (select events from base), '이력 줄 수가 그대로임 (아무것도 추가·삭제되지 않음)');
select is((select count(*) from public.reports), (select reports + 1 from base), '보고서는 서버가 추가한 1건만 늘었음');
select is((select count(*)::int from public.anomaly_events where note = '조작'), 0, '조작된 이력이 없음');
select is((select count(*)::int from public.reports where content_md = '조작'), 0, '조작된 보고서가 없음');

-- ===================== 서버 관리용 키의 권한 (2개) =====================
select is(
  (select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'anomaly_events' and grantee = 'service_role'),
  'SELECT', 'anomaly_events: 서버 관리용 키 권한은 읽기(SELECT)뿐');
select is(
  (select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'reports' and grantee = 'service_role'),
  'INSERT,SELECT', 'reports: 서버 관리용 키 권한은 읽기·추가(INSERT,SELECT)뿐');

select * from finish();
rollback;

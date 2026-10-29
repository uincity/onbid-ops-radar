-- pgTAP 테스트 01: 사용자가 자기 역할을 바꿀 수 없다  (PLAN 작업 12, SEC-07)
-- Design Ref: DESIGN §6.4(profiles: 본인 역할 변경 불가, 관리 절차로만), PRD 4-4·7-4(사용자 본인의 역할 변경 금지), 7-5 SEC-07
--
-- 시험 방식: 시험용 로그인 계정 2개(운영 담당자·팀장)를 이 안에서만 만들고, 실제 로그인 사용자 권한(authenticated)으로
--           바꿔서 역할 변경을 시도해 본다. 모든 것은 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

-- 지정한 역할(role)로 바꿔서 SQL을 실행해 보고, 성공하면 'OK', 실패하면 오류 코드(sqlstate)를 돌려준다.
-- 실패하면 역할도 함께 원래대로 돌아온다. 로그인 사용자(authenticated)는 JWT의 사용자 ID(sub)도 함께 흉내 낸다.
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

select plan(17);

-- 시험용 계정: 운영 담당자(11111111-…)와 팀장(22222222-…)
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-operator@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-admin@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '시험 담당', 'operator'),
  ('22222222-2222-4222-8222-222222222222', '시험 팀장', 'admin');

-- 1~4. 운영 담당자(operator)가 직접 시도: 모두 권한 없음(42501)으로 거부되어야 한다
select is(
  pg_temp.try_as('authenticated', $q$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$q$, '11111111-1111-4111-8111-111111111111'),
  '42501', 'operator가 자기 역할을 admin으로 바꾸려 하면 거부 (SEC-07)');
select is(
  pg_temp.try_as('authenticated', $q$insert into public.profiles (id, display_name, role) values (gen_random_uuid(), '위조', 'admin')$q$, '11111111-1111-4111-8111-111111111111'),
  '42501', 'operator가 admin 역할의 프로필을 새로 만들려 하면 거부');
select is(
  pg_temp.try_as('authenticated', $q$update public.profiles set role = 'operator' where id = '22222222-2222-4222-8222-222222222222'$q$, '11111111-1111-4111-8111-111111111111'),
  '42501', 'operator가 다른 사용자(팀장)의 역할을 바꾸려 하면 거부');
select is(
  pg_temp.try_as('authenticated', $q$delete from public.profiles where id = '11111111-1111-4111-8111-111111111111'$q$, '11111111-1111-4111-8111-111111111111'),
  '42501', 'operator가 자기 프로필을 지우려 하면 거부');

-- 5~7. 팀장(admin)도 API로 직접 역할을 바꿀 수는 없다 (역할은 서버의 관리 절차로만 정한다)
select is(
  pg_temp.try_as('authenticated', $q$update public.profiles set role = 'operator' where id = '22222222-2222-4222-8222-222222222222'$q$, '22222222-2222-4222-8222-222222222222'),
  '42501', 'admin도 자기 역할을 직접 바꿀 수 없음');
select is(
  pg_temp.try_as('authenticated', $q$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$q$, '22222222-2222-4222-8222-222222222222'),
  '42501', 'admin이 다른 사용자를 admin으로 올리려 해도 직접은 거부 (관리 절차로만)');
select is(
  pg_temp.try_as('authenticated', $q$insert into public.profiles (id, display_name, role) values (gen_random_uuid(), '위조', 'admin')$q$, '22222222-2222-4222-8222-222222222222'),
  '42501', 'admin도 프로필을 직접 만들 수 없음');

-- 8~9. 비로그인(anon)은 읽지도 바꾸지도 못한다
select is(
  pg_temp.try_as('anon', $q$select 1 from public.profiles limit 1$q$),
  '42501', '비로그인 사용자는 프로필을 읽을 수 없음');
select is(
  pg_temp.try_as('anon', $q$update public.profiles set role = 'admin'$q$),
  '42501', '비로그인 사용자는 역할을 바꿀 수 없음');

-- 10. 읽기는 된다 (담당자 이름을 화면에 보여 주려면 필요하다)
select is(
  pg_temp.try_as('authenticated', $q$select 1 from public.profiles limit 1$q$, '11111111-1111-4111-8111-111111111111'),
  'OK', '로그인 사용자는 프로필을 읽을 수 있음');

-- 11~12. 위 시도가 모두 막혀서 역할이 그대로다
select is((select role from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'operator', '시도 후에도 operator의 역할은 operator 그대로');
select is((select role from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'admin', '시도 후에도 팀장의 역할은 admin 그대로');

-- 13~16. 승인된 길: 서버 관리용 키(service_role)로는 바꿀 수 있고, 그래도 DB 규칙은 지켜야 한다
select is(
  pg_temp.try_as('service_role', $q$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$q$),
  'OK', '서버 관리 절차(service_role)로는 역할을 바꿀 수 있음');
select is((select role from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'admin', '서버 관리 절차로 바꾼 역할이 실제로 반영됨');
select is(
  pg_temp.try_as('service_role', $q$update public.profiles set role = 'superuser' where id = '11111111-1111-4111-8111-111111111111'$q$),
  '23514', '서버 관리 절차로도 operator/admin 외의 역할은 거부');
select is(
  pg_temp.try_as('service_role', $q$update public.profiles set display_name = '   ' where id = '11111111-1111-4111-8111-111111111111'$q$),
  '23514', '서버 관리 절차로도 빈 이름은 거부');

-- 17. 존재하지 않는 로그인 계정에는 프로필을 만들 수 없다 (프로필은 항상 실제 계정과 연결)
select is(
  pg_temp.try_as('postgres', $q$insert into public.profiles (id, display_name, role) values (gen_random_uuid(), '유령', 'admin')$q$),
  '23503', '로그인 계정이 없는 프로필은 만들 수 없음');

select * from finish();
rollback;

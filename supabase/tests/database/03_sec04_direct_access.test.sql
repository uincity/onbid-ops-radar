-- pgTAP 테스트 03: 화면을 거치지 않고 DB에 직접 접근해도 RLS·권한이 막는다  (PLAN 작업 12, SEC-04)
-- Design Ref: DESIGN §9(보안 설계: 화면을 거치지 않고 DB 직접 호출 → RLS·직접 수정 차단), PRD 7-4, 7-5 SEC-04
--
-- 시험 방식: public의 **모든 테이블**을 자동으로 찾아서, 같은 시험을 테이블마다 한다.
--   → 앞으로 테이블이 늘어나도 이 파일을 고치지 않아도 새 테이블까지 자동으로 시험된다. (계획 개수도 자동 계산)
--   비로그인(anon):          읽기·추가 모두 거부
--   로그인 사용자(authenticated): 읽기만 가능, 추가·수정·삭제·비우기 거부
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

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

-- 시험할 테이블 목록: 각 테이블의 마지막 칸 이름도 함께 담는다 ("수정" 시험에 쓴다. 자동 번호 칸이 아닌 칸이어야 한다)
create temp table targets as
select c.relname as tbl,
       (select a.attname from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         order by a.attnum desc limit 1) as last_col
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p');

-- 테이블 1개마다 7개 시험, 시험용 테이블 목록이 비어 있지 않은지 확인 1개
select plan((select count(*)::int * 7 + 1 from targets));

select ok((select count(*) from targets) >= 9, '시험할 테이블이 9개 이상 있음 (테이블 목록을 못 찾는 실수 방지)');

-- 비로그인(anon)
select is(pg_temp.try_as('anon', format('select 1 from public.%I limit 1', tbl)), '42501',
          tbl || ': 비로그인은 읽을 수 없음')
  from targets order by tbl;
select is(pg_temp.try_as('anon', format('insert into public.%I default values', tbl)), '42501',
          tbl || ': 비로그인은 추가할 수 없음')
  from targets order by tbl;

-- 로그인 사용자(authenticated): 읽기는 되고, 쓰기는 모두 거부
select is(pg_temp.try_as('authenticated', format('select 1 from public.%I limit 1', tbl), '11111111-1111-4111-8111-111111111111'), 'OK',
          tbl || ': 로그인 사용자는 읽을 수 있음')
  from targets order by tbl;
select is(pg_temp.try_as('authenticated', format('insert into public.%I default values', tbl), '11111111-1111-4111-8111-111111111111'), '42501',
          tbl || ': 로그인 사용자는 직접 추가할 수 없음')
  from targets order by tbl;
select is(pg_temp.try_as('authenticated', format('update public.%I set %I = %I', tbl, last_col, last_col), '11111111-1111-4111-8111-111111111111'), '42501',
          tbl || ': 로그인 사용자는 직접 수정할 수 없음')
  from targets order by tbl;
select is(pg_temp.try_as('authenticated', format('delete from public.%I', tbl), '11111111-1111-4111-8111-111111111111'), '42501',
          tbl || ': 로그인 사용자는 직접 삭제할 수 없음')
  from targets order by tbl;
select is(pg_temp.try_as('authenticated', format('truncate table public.%I', tbl), '11111111-1111-4111-8111-111111111111'), '42501',
          tbl || ': 로그인 사용자는 비울 수 없음')
  from targets order by tbl;

select * from finish();
rollback;

-- pgTAP 테스트 00: 모든 public 테이블의 출입 규칙(RLS) 점검  (PLAN 작업 12, SEC-04)
-- Design Ref: DESIGN §6.4(RLS 요약), §9(보안 설계), §10(테스트 계획 — DB는 pgTAP), PRD 7-4(모든 노출 테이블에 RLS와 최소 권한)
--
-- 이 파일의 목적: "지금 있는 테이블"뿐 아니라 "앞으로 만들 테이블"에도 같은 안전 규칙이 지켜지는지 계속 지켜본다.
--   - 새 테이블을 RLS 없이 만들면 → 이 테스트가 실패한다.
--   - 새 테이블에 비로그인(anon)이나 로그인 사용자에게 쓰기 권한을 주면 → 이 테스트가 실패한다.
-- 테스트는 begin ... rollback 안에서 돌아서 DB에 아무것도 남기지 않는다. (pgTAP 확장도 이 안에서만 만든다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- 1. 모든 테이블에 RLS가 켜져 있다 (꺼진 테이블의 이름이 실패 메시지에 나온다)
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '',
  'public의 모든 테이블에 RLS(출입 규칙)가 켜져 있음'
);

-- 2. 설계한 9개 테이블이 모두 있다 (실수로 빠지거나 이름이 바뀌면 알려 준다)
select is(
  (select count(*)::int from pg_tables
    where schemaname = 'public'
      and tablename = any (array['profiles', 'settings', 'check_runs', 'run_logs', 'api_checks',
                                 'collected_items', 'anomalies', 'anomaly_events', 'reports'])),
  9,
  'DESIGN의 테이블 9개가 모두 있음'
);

-- 3. 비로그인(anon)은 어떤 테이블에도 아무 권한이 없다
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  '',
  '비로그인(anon)은 어떤 테이블에도 권한이 없음'
);

-- 4. 로그인 사용자(authenticated)는 어떤 테이블에도 쓰기(추가·수정·삭제·비우기) 권한이 없다
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  '',
  '로그인 사용자(authenticated)는 어떤 테이블에도 쓰기 권한이 없음 (읽기만 가능)'
);

-- 5. 로그인 사용자는 설계한 9개 테이블을 모두 읽을 수 있다
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname = any (array['profiles', 'settings', 'check_runs', 'run_logs', 'api_checks',
                                   'collected_items', 'anomalies', 'anomaly_events', 'reports'])
      and has_table_privilege('authenticated', c.oid, 'SELECT')),
  9,
  '로그인 사용자는 테이블 9개를 모두 읽을 수 있음'
);

-- 6. 정책은 "로그인 사용자 읽기(SELECT)" 뿐이다. 추가·수정·삭제 정책이 하나라도 있으면 알려 준다
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname || '(' || p.cmd || ')', ', ' order by p.tablename), '')
     from pg_policies p
    where p.schemaname = 'public' and p.cmd <> 'SELECT'),
  '',
  '쓰기 정책(INSERT/UPDATE/DELETE/ALL)이 하나도 없음 — 쓰기는 서버(관리용 키)와 DB 함수만'
);

-- 7. 모든 정책은 로그인 사용자(authenticated) 전용이다 (비로그인·전체 공개 정책 금지)
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename), '')
     from pg_policies p
    where p.schemaname = 'public' and p.roles <> array['authenticated']::name[]),
  '',
  '모든 정책이 로그인 사용자(authenticated) 전용임'
);

-- 8. 비로그인(anon)이 직접 실행할 수 있는 public 함수가 없다 (트리거 함수 제외 — 트리거 함수는 직접 부를 수 없다)
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '',
  '비로그인(anon)이 API로 직접 부를 수 있는 public 함수가 없음'
);

-- 9. 쓰기 정책이 없으니 서버 관리용 키(service_role)를 빼고는 아무도 RLS를 건너뛸 수 없다
--    (RLS를 건너뛰는 BYPASSRLS 권한은 service_role과 관리자(postgres) 계열 외에는 없어야 한다)
select is(
  (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), '')
     from pg_roles r
    where r.rolbypassrls and r.rolname in ('anon', 'authenticated')),
  '',
  '비로그인·로그인 사용자 역할은 RLS를 건너뛸 수 없음'
);

select * from finish();
rollback;

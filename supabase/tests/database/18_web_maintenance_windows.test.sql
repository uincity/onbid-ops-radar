-- pgTAP 테스트 18: 홈페이지 계획 점검 창 (W15)
-- Design Ref: docs/design-homepage-monitoring.md §5.3(처리표)·§5.6(등록·취소)·§6.1·§6.3. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- 시험 대상 키는 pgtap-win(실제 대상 onbid-home과 겹치지 않는다).

begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

-- 연결된 DB에 실행 중인 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 정리해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';

-- ---------------------------------------------------------------- 시험 도구
create function pg_temp.uid_of(p_who text) returns uuid language sql as $$
  select case p_who
    when 'OP'  then '11111111-1111-4111-8111-111111111111'::uuid
    when 'ADM' then '22222222-2222-4222-8222-222222222222'::uuid
    when 'X'   then '44444444-4444-4444-8444-444444444444'::uuid
  end
$$;

-- 지정한 역할·사용자로 SQL을 실행. 성공하면 'OK:결과', 우리 함수의 오류(P0001)면 오류 문구, 그 밖은 SQLSTATE
create function pg_temp.r(p_who text, p_sql text) returns text language plpgsql as $$
declare
  v_role text := case when p_who = 'ANON' then 'anon' when p_who = 'SERVICE' then 'service_role' else 'authenticated' end;
  v_out  text;
  v_claims text := case when pg_temp.uid_of(p_who) is null then '{}' else json_build_object('sub', pg_temp.uid_of(p_who), 'role', 'authenticated')::text end;
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

create function pg_temp.mk(p_who text, p_start timestamptz, p_end timestamptz, p_reason text default '정기 점검', p_target text default 'pgtap-win') returns text language sql as $$
  select pg_temp.r(p_who, format('select public.create_maintenance_window(%L, %L::timestamptz, %L::timestamptz, %L)', p_target, p_start, p_end, p_reason))
$$;

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-win-op@example.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-win-admin@example.invalid', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'pgtap-win-noprofile@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '담당자', 'operator'),
  ('22222222-2222-4222-8222-222222222222', '팀장', 'admin');

-- ---------------------------------------------------------------- 권한·구조
select ok(not has_function_privilege('anon', 'public.create_maintenance_window(text, timestamptz, timestamptz, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.create_maintenance_window(text, timestamptz, timestamptz, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.create_maintenance_window(text, timestamptz, timestamptz, text)', 'EXECUTE'), 'create_maintenance_window: 비로그인은 실행 불가, 로그인 사용자(함수 안에서 팀장 확인)는 가능');
select ok(not has_function_privilege('anon', 'public.cancel_maintenance_window(bigint)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.cancel_maintenance_window(bigint)', 'EXECUTE'), 'cancel_maintenance_window: 비로그인은 실행 불가, 로그인 사용자는 가능');
select ok(not has_function_privilege('anon', 'public.web_in_maintenance(text, timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.web_in_maintenance(text, timestamptz)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.web_in_maintenance(text, timestamptz)', 'EXECUTE'), 'web_in_maintenance: 서버 관리용 키만 실행');
select ok(not has_function_privilege('anon', 'public.mark_web_run_planned(bigint)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.mark_web_run_planned(bigint)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.mark_web_run_planned(bigint)', 'EXECUTE'), 'mark_web_run_planned: 서버 관리용 키만 실행');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in ('public.create_maintenance_window(text, timestamptz, timestamptz, text)'::regprocedure, 'public.cancel_maintenance_window(bigint)'::regprocedure,
                    'public.web_in_maintenance(text, timestamptz)'::regprocedure, 'public.mark_web_run_planned(bigint)'::regprocedure)),
  '네 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음'
);
select ok((select relrowsecurity from pg_class where oid = 'public.web_maintenance_windows'::regclass), 'web_maintenance_windows: RLS 켜짐');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'web_maintenance_windows' and cmd <> 'SELECT'), 0, '쓰기 정책 없음 (읽기 정책만)');
select ok(not has_table_privilege('authenticated', 'public.web_maintenance_windows', 'INSERT')
      and not has_table_privilege('authenticated', 'public.web_maintenance_windows', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.web_maintenance_windows', 'DELETE')
      and has_table_privilege('authenticated', 'public.web_maintenance_windows', 'SELECT')
      and not has_table_privilege('anon', 'public.web_maintenance_windows', 'SELECT'), '로그인 사용자는 읽기만, 비로그인은 읽기도 불가');

-- ---------------------------------------------------------------- 등록: 권한
select is(pg_temp.mk('ADM', now() + interval '1 day', now() + interval '2 day') ~ '^OK:\d+$', true, '팀장은 등록할 수 있다');
select is(pg_temp.mk('OP', now() + interval '10 day', now() + interval '11 day'), 'FORBIDDEN', '운영 담당자는 거부');
select is(pg_temp.mk('X', now() + interval '10 day', now() + interval '11 day'), 'FORBIDDEN', '프로필 없는 로그인 계정은 거부');
select is(pg_temp.mk('NONE', now() + interval '10 day', now() + interval '11 day'), 'FORBIDDEN', '로그인 정보 없음은 거부');
select ok(pg_temp.mk('ANON', now() + interval '10 day', now() + interval '11 day') in ('42501', 'FORBIDDEN'), '비로그인은 거부');
select is((select count(*)::int from public.web_maintenance_windows where target_key = 'pgtap-win'), 1, '거부된 요청은 줄을 만들지 않는다');

-- ---------------------------------------------------------------- 등록: 입력 검사
select is(pg_temp.mk('ADM', now() + interval '3 day', now() + interval '3 day'), 'WINDOW_INVALID', '종료 = 시작 거부');
select is(pg_temp.mk('ADM', now() + interval '4 day', now() + interval '3 day'), 'WINDOW_INVALID', '종료 < 시작 거부');
select is(pg_temp.mk('ADM', now() - interval '3 day', now() - interval '2 day'), 'WINDOW_INVALID', '이미 끝난 시간 거부');
select is(pg_temp.mk('ADM', now() + interval '3 day', now() + interval '4 day', ''), 'WINDOW_INVALID', '빈 사유 거부');
select is(pg_temp.mk('ADM', now() + interval '3 day', now() + interval '4 day', '   '), 'WINDOW_INVALID', '공백뿐인 사유 거부');
select is(pg_temp.mk('ADM', now() + interval '3 day', now() + interval '4 day', repeat('가', 201)), 'WINDOW_INVALID', '201자 사유 거부');
select is(pg_temp.mk('ADM', now() + interval '3 day', now() + interval '4 day', repeat('가', 200)) ~ '^OK:\d+$', true, '200자 사유는 허용');
select is(pg_temp.r('ADM', 'select public.create_maintenance_window(null, now() + interval ''20 day'', now() + interval ''21 day'', ''x'')'), 'WINDOW_INVALID', '대상 없음(전체 대상 창) 거부');
select is(pg_temp.mk('ADM', now() + interval '20 day', now() + interval '21 day', '정기 점검', 'Bad Target!'), 'WINDOW_INVALID', '대상 키 모양이 틀리면 거부');
-- 최대 길이: 기본 168시간
select is(pg_temp.mk('ADM', now() + interval '30 day', now() + interval '30 day' + interval '168 hours') ~ '^OK:\d+$', true, '168시간 정확히는 허용');
select is(pg_temp.mk('ADM', now() + interval '40 day', now() + interval '40 day' + interval '168 hours 1 second'), 'WINDOW_INVALID', '168시간 + 1초는 거부');
-- 설정을 바꾸면 따라간다 (24시간으로)
update public.web_settings set value = '24'::jsonb where key = 'web_window_max_hours';
select is(pg_temp.mk('ADM', now() + interval '50 day', now() + interval '50 day' + interval '25 hours'), 'WINDOW_INVALID', '설정(24시간)을 넘으면 거부');
select is(pg_temp.mk('ADM', now() + interval '50 day', now() + interval '50 day' + interval '24 hours') ~ '^OK:\d+$', true, '설정(24시간) 정확히는 허용');
update public.web_settings set value = '168'::jsonb where key = 'web_window_max_hours';

-- ---------------------------------------------------------------- 겹침: [시작, 종료) 이어 붙이기는 허용
create temp table base as select pg_temp.mk('ADM', now() + interval '60 day', now() + interval '61 day', '기준 창', 'pgtap-ov') as r;
select is(pg_temp.mk('ADM', now() + interval '60 day 12 hours', now() + interval '62 day', '겹침', 'pgtap-ov'), 'WINDOW_OVERLAP', '같은 대상의 겹치는 창은 거부 (일부 겹침)');
select is(pg_temp.mk('ADM', now() + interval '60 day 1 hour', now() + interval '60 day 2 hours', '포함', 'pgtap-ov'), 'WINDOW_OVERLAP', '기존 창 안에 완전히 들어가도 거부');
select is(pg_temp.mk('ADM', now() + interval '59 day', now() + interval '62 day', '감쌈', 'pgtap-ov'), 'WINDOW_OVERLAP', '기존 창을 감싸도 거부');
select is(pg_temp.mk('ADM', now() + interval '61 day', now() + interval '62 day', '이어 붙임', 'pgtap-ov') ~ '^OK:\d+$', true, '종료 = 다음 시작(이어 붙이기)은 허용');
select is(pg_temp.mk('ADM', now() + interval '59 day', now() + interval '60 day', '앞에 이어 붙임', 'pgtap-ov') ~ '^OK:\d+$', true, '앞쪽에 이어 붙이기도 허용');
select is(pg_temp.mk('ADM', now() + interval '60 day 12 hours', now() + interval '60 day 13 hours', '다른 대상', 'pgtap-ov2') ~ '^OK:\d+$', true, '다른 대상은 같은 시간이어도 허용');

-- ---------------------------------------------------------------- 점검 안 판정: 경계 [시작, 종료)
-- 이어 붙인 창이 없는 대상(pgtap-edge)에서 경계를 본다
create temp table edge_mk as select pg_temp.mk('ADM', now() + interval '70 day', now() + interval '71 day', '경계 시험', 'pgtap-edge') as r;
create temp table w as select starts_at, ends_at from public.web_maintenance_windows where target_key = 'pgtap-edge';
select is(public.web_in_maintenance('pgtap-edge', (select starts_at from w)), true, '시작 시각 정확히는 창 안 (포함)');
select is(public.web_in_maintenance('pgtap-edge', (select starts_at from w) - interval '1 microsecond'), false, '시작 직전은 창 밖');
select is(public.web_in_maintenance('pgtap-edge', (select ends_at from w) - interval '1 microsecond'), true, '종료 직전은 창 안');
select is(public.web_in_maintenance('pgtap-edge', (select ends_at from w)), false, '종료 시각 정확히는 창 밖 (제외)');
select is(public.web_in_maintenance('pgtap-ov', now() + interval '61 day'), true, '이어 붙인 두 창의 경계 시각은 다음 창의 시작이므로 창 안');
select is(public.web_in_maintenance('pgtap-none', now() + interval '60 day'), false, '창이 없는 대상은 항상 창 밖');
select is(public.web_in_maintenance('pgtap-ov2', now() + interval '60 day 12 hours 30 minutes'), true, '다른 대상 창은 그 대상에서만 창 안');

-- ---------------------------------------------------------------- 취소 1: 시작 전 창 → 취소 표시만, 판정에서 빠지고 줄은 남음
create temp table c1 as select id, starts_at from public.web_maintenance_windows where target_key = 'pgtap-win' order by id limit 1;
select is(public.web_in_maintenance('pgtap-win', (select starts_at from c1) + interval '1 hour'), true, '취소 전에는 창 안');
select is(pg_temp.r('ADM', format('select public.cancel_maintenance_window(%s)', (select id from c1))), 'OK:' || (select id from c1), '팀장이 시작 전 창을 취소');
select is((select ends_at - starts_at from public.web_maintenance_windows where id = (select id from c1)), interval '1 day', '시작 전 취소는 종료 시각을 바꾸지 않는다');
select ok((select cancelled_at is not null and cancelled_by = '22222222-2222-4222-8222-222222222222' from public.web_maintenance_windows where id = (select id from c1)), '취소 시각·취소한 팀장이 남는다');
select is(public.web_in_maintenance('pgtap-win', (select starts_at from c1) + interval '1 hour'), false, '취소된 시작 전 창은 판정에서 빠진다');
-- 취소된 창과 겹쳐도 새로 등록할 수 있다
select is(pg_temp.mk('ADM', (select starts_at from c1), (select starts_at from c1) + interval '2 hours', '다시 등록') ~ '^OK:\d+$', true, '취소된 창과 겹치는 시간은 다시 등록할 수 있다');

-- ---------------------------------------------------------------- 취소 2: 진행 중 창 → 종료 시각을 지금으로 당김
-- (등록 함수는 지난 시작을 허용하므로 진행 중인 창을 직접 만든다)
create temp table c2 as
  with ins as (
    insert into public.web_maintenance_windows (target_key, starts_at, ends_at, reason, created_by)
    values ('pgtap-run', now() - interval '1 hour', now() + interval '1 hour', '진행 중', '22222222-2222-4222-8222-222222222222') returning id)
  select id from ins;
select is(public.web_in_maintenance('pgtap-run', now()), true, '진행 중 창은 지금 창 안');
select is(pg_temp.r('OP', format('select public.cancel_maintenance_window(%s)', (select id from c2))), 'FORBIDDEN', '운영 담당자는 취소할 수 없다');
select is(pg_temp.r('ADM', format('select public.cancel_maintenance_window(%s)', (select id from c2))), 'OK:' || (select id from c2), '팀장이 진행 중 창을 취소');
select ok((select ends_at <= now() and ends_at > now() - interval '1 minute' and cancelled_at = ends_at from public.web_maintenance_windows where id = (select id from c2)), '진행 중 취소는 종료 시각을 지금으로 당긴다');
select is(public.web_in_maintenance('pgtap-run', now() + interval '1 second'), false, '취소 뒤에는 창 밖');
select is(public.web_in_maintenance('pgtap-run', now() - interval '30 minutes'), true, '취소 전에 이미 지난 시간은 창 안으로 남는다 (당겨진 종료 시각 전까지)');

-- ---------------------------------------------------------------- 취소 3: 끝난 창·이미 취소된 창·없는 창은 거부
create temp table c3 as
  with ins as (
    insert into public.web_maintenance_windows (target_key, starts_at, ends_at, reason, created_by)
    values ('pgtap-old', now() - interval '3 hours', now() - interval '1 hour', '끝난 창', '22222222-2222-4222-8222-222222222222') returning id)
  select id from ins;
select is(pg_temp.r('ADM', format('select public.cancel_maintenance_window(%s)', (select id from c3))), 'WINDOW_INVALID', '끝난 창은 취소할 수 없다');
select is(pg_temp.r('ADM', format('select public.cancel_maintenance_window(%s)', (select id from c2))), 'WINDOW_INVALID', '이미 취소된 창을 다시 취소할 수 없다');
select is(pg_temp.r('ADM', 'select public.cancel_maintenance_window(999999999)'), 'WINDOW_NOT_FOUND', '없는 창은 WINDOW_NOT_FOUND');

-- ---------------------------------------------------------------- 계획 점검 표시
create temp table runs as select
  (select out_run_id from public.start_web_check_run('pgtap-win', 'scheduled', null, null, '2026-11-05 05:00:00+00')) as a_id;
select is((select planned_maintenance from public.web_check_runs where id = (select a_id from runs)), false, '시작 때는 계획 점검 표시가 없다');
select is(public.mark_web_run_planned((select a_id from runs)), false, '진행 중 실행에는 표시하지 않는다');
create temp table fin as select public.finish_web_check_run((select a_id from runs), 'succeeded', 'PASS_DATA', 5, false) as r;
select is(public.mark_web_run_planned((select a_id from runs)), true, '정상 종료된 정시 실행에 표시한다');
select is((select planned_maintenance from public.web_check_runs where id = (select a_id from runs)), true, 'planned_maintenance가 true로 바뀐다');

select * from finish();
rollback;

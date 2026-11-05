-- pgTAP 테스트 14: 웹 점검 기록 테이블과 start_web_check_run / finish_web_check_run (W04)
-- Design Ref: docs/design-homepage-monitoring.md §6.1·§6.3. 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (RLS·읽기 전용 권한 일반 점검은 00_rls_guard·03_sec04가 모든 테이블에 자동으로 한다)

begin;
create extension if not exists pgtap with schema extensions;

select plan(53);

-- 연결된 DB에 실행 중인 웹 점검이 있어도 시험이 흔들리지 않게, 이 트랜잭션 안에서만 모두 마감해 둔다 (끝에 되돌려진다)
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';

-- ---------------------------------------------------------------- 권한
select ok(not has_function_privilege('anon', 'public.start_web_check_run(text, text, uuid, bigint, timestamptz)', 'EXECUTE'), 'start: 비로그인은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.start_web_check_run(text, text, uuid, bigint, timestamptz)', 'EXECUTE'), 'start: 로그인 사용자도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.start_web_check_run(text, text, uuid, bigint, timestamptz)', 'EXECUTE'), 'start: 서버 관리용 키는 실행할 수 있음');
select ok(not has_function_privilege('anon', 'public.finish_web_check_run(bigint, text, text, integer, boolean)', 'EXECUTE'), 'finish: 비로그인은 실행할 수 없음');
select ok(not has_function_privilege('authenticated', 'public.finish_web_check_run(bigint, text, text, integer, boolean)', 'EXECUTE'), 'finish: 로그인 사용자도 실행할 수 없음');
select ok(has_function_privilege('service_role', 'public.finish_web_check_run(bigint, text, text, integer, boolean)', 'EXECUTE'), 'finish: 서버 관리용 키는 실행할 수 있음');
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p
    where p.oid in ('public.start_web_check_run(text, text, uuid, bigint, timestamptz)'::regprocedure, 'public.finish_web_check_run(bigint, text, text, integer, boolean)'::regprocedure)),
  '두 함수 모두 소유자 권한으로 실행되고 search_path가 비어 있음'
);

-- ---------------------------------------------------------------- 정상 시작
create temp table r1 as select * from public.start_web_check_run('onbid-home', 'manual', null);
select is((select out_status from r1), 'running', '실행 중인 점검이 없으면 running으로 시작');
select is((select finished_at from public.web_check_runs where id = (select out_run_id from r1)), null, 'running 줄은 종료 시각이 비어 있음');

-- ---------------------------------------------------------------- 동시 실행 차단과 대체 실행 예약
create temp table r2 as select * from public.start_web_check_run('onbid-home', 'manual', null);
select is((select out_status from r2), 'blocked', '이미 실행 중이면 blocked');
select is((select count(*)::int from public.web_retry_queue where target_key = 'onbid-home'), 0, '수동 점검이 막혀도 대체 실행은 예약하지 않음');
select is((select count(*)::int from public.web_check_runs where status = 'running'), 1, 'running은 전체에서 1개뿐');

create temp table r3 as select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, '2026-11-05 05:07:00+00');
select is((select out_status from r3), 'blocked', '정시 점검도 실행 중이면 blocked');
select is(
  (select kind || '/' || status || '/' || (origin_run_id = (select out_run_id from r3))::text from public.web_retry_queue where target_key = 'onbid-home'),
  'replace/pending/true',
  '정시 점검이 막히면 대체 실행(replace)이 pending으로 예약되고 원래 실행은 막힌 줄'
);
select ok((select due_at from public.web_retry_queue where target_key = 'onbid-home') between now() + interval '59 seconds' and now() + interval '61 seconds', '대체 실행은 약 1분 뒤로 예약');

create temp table r4 as select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, '2026-11-05 06:07:00+00');
select is((select out_status from r4), 'blocked', '다른 정시 칸도 실행 중이면 blocked');
select is((select count(*)::int from public.web_retry_queue where target_key = 'onbid-home' and status in ('pending', 'claimed')), 1, '대상별 대기 줄은 1개 (추가 예약은 만들지 않음)');

-- ---------------------------------------------------------------- 멈춘 실행 정리 경계 (기준 180초)
update public.web_check_runs set started_at = now() - interval '179 seconds' where id = (select out_run_id from r1);
select is((select out_status from public.start_web_check_run('onbid-home', 'manual', null)), 'blocked', '179초 지난 running은 정리하지 않음 (새 시작은 차단)');
update public.web_check_runs set started_at = now() - interval '181 seconds' where id = (select out_run_id from r1);
create temp table r5 as select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, '2026-11-05 07:07:00+00');
select is((select out_status from r5), 'running', '181초 지난 running을 정리한 뒤 새 실행이 시작됨');
select is((select status from public.web_check_runs where id = (select out_run_id from r1)), 'failed', '멈춘 실행은 failed로 마감됨');
select ok((select finished_at is not null from public.web_check_runs where id = (select out_run_id from r1)), '멈춘 실행에도 종료 시각이 채워짐');

-- ---------------------------------------------------------------- 정시 칸 중복 방지
select is((select public.finish_web_check_run((select out_run_id from r5), 'succeeded', 'PASS_DATA', 3)), true, '정시 실행을 정상 종료');
create temp table r6 as select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, '2026-11-05 07:07:00+00');
select is((select out_status from r6), 'blocked', '같은 정시 칸의 두 번째 정시 점검은 blocked (정시 중복 호출 방지)');
select is((select count(*)::int from public.web_retry_queue where target_key = 'onbid-home' and origin_run_id = (select out_run_id from r6)), 0, '칸 중복으로 막힌 경우에는 대체 실행을 예약하지 않음');
select throws_ok(
  $$insert into public.web_check_runs (target_key, "trigger", slot_at, status, finished_at, overall_verdict)
    values ('onbid-home', 'scheduled', '2026-11-05 07:07:00+00', 'succeeded', now(), 'PASS_DATA')$$,
  '23505', null, '같은 대상·같은 칸의 차단되지 않은 정시 실행을 직접 또 넣을 수 없음'
);
-- 차단된 줄은 칸을 차지하지 않으므로 같은 칸에 대체 실행이 들어갈 수 있다
create temp table r7 as select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, '2026-11-05 06:07:00+00');
select is((select out_status from r7), 'running', '차단된 줄만 있는 칸에는 대체 실행이 시작될 수 있음');

-- ---------------------------------------------------------------- 종료 기록
select is((select public.finish_web_check_run((select out_run_id from r7), 'partial', 'FAIL', 2, true)), true, '정상 종료 처리');
select is(
  (select status || '/' || overall_verdict || '/' || request_count::text || '/' || planned_maintenance::text || '/' || (finished_at is not null)::text from public.web_check_runs where id = (select out_run_id from r7)),
  'partial/FAIL/2/true/true',
  '종료 상태·대표 판정·요청 수·계획 점검 표시·종료 시각이 기록됨'
);
select is((select public.finish_web_check_run((select out_run_id from r7), 'succeeded', 'PASS_DATA', 9)), false, '이미 끝난 줄은 다시 마감하지 않고 false');
select is((select status from public.web_check_runs where id = (select out_run_id from r7)), 'partial', '이미 끝난 줄은 바뀌지 않음');
select is((select public.finish_web_check_run((select out_run_id from r2), 'failed', null)), false, '차단된 줄은 마감하지 않음 (false)');
select throws_ok($$select public.finish_web_check_run(1, 'running')$$, '22023', null, '종료 상태가 running이면 거부');
select throws_ok($$select public.finish_web_check_run(1, 'blocked')$$, '22023', null, '종료 상태가 blocked이면 거부');

-- ---------------------------------------------------------------- 잘못된 입력은 거부
select throws_ok($$select * from public.start_web_check_run('onbid-home', 'scheduled', gen_random_uuid(), null, now())$$, '23514', null, '예약 점검에 담당자를 붙이면 거부');
select throws_ok($$select * from public.start_web_check_run('onbid-home', 'scheduled', null, null, null)$$, '23514', null, '정시 점검에 칸 시각이 없으면 거부');
select throws_ok($$select * from public.start_web_check_run('onbid-home', 'manual', null, null, now())$$, '23514', null, '수동 점검에 칸 시각을 붙이면 거부');
select throws_ok($$select * from public.start_web_check_run('onbid-home', 'manual', null, 1, null)$$, '23514', null, '재확인이 아닌데 원래 실행을 붙이면 거부');
select throws_ok($$select * from public.start_web_check_run('Bad Key', 'manual')$$, '23514', null, '대상 키 형식이 틀리면 거부');
select throws_ok($$select * from public.start_web_check_run('onbid-home', 'hourly')$$, '23514', null, '모르는 점검 종류는 거부');

-- ---------------------------------------------------------------- 층별 판정 줄
update public.web_check_runs set status = 'failed', finished_at = now() where status = 'running';
create temp table pr as select * from public.start_web_check_run('onbid-home', 'manual', null);
select lives_ok(
  format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason, http_status, duration_ms, final_url)
    values (%s, 'onbid-home', 'L2_HTTP', true, 'DEGRADED', 'SLOW_RESPONSE', 200, 3500, 'https://www.onbid.co.kr/a/main.do')$f$, (select out_run_id from pr)),
  '정상적인 판정 줄은 저장됨'
);
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict) values (%s, 'other-site', 'L3_CONTENT', true, 'PASS_DATA')$f$, (select out_run_id from pr)), '23503', null, '점검 실행과 다른 대상 키는 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason) values (%s, 'onbid-home', 'L1_CONNECT', true, 'PASS_DATA', 'TIMEOUT')$f$, (select out_run_id from pr)), '23514', null, '정상 판정에 사유가 있으면 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict) values (%s, 'onbid-home', 'L1_CONNECT', true, 'FAIL')$f$, (select out_run_id from pr)), '23514', null, '실패 판정에 사유가 없으면 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason) values (%s, 'onbid-home', 'L1_CONNECT', true, 'FAIL', 'MYSTERY')$f$, (select out_run_id from pr)), '23514', null, '닫힌 목록에 없는 사유는 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason) values (%s, 'onbid-home', 'L3_CONTENT', true, 'NOT_RUN', 'TIMEOUT')$f$, (select out_run_id from pr)), '23514', null, '미점검의 사유는 건너뜀·예산 소진만 허용');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason) values (%s, 'onbid-home', 'AUX_STUB', true, 'FAIL', 'STUB_CHANGED')$f$, (select out_run_id from pr)), '23514', null, '보조 확인을 대표 판정에 포함시키면 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, final_url) values (%s, 'onbid-home', 'L3_CONTENT', true, 'PASS_DATA', 'https://www.onbid.co.kr/a?serviceKey=SECRET')$f$, (select out_run_id from pr)), '23514', null, '주소에 질의(?)가 있으면 거부');
select throws_ok(format($f$insert into public.web_probe_results (run_id, target_key, layer, counts_toward_overall, verdict, reason) values (%s, 'onbid-home', 'L2_HTTP', true, 'FAIL', 'TIMEOUT')$f$, (select out_run_id from pr)), '23505', null, '같은 점검의 같은 층 판정은 한 줄만');

-- ---------------------------------------------------------------- 재확인 대기열 상태 짝
delete from public.web_retry_queue where target_key = 'onbid-home';
select lives_ok($$insert into public.web_retry_queue (target_key, kind, due_at) values ('onbid-home', 'confirm', now())$$, '재확인 줄을 pending으로 추가');
select throws_ok($$insert into public.web_retry_queue (target_key, kind, due_at) values ('onbid-home', 'replace', now())$$, '23505', null, '대상별 대기/처리 중 줄은 1개뿐');
select throws_ok($$update public.web_retry_queue set status = 'claimed' where target_key = 'onbid-home'$$, '23514', null, '처리 중인데 선점 시각이 없으면 거부');

-- ---------------------------------------------------------------- 대상 상태 구조
select lives_ok($$insert into public.web_target_state (target_key, current_verdict, since) values ('pgtap-state', 'PASS_DATA', now())$$, '대상 상태 줄 추가');
select throws_ok($$update public.web_target_state set incident_open = true where target_key = 'pgtap-state'$$, '23514', null, '열린 사건에 사건 번호(1 이상)가 없으면 거부');

select * from finish();
rollback;

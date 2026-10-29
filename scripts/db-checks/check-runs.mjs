// check_runs · api_checks · run_logs 테이블이 DESIGN대로 만들어졌는지 확인한다 (PLAN 작업 7)
export const title = "점검 실행 이력 (check_runs · api_checks · run_logs)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable, rollbackProbe, expectEmpty } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable(
    "check_runs",
    ["id", "trigger", "source", "status", "started_at", "finished_at", "api_call_count", "triggered_by"],
    { trigger: "manual", source: "DEMO" },
  );
  await checkReadOnlyTable(
    "api_checks",
    ["id", "run_id", "endpoint_name", "http_status", "duration_ms", "outcome", "record_count", "data_valid", "checked_at"],
    { run_id: 1, endpoint_name: "demo-list", duration_ms: 1, outcome: "success" },
  );
  await checkReadOnlyTable(
    "run_logs",
    ["id", "run_id", "log_date", "level", "code", "message", "logged_at"],
    { code: "TIMEOUT", message: "시험" },
  );

  // 연결과 제약이 있는지
  const indexes = await query(
    `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('check_runs', 'run_logs')`,
  );
  const indexDef = (name) => indexes.find((i) => i.indexname === name)?.indexdef ?? "";
  report(/UNIQUE/.test(indexDef("check_runs_only_one_running")) && /running/.test(indexDef("check_runs_only_one_running")), "check_runs: 실행 중(running)은 동시에 하나만 허용하는 제약 있음");
  report(/UNIQUE/.test(indexDef("run_logs_schedule_missed_per_day")) && /SCHEDULE_MISSED/.test(indexDef("run_logs_schedule_missed_per_day")), "run_logs: 예약 누락 기록은 날짜당 1건만 허용하는 제약 있음");

  const fks = await query(
    `select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint
     where contype = 'f' and conrelid in ('public.api_checks'::regclass, 'public.run_logs'::regclass, 'public.check_runs'::regclass)`,
  );
  const hasFk = (tbl, target) => fks.some((f) => f.tbl === tbl && f.def.includes(`REFERENCES ${target}`));
  report(hasFk("api_checks", "check_runs(id)"), "api_checks.run_id → check_runs 연결됨");
  report(hasFk("run_logs", "check_runs(id)"), "run_logs.run_id → check_runs 연결됨 (비울 수 있음)");
  report(hasFk("check_runs", "profiles(id)"), "check_runs.triggered_by → profiles 연결됨");

  // 동작 확인: 트랜잭션 안에서 넣어 보고 마지막에 전부 되돌린다 (저장되는 줄 없음)
  // 값은 'OK'(들어감) 또는 오류 코드(23514 규칙 위반, 23505 중복, 23503 연결 없음)로 돌아온다.
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const probe = await rollbackProbe(`
    run1 bigint;
    begin
      insert into public.check_runs ("trigger", source) values ('manual', 'DEMO') returning id into run1;
      ${t("second_running", `insert into public.check_runs ("trigger", source) values ('scheduled', 'DEMO')`)}
      ${t("blocked_while_running", `insert into public.check_runs ("trigger", source, status, finished_at) values ('manual', 'DEMO', 'blocked', now())`)}
      ${t("running_with_finish", `insert into public.check_runs ("trigger", source, status, finished_at) values ('manual', 'DEMO', 'running', now())`)}
      ${t("finished_without_time", `insert into public.check_runs ("trigger", source, status) values ('manual', 'DEMO', 'succeeded')`)}
      ${t("time_reversed", `insert into public.check_runs ("trigger", source, status, started_at, finished_at) values ('manual', 'DEMO', 'failed', now(), now() - interval '1 minute')`)}
      ${t("bad_trigger", `insert into public.check_runs ("trigger", source, status, finished_at) values ('auto', 'DEMO', 'failed', now())`)}
      ${t("bad_source", `insert into public.check_runs ("trigger", source, status, finished_at) values ('manual', 'TEST', 'failed', now())`)}
      ${t("scheduled_with_user", `insert into public.check_runs ("trigger", source, status, finished_at, triggered_by) values ('scheduled', 'DEMO', 'failed', now(), gen_random_uuid())`)}
      ${t("api_ok", `insert into public.api_checks (run_id, endpoint_name, http_status, duration_ms, outcome, record_count, data_valid) values (run1, 'demo-list', 200, 120, 'success', 5, true)`)}
      ${t("api_timeout_no_status", `insert into public.api_checks (run_id, endpoint_name, http_status, duration_ms, outcome) values (run1, 'demo-detail', null, 10000, 'timeout')`)}
      ${t("api_bad_outcome", `insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome) values (run1, 'demo-list', 1, 'maybe')`)}
      ${t("api_url_as_name", `insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome) values (run1, 'https://x.example/a?serviceKey=abc', 1, 'success')`)}
      ${t("api_negative_time", `insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome) values (run1, 'demo-list', -1, 'success')`)}
      ${t("api_bad_http_status", `insert into public.api_checks (run_id, endpoint_name, http_status, duration_ms, outcome) values (run1, 'demo-list', 99, 1, 'success')`)}
      ${t("api_missing_run", `insert into public.api_checks (run_id, endpoint_name, duration_ms, outcome) values (-1, 'demo-list', 1, 'success')`)}
      ${t("log_ok", `insert into public.run_logs (run_id, code, message) values (run1, 'LIMIT_REACHED', '호출 상한 20회에 도달')`)}
      ${t("log_with_key", `insert into public.run_logs (run_id, code, message) values (run1, 'TIMEOUT', 'GET https://x.example/a?serviceKey=abc123')`)}
      ${t("log_masked_key", `insert into public.run_logs (run_id, code, message) values (run1, 'TIMEOUT', 'GET https://x.example/a?serviceKey=****')`)}
      ${t("log_bad_code", `insert into public.run_logs (run_id, code, message) values (run1, 'limit-reached', '메모')`)}
      ${t("missed_first", `insert into public.run_logs (code, message) values ('SCHEDULE_MISSED', '예약 점검 누락')`)}
      ${t("missed_second_same_day", `insert into public.run_logs (code, message) values ('SCHEDULE_MISSED', '예약 점검 누락 (중복)')`)}
      r := r || jsonb_build_object('log_date_is_kst', exists (
        select 1 from public.run_logs where code = 'SCHEDULE_MISSED' and log_date = (now() at time zone 'Asia/Seoul')::date));
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);
  expect("second_running", "23505", "check_runs: 실행 중인 점검이 있으면 두 번째 running은 거부");
  expect("blocked_while_running", "OK", "check_runs: 실행 중이어도 '차단(blocked)' 기록은 남길 수 있음");
  expect("running_with_finish", "23514", "check_runs: 실행 중인데 종료 시각이 있으면 거부");
  expect("finished_without_time", "23514", "check_runs: 끝났는데 종료 시각이 없으면 거부");
  expect("time_reversed", "23514", "check_runs: 종료 시각이 시작 시각보다 빠르면 거부");
  expect("bad_trigger", "23514", "check_runs: 시작 방식은 scheduled/manual만 허용");
  expect("bad_source", "23514", "check_runs: 출처는 DEMO/PUBLIC만 허용");
  expect("scheduled_with_user", "23514", "check_runs: 예약 점검에는 담당 사용자를 적을 수 없음");
  expect("api_ok", "OK", "api_checks: 정상 기록은 저장됨");
  expect("api_timeout_no_status", "OK", "api_checks: 타임아웃은 HTTP 상태 없이도 기록됨");
  expect("api_bad_outcome", "23514", "api_checks: 정해진 결과 구분 외의 값은 거부");
  expect("api_url_as_name", "23514", "api_checks: API 이름에 주소·인증키 형태는 거부 (SEC-10)");
  expect("api_negative_time", "23514", "api_checks: 음수 응답시간은 거부");
  expect("api_bad_http_status", "23514", "api_checks: 100~599 밖의 HTTP 상태는 거부");
  expect("api_missing_run", "23503", "api_checks: 없는 점검 실행에는 기록할 수 없음");
  expect("log_ok", "OK", "run_logs: 정상 메모는 저장됨");
  expect("log_with_key", "23514", "run_logs: 메모에 인증키(serviceKey=값)가 있으면 거부 (SEC-10)");
  expect("log_masked_key", "OK", "run_logs: 인증키를 ****로 가린 메모는 저장됨");
  expect("log_bad_code", "23514", "run_logs: 메모 종류는 대문자·숫자·밑줄만 허용");
  expect("missed_first", "OK", "run_logs: 예약 누락 기록 1건은 저장됨 (점검 실행 없이도)");
  expect("missed_second_same_day", "23505", "run_logs: 같은 날 예약 누락 기록 두 번째는 거부");
  report(probe.log_date_is_kst === true, "run_logs: log_date 기본값이 한국 시간(KST) 날짜", `결과 ${probe.log_date_is_kst}`);

  await expectEmpty(["check_runs", "api_checks", "run_logs"]);
}

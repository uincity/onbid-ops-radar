// probe_results(오퍼레이션별 점검 판정) 테이블이 DESIGN·PRD v2.0 대로 만들어졌는지 확인한다 (R03)
// 동작 시험(상태·사유 짝, 중복, 인증키 거부 등)은 pgTAP 08_probe_results.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(칸·RLS·정책·권한·연결·제약)와 "로그인 없이는 읽기·쓰기 모두 거부"만 본다.
export const title = "점검 판정 (probe_results)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable } = ctx;

  await checkReadOnlyTable(
    "probe_results",
    [
      "id", "run_id", "source", "api_id", "operation_id", "status", "attempted", "reason", "had_data", "result_code", "http_status",
      "duration_ms", "record_count", "schema_summary", "probe_version", "request_summary", "checked_at",
    ],
    { run_id: 1, source: "PUBLIC", api_id: "SVC-API-001", operation_id: "getRlstCltrList", status: "PASS_DATA", attempted: true },
  );

  const constraints = await query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.probe_results'::regclass`,
  );
  const def = (name) => constraints.find((c) => c.conname === name)?.def ?? "";

  report(/FOREIGN KEY \(run_id, source\) REFERENCES check_runs\(id, source\)/.test(def("probe_results_run_source_fkey")), "probe_results: 점검 실행과 출처가 항상 같도록 연결됨 (DEMO/PUBLIC 섞임 방지)");
  report(/UNIQUE \(run_id, api_id, operation_id\)/.test(def("probe_results_run_operation_key")), "probe_results: 한 점검에서 같은 오퍼레이션의 판정은 1줄만 허용");
  const pairing = def("probe_results_status_reason_check");
  report(
    ["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "UNVERIFIED", "NOT_RUN", "POSITIVE_DATA_MISSING", "BUDGET_SKIP", "NO_VALID_INPUT", "RETRIED_THEN_OK"].every((word) => pairing.includes(word)),
    "probe_results: 상태 6종과 세부 사유의 짝이 맞는 조합만 저장 가능",
  );
  report(/servicekey/i.test(def("probe_results_request_summary_check")), "probe_results: 요청 요약에 인증키가 있으면 저장을 거부하는 제약 있음");

  // api_checks에 더한 칸의 제약
  const apiChecks = await query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.api_checks'::regclass`);
  const apiDef = (name) => apiChecks.find((c) => c.conname === name)?.def ?? "";
  report(/SVC-API-/.test(apiDef("api_checks_api_id_check")) && apiDef("api_checks_api_operation_pair_check") !== "", "api_checks: 서비스ID 형식과 '서비스ID·오퍼레이션 ID 함께만' 제약 있음");
  report(/servicekey/i.test(apiDef("api_checks_request_summary_check")), "api_checks: 요청 요약에 인증키가 있으면 저장을 거부하는 제약 있음");

  // 허용 규칙 ID: 이전 4개 + 데이터 품질 4개 + API 상태 7개 + 홈페이지 모니터링 2개(W10a) = 17개
  const [anomalyRule] = await query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.anomalies'::regclass and conname = 'anomalies_rule_id_check'`);
  const ids = [...(anomalyRule?.def ?? "").matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
  report(ids.length === 17, "anomalies: 허용 규칙 ID가 17개 (이전 4 + 데이터 품질 4 + API 상태 7 + 웹 2)", `${ids.length}개`);
  report(["DATE_ORDER", "EMPTY_RESULT", "DQ_SCHEMA", "DQ_CROSS_API_REF", "API_TIMEOUT", "API_QUOTA_EXCEEDED"].every((id) => ids.includes(id)), "anomalies: 이전 규칙 ID가 그대로 있고 새 규칙 ID가 더해짐");

  // 이전 행이 보존되었는지: 새 칸이 비어 있는 api_checks 줄은 그대로 읽힌다 (줄 수는 시험 전후 비교가 따로 확인한다)
  const [legacy] = await query(`select count(*)::int as n from public.api_checks where api_id is null`);
  report(typeof legacy?.n === "number", "api_checks: 새 칸이 비어 있는 이전 기록이 그대로 조회됨", `${legacy?.n}줄`);
}

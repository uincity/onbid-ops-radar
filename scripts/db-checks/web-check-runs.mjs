// web_check_runs · web_probe_results · web_target_state · web_retry_queue 테이블이 설계서 6.1대로 만들어졌는지 확인한다 (W04)
// 동작 시험(정시 칸 중복, 멈춘 실행 정리, 대체 실행 예약 등)은 pgTAP 14_web_check_runs.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(칸·RLS·정책·권한·연결·제약·함수 권한)와 "로그인 없이는 읽기·쓰기 모두 거부"만 본다.
export const title = "웹 점검 기록 (web_check_runs · web_probe_results · web_target_state · web_retry_queue)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable } = ctx;

  await checkReadOnlyTable(
    "web_check_runs",
    ["id", "target_key", "trigger", "slot_at", "status", "started_at", "finished_at", "origin_run_id", "triggered_by", "request_count", "overall_verdict", "confirmed_verdict", "flap", "planned_maintenance"],
    { target_key: "onbid-home", trigger: "manual" },
  );
  await checkReadOnlyTable(
    "web_probe_results",
    ["id", "run_id", "target_key", "layer", "counts_toward_overall", "verdict", "reason", "http_status", "duration_ms", "final_url", "cert_days_left", "detail", "created_at"],
    { run_id: 1, target_key: "onbid-home", layer: "L2_HTTP", counts_toward_overall: true, verdict: "PASS_DATA" },
  );
  await checkReadOnlyTable(
    "web_target_state",
    [
      "target_key", "current_verdict", "since", "first_failure_at", "incident_no", "incident_open", "incident_last_alert_at", "ongoing_count", "open_anomaly_id",
      "consecutive_degraded", "degraded_start_run_id", "consecutive_unverifiable", "unverifiable_start_run_id", "aux_state", "unplanned_since_run_id", "unplanned_since",
      "alerts_today", "alerts_today_date", "version", "updated_at",
    ],
    { target_key: "onbid-home", current_verdict: "PASS_DATA", since: "2026-11-05T00:00:00Z" },
    { selectColumn: "target_key" },
  );
  await checkReadOnlyTable(
    "web_retry_queue",
    ["id", "target_key", "kind", "origin_run_id", "due_at", "status", "claimed_at", "attempts", "created_at", "processed_at"],
    { target_key: "onbid-home", kind: "confirm", due_at: "2026-11-05T00:00:00Z" },
  );

  // 인덱스(동시 실행 방지, 정시 칸 중복 방지, 대상별 대기 줄 1개)
  const indexes = await query(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('web_check_runs', 'web_retry_queue')`);
  const idx = (name) => indexes.find((i) => i.indexname === name)?.indexdef ?? "";
  report(/UNIQUE/.test(idx("web_check_runs_only_one_running")) && /running/.test(idx("web_check_runs_only_one_running")), "web_check_runs: 실행 중(running)은 전체에서 하나만 허용하는 제약 있음");
  report(/UNIQUE/.test(idx("web_check_runs_slot_once")) && /target_key, slot_at/.test(idx("web_check_runs_slot_once")) && /blocked/.test(idx("web_check_runs_slot_once")), "web_check_runs: 같은 대상·같은 정시 칸의 (차단되지 않은) 정시 실행은 하나만 허용");
  report(/UNIQUE/.test(idx("web_retry_queue_one_active_per_target")) && /pending/.test(idx("web_retry_queue_one_active_per_target")), "web_retry_queue: 대상별 대기/처리 중 줄은 1개만 허용");

  // 연결(외래키)
  const fks = await query(
    `select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint
     where contype = 'f' and conrelid in ('public.web_check_runs'::regclass, 'public.web_probe_results'::regclass, 'public.web_target_state'::regclass, 'public.web_retry_queue'::regclass)`,
  );
  const hasFk = (tbl, text) => fks.some((f) => f.tbl === tbl && f.def.includes(text));
  report(hasFk("web_check_runs", "REFERENCES profiles(id)"), "web_check_runs.triggered_by → profiles 연결됨");
  report(hasFk("web_check_runs", "REFERENCES web_check_runs(id) ON DELETE SET NULL"), "web_check_runs.origin_run_id → 원래 실행 연결됨 (삭제되면 비움)");
  report(hasFk("web_probe_results", "REFERENCES web_check_runs(id, target_key) ON DELETE CASCADE"), "web_probe_results: 점검 실행과 대상 키가 항상 같도록 연결됨 (실행 삭제 시 함께 삭제)");
  report(hasFk("web_target_state", "REFERENCES anomalies(id)"), "web_target_state.open_anomaly_id → anomalies 연결됨");
  report(hasFk("web_retry_queue", "REFERENCES web_check_runs(id) ON DELETE SET NULL"), "web_retry_queue.origin_run_id → web_check_runs 연결됨");

  // 닫힌 사유 목록과 판정 짝 제약
  const cons = await query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.web_probe_results'::regclass and contype = 'c'`);
  const def = (name) => cons.find((c) => c.conname === name)?.def ?? "";
  const reasons = [...def("web_probe_results_reason_check").matchAll(/'([A-Z0-9_]+)'::text/g)].map((m) => m[1]);
  report(reasons.length === 22, "web_probe_results: 허용 사유가 닫힌 목록 22개", `${reasons.length}개`);
  report(def("web_probe_results_reason_presence_check") !== "" && def("web_probe_results_not_run_reason_check") !== "", "web_probe_results: 정상=사유 없음 / 미점검 사유 제한 제약 있음");
  report(/\?/.test(def("web_probe_results_final_url_check")) || /\[\?#\]/.test(def("web_probe_results_final_url_check")), "web_probe_results: 주소의 질의·조각 저장 거부 제약 있음");

  // 함수: 서버 관리용 키만 실행 가능, 소유자 권한 + 빈 search_path
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('start_web_check_run', 'finish_web_check_run')`,
  );
  report(fns.length === 2, "start_web_check_run·finish_web_check_run 함수가 있음", `${fns.length}개`);
  report(fns.every((f) => !f.anon_ok && !f.auth_ok && f.service_ok), "두 함수는 서버 관리용 키만 실행할 수 있음 (비로그인·로그인 사용자는 불가)");
  report(fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /search_path=""/.test(c))), "두 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");
}

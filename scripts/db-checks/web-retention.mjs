// web_daily_summary 표와 집계·보존 삭제 함수가 설계서 5.8·5.9·6.1대로 만들어졌는지 확인한다 (W19)
// 동작 시험(집계 정확성, KST 하루 경계, 저장된 요약 읽기, 보존 삭제 경계, 추가 전용 기록 보존, 멱등)은 pgTAP 20_web_retention.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(칸·RLS·정책·권한·함수 권한)와 "로그인 없이는 읽기·쓰기 모두 거부"만 본다.
export const title = "웹 일별 요약·보존 삭제 (web_daily_summary · web_summarize_day · web_retention_cleanup)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable } = ctx;

  await checkReadOnlyTable(
    "web_daily_summary",
    ["summary_date", "target_key", "pass_data", "pass_no_data", "degraded", "fail", "unverified", "not_run", "planned_count", "unplanned_count", "flap_count", "confirmed_down_count", "down_seconds", "avg_ms", "max_ms", "created_at"],
    { summary_date: "2026-01-01", target_key: "onbid-home" },
    { selectColumn: "target_key" },
  );

  const names = ["web_summarize_day", "web_retention_cleanup"];
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(", ")})`,
  );
  report(fns.length === names.length, "집계·보존 삭제 함수 2개가 있음", `${fns.length}개`);
  report(fns.every((f) => !f.anon_ok && !f.auth_ok && f.service_ok), "두 함수는 서버 관리용 키(크론 포함)만 실행할 수 있음 (비로그인·로그인 사용자는 불가)");
  report(fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /search_path=""/.test(c))), "두 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");

  // 판정 줄이 점검 실행과 함께 삭제되고(cascade), 재확인 줄의 원래 실행 연결은 비워져야(set null) 보존 삭제가 막히지 않는다
  const fks = await query(
    `select conrelid::regclass::text as tbl, confdeltype from pg_constraint
      where contype = 'f' and confrelid = 'public.web_check_runs'::regclass and conrelid in ('public.web_probe_results'::regclass, 'public.web_check_runs'::regclass)`,
  );
  report(fks.some((f) => f.tbl === "web_probe_results" && f.confdeltype === "c"), "web_probe_results → 점검 실행: 삭제 시 함께 삭제(cascade)");
  report(fks.some((f) => f.tbl === "web_check_runs" && f.confdeltype === "n"), "web_check_runs.origin_run_id: 원래 실행이 삭제되면 비워짐(set null)");
}

// web_maintenance_windows 테이블과 계획 점검 창 함수 4개가 설계서 6.1·6.3대로 만들어졌는지 확인한다 (W15)
// 동작 시험(권한, 겹침 거부, 최대 길이, 취소 세 경우, 경계, 계획 점검 표시)은 pgTAP 18_web_maintenance_windows.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(칸·RLS·정책·권한·겹침 배제 제약·함수 권한)와 "로그인 없이는 읽기·쓰기 모두 거부"만 본다.
export const title = "웹 계획 점검 창 (web_maintenance_windows · create/cancel_maintenance_window · web_in_maintenance · mark_web_run_planned)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable } = ctx;

  await checkReadOnlyTable(
    "web_maintenance_windows",
    ["id", "target_key", "starts_at", "ends_at", "reason", "created_by", "created_at", "cancelled_at", "cancelled_by"],
    { target_key: "onbid-home", starts_at: "2026-11-09T14:00:00Z", ends_at: "2026-11-09T17:00:00Z", reason: "시험", created_by: "00000000-0000-4000-8000-000000000000" },
  );

  // 같은 대상의 취소되지 않은 창은 겹칠 수 없다 (배제 제약)
  const cons = await query(`select conname, contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.web_maintenance_windows'::regclass`);
  const noOverlap = cons.find((c) => c.conname === "web_maintenance_windows_no_overlap");
  report(noOverlap?.contype === "x" && /target_key WITH =/.test(noOverlap.def) && /&&/.test(noOverlap.def) && /cancelled_at IS NULL/.test(noOverlap.def), "web_maintenance_windows: 같은 대상의 취소되지 않은 창은 겹칠 수 없음 (배제 제약)");
  report(cons.some((c) => c.conname === "web_maintenance_windows_range_check") && cons.some((c) => c.conname === "web_maintenance_windows_reason_check") && cons.some((c) => c.conname === "web_maintenance_windows_max_len_check"), "web_maintenance_windows: 종료>시작·사유 1~200자·최대 길이 제약 있음");

  const names = ["create_maintenance_window", "cancel_maintenance_window", "web_in_maintenance", "mark_web_run_planned"];
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(", ")})`,
  );
  const f = (name) => fns.find((x) => x.proname === name);
  report(fns.length === names.length, "계획 점검 창 함수 4개가 있음", `${fns.length}개`);
  report(!f("create_maintenance_window")?.anon_ok && f("create_maintenance_window")?.auth_ok && !f("cancel_maintenance_window")?.anon_ok && f("cancel_maintenance_window")?.auth_ok, "등록·취소 함수는 비로그인은 실행할 수 없고 로그인 사용자는 실행할 수 있음 (함수 안에서 팀장 확인)");
  report(["web_in_maintenance", "mark_web_run_planned"].every((n) => !f(n)?.anon_ok && !f(n)?.auth_ok && f(n)?.service_ok), "판정·표시 함수는 서버 관리용 키만 실행할 수 있음");
  report(fns.every((x) => x.prosecdef && (x.proconfig ?? []).some((c) => /search_path=""/.test(c))), "네 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");
}

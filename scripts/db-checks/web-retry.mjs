// 확인 재시도·정시 대체 실행 대기 줄 함수 5개가 설계서 5.2·6.3대로 만들어졌는지 확인한다 (W11)
// 동작 시험(예약, 원자적 선점, 멈춘 줄 복구, 만료, 다시 시도, 빈 큐에서 앱 미호출)은 pgTAP 16_web_retry_queue.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 함수가 있는지, 서버 관리용 키만 실행할 수 있는지, 소유자 권한 + 빈 search_path인지만 본다.
export const title = "웹 재확인 대기 줄 함수 (enqueue_web_confirm · claim_due_web_retry · finish_web_retry · web_retry_housekeeping · web_enqueue_due_retries)";

export async function run(ctx) {
  const { report, query } = ctx;
  const names = ["enqueue_web_confirm", "claim_due_web_retry", "finish_web_retry", "web_retry_housekeeping", "web_enqueue_due_retries"];
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(", ")})`,
  );
  report(fns.length === names.length, "재확인 대기 줄 함수 5개가 있음", `${fns.length}개`);
  report(fns.every((f) => !f.anon_ok && !f.auth_ok && f.service_ok), "다섯 함수는 서버 관리용 키만 실행할 수 있음 (비로그인·로그인 사용자는 불가)");
  report(fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /search_path=""/.test(c))), "다섯 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");

  // 대상별 대기/처리 중 줄은 1개 (부분 유니크 인덱스, W04)와 예정 시각 인덱스가 그대로 있어야 이 함수들이 안전하다
  const idx = await query(`select indexname from pg_indexes where schemaname = 'public' and tablename = 'web_retry_queue'`);
  report(idx.some((i) => i.indexname === "web_retry_queue_one_active_per_target"), "web_retry_queue: 대상별 대기/처리 중 줄은 1개 (유니크 인덱스)");
}

// 자체 감시 함수 2개와 web_heartbeat_sends 표가 설계서 5.5·6.3대로 만들어졌는지 확인한다 (W16)
// 동작 시험(130분 경계, 수동 실행 제외, 다시 켠 직후, 응답 읽기·재발송 3회, 재알림, 재개, 비밀값 없음)은 pgTAP 19_web_monitor_heartbeat.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(표 RLS·권한, 함수 권한)와 Vault 비밀값 이름이 있는지(값은 읽지 않는다)만 본다.
export const title = "웹 자체 감시 (web_monitor_heartbeat · web_heartbeat_post · web_heartbeat_sends)";

export async function run(ctx) {
  const { report, query } = ctx;

  const names = ["web_monitor_heartbeat", "web_heartbeat_post"];
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(", ")})`,
  );
  report(fns.length === names.length, "자체 감시 함수 2개가 있음", `${fns.length}개`);
  report(fns.every((f) => !f.anon_ok && !f.auth_ok && f.service_ok), "두 함수는 서버 관리용 키(크론 포함)만 실행할 수 있음");
  report(fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /search_path=""/.test(c))), "두 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");

  const [sends] = await query(`select c.relrowsecurity as rls, has_table_privilege('authenticated', c.oid, 'INSERT') as ins, has_table_privilege('anon', c.oid, 'SELECT') as anon_sel from pg_class c where c.oid = 'public.web_heartbeat_sends'::regclass`);
  report(sends?.rls === true && sends.ins === false && sends.anon_sel === false, "web_heartbeat_sends: RLS 켜짐, 로그인 사용자 쓰기 불가, 비로그인 읽기 불가");

  // 정지 알림은 앱 없이 DB가 직접 보내므로 Vault에 텔레그램 비밀값 두 개가 있어야 한다 (이름만 확인, 값은 읽지 않는다)
  const secrets = await query(`select name from vault.decrypted_secrets where name in ('onbid_telegram_token', 'onbid_telegram_chat_id')`);
  report(secrets.length === 2, "Vault에 텔레그램 비밀값 2개(onbid_telegram_token · onbid_telegram_chat_id)가 있음", `${secrets.length}개`);

  // pg_net 응답 표가 있어야 다음 주기에 발송 결과를 읽을 수 있다
  const [resp] = await query(`select to_regclass('net._http_response') is not null as ok`);
  report(resp?.ok === true, "pg_net 응답 표(net._http_response)가 있음");
}

// web_notification_keys · web_notifications 테이블과 상태 전환·알림 함수, 이상징후 표의 WEB 허용이 설계서 6.1·6.3대로 만들어졌는지 확인한다 (W10a)
// 동작 시험(키 선점, 시도 번호, 복구 기록, 버전 충돌, 원자성 등)은 pgTAP 15_web_notifications.test.sql이 롤백되는 트랜잭션 안에서 한다.
// 여기서는 구조(칸·RLS·정책·권한·추가 전용 장치·연결·제약·함수 권한)와 "로그인 없이는 읽기·쓰기 모두 거부"만 본다.
export const title = "웹 알림 (web_notification_keys · web_notifications) · 상태 전환 함수 · 이상징후 WEB 허용";

export async function run(ctx) {
  const { report, query, rest, checkReadOnlyTable, keys } = ctx;

  await checkReadOnlyTable(
    "web_notification_keys",
    ["key", "kind", "target_key", "incident_no", "created_at"],
    { key: "down:1", kind: "down", target_key: "onbid-home", incident_no: 1 },
    { selectColumn: "key" },
  );
  await checkReadOnlyTable(
    "web_notifications",
    ["id", "key", "attempt", "channel", "kind", "target_key", "status", "response_code", "net_request_id", "error_class", "payload", "created_at"],
    { key: "down:1", attempt: 0, kind: "down", target_key: "onbid-home", status: "queued" },
  );

  // 추가 전용: 수정·삭제·비우기 막는 장치, 서버 관리용 키도 읽기만 가능
  const triggers = await query(
    `select tgrelid::regclass::text as tbl, tgname from pg_trigger
      where tgrelid in ('public.web_notification_keys'::regclass, 'public.web_notifications'::regclass) and not tgisinternal`,
  );
  for (const tbl of ["web_notification_keys", "web_notifications"]) {
    const names = triggers.filter((t) => t.tbl === tbl).map((t) => t.tgname);
    report(names.includes(`${tbl}_no_update_delete`) && names.includes(`${tbl}_no_truncate`), `${tbl}: 수정·삭제·비우기를 막는 장치 있음 (추가 전용)`);
    const grants = await query(
      `select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = '${tbl}' and grantee = 'service_role'`,
    );
    const privs = grants.map((g) => g.privilege_type);
    report(privs.length === 1 && privs[0] === "SELECT", `${tbl}: 서버 관리용 키(service_role)도 읽기(SELECT)만 가능`, `권한: ${privs.join(",") || "없음"}`);
    const denied = await rest(tbl, "POST", keys.secret, tbl === "web_notifications"
      ? { key: "down:1", attempt: 0, kind: "down", target_key: "onbid-home", status: "queued" }
      : { key: "down:1", kind: "down", target_key: "onbid-home", incident_no: 1 });
    report([401, 403].includes(denied.status) && denied.code === "42501", `${tbl}: 관리용 키로 직접 추가 시도 → 거부 (추가는 DB 함수만)`, `응답 ${denied.status}, 오류 ${denied.code}`);
  }

  // 연결과 제약
  const fks = await query(
    `select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and conrelid = 'public.web_notifications'::regclass`,
  );
  report(fks.some((f) => f.def.includes("FOREIGN KEY (key, kind, target_key) REFERENCES web_notification_keys(key, kind, target_key)")), "web_notifications: 키·종류·대상이 선점된 키와 항상 같도록 묶여 있음");
  const kindDef = (await query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'web_notification_keys_kind_check'`))[0]?.def ?? "";
  const kinds = [...kindDef.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]);
  report(kinds.length === 11, "web_notification_keys: 알림 종류가 닫힌 목록 11개", `${kinds.length}개`);
  const uniq = await query(`select indexname from pg_indexes where schemaname = 'public' and tablename in ('web_notifications', 'anomaly_events') and indexdef like 'CREATE UNIQUE%'`);
  report(uniq.some((i) => i.indexname === "web_notifications_attempt_once_key"), "web_notifications: (키, 시도 번호)는 한 줄만 (유니크)");
  report(uniq.some((i) => i.indexname === "anomaly_events_one_recovered_per_incident"), "anomaly_events: 같은 사건 번호의 복구 확인은 한 번만 (유니크)");

  // 기존 이상징후 표·이력 표의 확장 (제약 3개)
  const anomalyCons = await query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('anomalies_source_check', 'anomalies_rule_id_check', 'anomaly_events_event_type_check')`,
  );
  const def = (name) => anomalyCons.find((c) => c.conname === name)?.def ?? "";
  report(/'WEB'/.test(def("anomalies_source_check")) && /'DEMO'/.test(def("anomalies_source_check")) && /'PUBLIC'/.test(def("anomalies_source_check")), "anomalies: 출처에 WEB이 더해지고 DEMO·PUBLIC은 그대로");
  report(/'WEB_AVAILABILITY'/.test(def("anomalies_rule_id_check")) && /'WEB_FRESHNESS'/.test(def("anomalies_rule_id_check")) && /'DATE_ORDER'/.test(def("anomalies_rule_id_check")), "anomalies: 규칙에 WEB_AVAILABILITY·WEB_FRESHNESS가 더해지고 기존 규칙은 그대로");
  report(/'recovered'/.test(def("anomaly_events_event_type_check")), "anomaly_events: 사건 종류에 recovered가 더해짐");

  // 함수: 서버 관리용 키만 실행 가능, 소유자 권한 + 빈 search_path
  const names = ["claim_notification", "record_notification_attempt", "record_recovery_event", "record_web_transition"];
  const fns = await query(
    `select p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(", ")})`,
  );
  report(fns.length === names.length, "알림·상태 전환 함수 4개가 있음", `${fns.length}개`);
  report(fns.every((f) => !f.anon_ok && !f.auth_ok && f.service_ok), "네 함수는 서버 관리용 키만 실행할 수 있음 (비로그인·로그인 사용자는 불가)");
  report(fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /search_path=""/.test(c))), "네 함수는 소유자 권한으로 실행되고 search_path가 비어 있음");
}

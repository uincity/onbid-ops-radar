// anomaly_events(이상징후 이력) 테이블이 DESIGN·PRD대로 만들어졌는지 확인한다 (PLAN 작업 10)
export const title = "이상징후 이력 (anomaly_events)";

export async function run(ctx) {
  const { report, query, rest, checkReadOnlyTable, rollbackProbe, expectUnchanged, keys } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable(
    "anomaly_events",
    ["id", "anomaly_id", "actor_type", "actor_id", "actor_role", "event_type", "from_value", "to_value", "note", "created_at"],
    { anomaly_id: 1, actor_type: "system", event_type: "created", to_value: "open" },
  );

  // 연결과 장치가 있는지
  const cons = await query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.anomaly_events'::regclass`,
  );
  const defs = cons.map((c) => c.def).join(" | ");
  report(/FOREIGN KEY \(anomaly_id\) REFERENCES anomalies\(id\)/.test(defs), "anomaly_id → anomalies 연결됨 (이력이 있는 이상징후는 지울 수 없음)");
  report(/FOREIGN KEY \(actor_id\) REFERENCES profiles\(id\)/.test(defs), "actor_id → profiles 연결됨 (이력이 있는 사용자는 지울 수 없음)");

  const triggers = await query(
    `select tgname from pg_trigger where tgrelid = 'public.anomaly_events'::regclass and not tgisinternal`,
  );
  const triggerNames = triggers.map((t) => t.tgname);
  report(triggerNames.includes("anomaly_events_no_update_delete"), "수정·삭제를 막는 장치 있음");
  report(triggerNames.includes("anomaly_events_no_truncate"), "전체 비우기를 막는 장치 있음");

  // 서버 관리용 키(service_role)도 읽기만 가능해야 한다 (SEC-05)
  const serviceGrants = await query(
    `select privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'anomaly_events' and grantee = 'service_role'`,
  );
  const servicePrivs = serviceGrants.map((g) => g.privilege_type);
  report(servicePrivs.length === 1 && servicePrivs[0] === "SELECT", "서버 관리용 키(service_role)도 읽기(SELECT)만 가능", `권한: ${servicePrivs.join(",") || "없음"}`);

  // 관리용 키로 직접 추가·수정·삭제를 시도해도 권한이 없어 거부된다 (저장되는 줄 없음)
  const sample = { anomaly_id: 1, actor_type: "system", event_type: "created", to_value: "open" };
  const deniedInsert = await rest("anomaly_events", "POST", keys.secret, sample);
  report([401, 403].includes(deniedInsert.status) && deniedInsert.code === "42501", "관리용 키로 직접 이력 추가 시도 → 거부 (추가는 DB 함수만)", `응답 ${deniedInsert.status}, 오류 ${deniedInsert.code}`);
  const deniedUpdate = await rest("anomaly_events", "PATCH", keys.secret, { note: "조작" }, "?id=eq.1");
  report([401, 403].includes(deniedUpdate.status) && deniedUpdate.code === "42501", "관리용 키로 이력 수정 시도 → 거부", `응답 ${deniedUpdate.status}, 오류 ${deniedUpdate.code}`);
  const deniedDelete = await rest("anomaly_events", "DELETE", keys.secret, undefined, "?id=eq.1");
  report([401, 403].includes(deniedDelete.status) && deniedDelete.code === "42501", "관리용 키로 이력 삭제 시도 → 거부", `응답 ${deniedDelete.status}, 오류 ${deniedDelete.code}`);

  // 동작 확인: 트랜잭션 안에서 넣어 보고 마지막에 전부 되돌린다 (저장되는 줄 없음)
  // 시험용 사용자(profiles 줄)도 같은 트랜잭션 안에서만 만들고 함께 되돌려진다. 실제 계정은 만들어지지 않는다.
  // 값은 'OK'(들어감) 또는 오류 코드(23514 규칙 위반, 23503 연결 없음, 23000 변경 금지)로 돌아온다.
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const ev = (type, actorType, from, to, note, anomaly = "a1") => {
    const user = actorType === "operator" ? "p1" : actorType === "admin" ? "p2" : "null";
    const kind = actorType === "system" ? "system" : "user";
    const role = kind === "system" ? "null" : `'${actorType}'`;
    const lit = (v) => (v === null ? "null" : v.startsWith("@") ? v.slice(1) : `'${v}'`);
    return `insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value, note)
            values (${anomaly}, '${kind}', ${user}, ${role}, '${type}', ${lit(from)}, ${lit(to)}, ${lit(note)})`;
  };

  const probe = await rollbackProbe(`
    a1 bigint; p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
    begin
      set local session_replication_role = 'replica';
      insert into public.profiles (id, display_name, role) values (p1, '시험 담당', 'operator'), (p2, '시험 팀장', 'admin');
      set local session_replication_role = 'origin';
      insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'DEMO-0001', 'DATE_ORDER', 'h1') returning id into a1;

      -- 시스템이 남기는 이력
      ${t("created_ok", ev("created", "system", null, "open", null))}
      ${t("created_wrong_to", ev("created", "system", null, "investigating", null))}
      ${t("again_ok", ev("detected_again", "system", "1", "2", null))}
      ${t("again_not_number", ev("detected_again", "system", "1", "많이", null))}

      -- 사람이 남기는 이력: 배정
      ${t("assign_self_ok", ev("assigned", "operator", null, "@p1::text", null))}
      ${t("reassign_ok", ev("assigned", "admin", "@p1::text", "@p2::text", null))}
      ${t("assign_same", ev("assigned", "admin", "@p2::text", "@p2::text", null))}
      ${t("assign_not_uuid", ev("assigned", "admin", null, "누구", null))}

      -- 사람이 남기는 이력: 상태변경
      ${t("start_review_ok", ev("status_changed", "operator", "open", "investigating", null))}
      ${t("resolve_no_note", ev("status_changed", "operator", "investigating", "resolved", null))}
      ${t("resolve_short_note", ev("status_changed", "operator", "investigating", "resolved", "조치함"))}
      ${t("resolve_spaces_only", ev("status_changed", "operator", "investigating", "resolved", "   조    치   "))}
      ${t("resolve_ok", ev("status_changed", "operator", "investigating", "resolved", "원본 데이터를 바로잡고 다시 점검함"))}
      ${t("dismiss_ok", ev("status_changed", "admin", "investigating", "dismissed", "정상 변경으로 확인되어 오탐 처리함"))}
      ${t("reopen_no_note", ev("status_changed", "operator", "resolved", "investigating", null))}
      ${t("reopen_ok", ev("status_changed", "operator", "resolved", "investigating", "다시 확인할 내용이 있어 재개함"))}
      ${t("skip_review", ev("status_changed", "operator", "open", "resolved", "검토 없이 바로 닫으려는 시도"))}
      ${t("back_to_open", ev("status_changed", "operator", "investigating", "open", null))}

      -- 사람이 남기는 이력: 판정
      ${t("verdict_ok", ev("verdict_changed", "operator", "undetermined", "confirmed_issue", null))}
      ${t("verdict_same", ev("verdict_changed", "operator", "confirmed_issue", "confirmed_issue", null))}
      ${t("verdict_bad_value", ev("verdict_changed", "operator", "undetermined", "maybe", null))}

      -- 누가 무엇을 남길 수 있는지
      ${t("user_creates", ev("created", "operator", null, "open", null))}
      ${t("system_assigns", ev("assigned", "system", null, "@p1::text", null))}
      ${t("user_without_actor", `insert into public.anomaly_events (anomaly_id, actor_type, actor_role, event_type, from_value, to_value) values (a1, 'user', 'operator', 'verdict_changed', 'undetermined', 'false_positive')`)}
      ${t("system_with_actor", `insert into public.anomaly_events (anomaly_id, actor_type, actor_id, event_type, to_value) values (a1, 'system', p1, 'created', 'open')`)}
      ${t("bad_role", `insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value) values (a1, 'user', p1, 'viewer', 'verdict_changed', 'undetermined', 'false_positive')`)}

      -- 연결과 비밀 값
      ${t("missing_anomaly", ev("created", "system", null, "open", null, "-1"))}
      ${t("missing_actor", `insert into public.anomaly_events (anomaly_id, actor_type, actor_id, actor_role, event_type, from_value, to_value) values (a1, 'user', gen_random_uuid(), 'operator', 'verdict_changed', 'undetermined', 'false_positive')`)}
      ${t("note_with_key", ev("verdict_changed", "operator", "undetermined", "false_positive", "참고 https://x.example/a?serviceKey=abc123"))}
      ${t("note_masked_key_ok", ev("verdict_changed", "operator", "undetermined", "false_positive", "참고 https://x.example/a?serviceKey=****"))}

      -- 수정·삭제·비우기는 소유자 권한으로 시도해도 막힌다 (SEC-05)
      ${t("update_blocked", `update public.anomaly_events set note = '조작' where anomaly_id = a1`)}
      ${t("delete_blocked", `delete from public.anomaly_events where anomaly_id = a1`)}
      ${t("truncate_blocked", `truncate table public.anomaly_events`)}
      ${t("delete_parent_blocked", `delete from public.anomalies where id = a1`)}
      ${t("delete_actor_blocked", `delete from public.profiles where id = p1`)}
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);
  expect("created_ok", "OK", "시스템의 '생성' 이력은 저장됨");
  expect("created_wrong_to", "23514", "'생성' 이력의 결과 값은 미확인(open)만 허용");
  expect("again_ok", "OK", "시스템의 '재탐지' 이력(횟수 1→2)은 저장됨");
  expect("again_not_number", "23514", "'재탐지' 이력의 횟수가 숫자가 아니면 거부");

  expect("assign_self_ok", "OK", "담당자 본인 배정 이력은 저장됨");
  expect("reassign_ok", "OK", "팀장의 재배정 이력은 저장됨 (행위자 역할 admin이 함께 기록)");
  expect("assign_same", "23514", "같은 담당자로 '재배정'하는 이력은 거부");
  expect("assign_not_uuid", "23514", "배정 대상이 사용자 ID 형식이 아니면 거부");

  expect("start_review_ok", "OK", "미확인 → 검토 중 이력은 사유 없이도 저장됨");
  expect("resolve_no_note", "23514", "조치 완료 이력에 사유가 없으면 거부");
  expect("resolve_short_note", "23514", "조치 완료 이력의 사유가 짧으면(10자 미만) 거부");
  expect("resolve_spaces_only", "23514", "공백을 빼고 10자 미만인 사유는 거부 (PRD 5-3 규칙 2)");
  expect("resolve_ok", "OK", "사유가 10자 이상인 조치 완료 이력은 저장됨");
  expect("dismiss_ok", "OK", "팀장의 정상 판정 이력은 사유와 함께 저장됨");
  expect("reopen_no_note", "23514", "검토 재개 이력에 사유가 없으면 거부 (PRD 5-3 규칙 3)");
  expect("reopen_ok", "OK", "사유가 있는 검토 재개 이력은 저장됨");
  expect("skip_review", "23514", "허용되지 않은 상태 전이(open → resolved)는 이력으로도 기록할 수 없음");
  expect("back_to_open", "23514", "허용되지 않은 상태 전이(investigating → open)는 거부");

  expect("verdict_ok", "OK", "판정 변경 이력은 저장됨");
  expect("verdict_same", "23514", "같은 값으로 바꾸는 판정 이력은 거부");
  expect("verdict_bad_value", "23514", "정해진 판정 값 외의 이력은 거부");

  expect("user_creates", "23514", "사용자가 '생성' 이력을 남길 수는 없음 (탐지 사실은 시스템만)");
  expect("system_assigns", "23514", "시스템이 '배정' 이력을 남길 수는 없음 (판단은 사람만)");
  expect("user_without_actor", "23514", "사용자 이력에 행위자가 없으면 거부");
  expect("system_with_actor", "23514", "시스템 이력에 행위자가 있으면 거부");
  expect("bad_role", "23514", "행위자 역할은 operator/admin만 허용");

  expect("missing_anomaly", "23503", "없는 이상징후에는 이력을 남길 수 없음");
  expect("missing_actor", "23503", "없는 사용자의 이력은 남길 수 없음");
  expect("note_with_key", "23514", "사유에 인증키(serviceKey=값)가 있으면 거부 (SEC-10)");
  expect("note_masked_key_ok", "OK", "인증키를 ****로 가린 사유는 저장됨");

  expect("update_blocked", "23000", "저장된 이력은 수정할 수 없음 (소유자 권한으로도)");
  expect("delete_blocked", "23000", "저장된 이력은 삭제할 수 없음");
  expect("truncate_blocked", "23000", "이력 전체 비우기는 할 수 없음");
  expect("delete_parent_blocked", "23503", "이력이 있는 이상징후는 지울 수 없음 (이력이 고아가 되지 않음)");
  expect("delete_actor_blocked", "23503", "이력을 남긴 사용자는 지울 수 없음");

  await expectUnchanged(["anomaly_events", "anomalies", "profiles"]);
}

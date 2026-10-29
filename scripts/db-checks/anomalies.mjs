// anomalies(이상징후) 테이블이 DESIGN·PRD대로 만들어졌는지 확인한다 (PLAN 작업 9)
import { randomUUID } from "node:crypto";

export const title = "이상징후 (anomalies)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable, rollbackProbe, expectEmpty } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable(
    "anomalies",
    [
      "id", "source", "item_key", "rule_id", "status", "verdict", "assignee_id", "version",
      "evidence", "value_hash", "detect_count", "first_detected_at", "last_detected_at", "previous_anomaly_id",
    ],
    { source: "DEMO", item_key: "DEMO-0001", rule_id: "DATE_ORDER", value_hash: "h" },
  );

  // 연결·제약·보호 장치가 있는지
  const cons = await query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.anomalies'::regclass`,
  );
  const defOf = (name) => cons.find((c) => c.conname === name)?.def ?? "";
  report(/FOREIGN KEY \(assignee_id\) REFERENCES profiles\(id\)/.test(cons.map((c) => c.def).join(" | ")), "assignee_id → profiles 연결됨 (담당자)");
  report(
    /FOREIGN KEY \(previous_anomaly_id, source, item_key, rule_id\) REFERENCES anomalies\(id, source, item_key, rule_id\)/.test(defOf("anomalies_previous_same_identity_fkey")),
    "재발 연결은 같은 출처·물건·규칙의 이상징후만 가리킬 수 있음",
  );

  const [active] = await query(
    `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'anomalies_one_active_per_identity'`,
  );
  report(
    Boolean(active) && /UNIQUE/.test(active.indexdef) && /open/.test(active.indexdef) && /investigating/.test(active.indexdef),
    "같은 출처·물건·규칙의 열린(open/investigating) 건은 하나만 허용하는 제약 있음",
  );

  const [trigger] = await query(
    `select 1 as ok from pg_trigger where tgrelid = 'public.anomalies'::regclass and tgname = 'anomalies_protect_identity'`,
  );
  report(Boolean(trigger), "식별 정보(출처·물건·규칙 등) 변경 방지 장치 있음");

  // 동작 확인: 트랜잭션 안에서 넣어 보고 마지막에 전부 되돌린다 (저장되는 줄 없음)
  // 값은 'OK'(들어감) 또는 오류 코드(23514 규칙 위반, 23505 중복, 23503 연결 없음, 23000 변경 금지)로 돌아온다.
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const ins = (source, item, rule, status = "open", verdict = "undetermined", extra = "") =>
    `insert into public.anomalies (source, item_key, rule_id, status, verdict, value_hash${extra ? ", previous_anomaly_id" : ""}) values ('${source}', '${item}', '${rule}', '${status}', '${verdict}', 'h1'${extra ? `, ${extra}` : ""})`;
  const raw = (cols, vals) => `insert into public.anomalies (source, item_key, rule_id, value_hash${cols}) values ('DEMO', 'DEMO-9000', 'DATE_ORDER', 'h1'${vals})`;

  const probe = await rollbackProbe(`
    a1 bigint; c1 bigint;
    begin
      insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'DEMO-0001', 'DATE_ORDER', 'h1') returning id into a1;
      r := r || (select jsonb_build_object('def_status', status, 'def_verdict', verdict, 'def_version', version, 'def_count', detect_count,
                                           'def_assignee_null', assignee_id is null, 'def_evidence', evidence::text)
                 from public.anomalies where id = a1);

      -- 중복 방지
      ${t("dup_open", ins("DEMO", "DEMO-0001", "DATE_ORDER"))}
      ${t("dup_investigating", ins("DEMO", "DEMO-0001", "DATE_ORDER", "investigating"))}
      ${t("other_rule_ok", ins("DEMO", "DEMO-0001", "REQUIRED_FIELD"))}
      ${t("other_source_ok", ins("PUBLIC", "DEMO-0001", "DATE_ORDER"))}

      -- 재발 연결
      insert into public.anomalies (source, item_key, rule_id, status, verdict, value_hash) values ('DEMO', 'DEMO-0002', 'DATE_ORDER', 'resolved', 'confirmed_issue', 'h1') returning id into c1;
      ${t("recurrence_ok", ins("DEMO", "DEMO-0002", "DATE_ORDER", "open", "undetermined", "c1"))}
      ${t("recurrence_wrong_item", ins("DEMO", "DEMO-0003", "DATE_ORDER", "open", "undetermined", "c1"))}
      ${t("recurrence_wrong_rule", ins("DEMO", "DEMO-0002", "REQUIRED_FIELD", "open", "undetermined", "c1"))}

      -- 상태와 판정의 짝
      ${t("open_with_verdict", ins("DEMO", "DEMO-0010", "DATE_ORDER", "open", "confirmed_issue"))}
      ${t("resolved_undetermined", ins("DEMO", "DEMO-0011", "DATE_ORDER", "resolved", "undetermined"))}
      ${t("resolved_false_positive", ins("DEMO", "DEMO-0012", "DATE_ORDER", "resolved", "false_positive"))}
      ${t("dismissed_confirmed", ins("DEMO", "DEMO-0013", "DATE_ORDER", "dismissed", "confirmed_issue"))}
      ${t("dismissed_ok", ins("DEMO", "DEMO-0014", "DATE_ORDER", "dismissed", "false_positive"))}
      ${t("investigating_confirmed_ok", ins("DEMO", "DEMO-0015", "DATE_ORDER", "investigating", "confirmed_issue"))}

      -- 허용되지 않는 값
      ${t("bad_status", ins("DEMO", "DEMO-0020", "DATE_ORDER", "closed"))}
      ${t("bad_verdict", ins("DEMO", "DEMO-0021", "DATE_ORDER", "investigating", "maybe"))}
      ${t("bad_rule", ins("DEMO", "DEMO-0022", "PRICE_ANOMALY"))}
      ${t("bad_source", ins("TEST", "DEMO-0023", "DATE_ORDER"))}
      ${t("blank_item_key", ins("DEMO", "   ", "DATE_ORDER"))}
      ${t("version_zero", raw(", version", ", 0"))}
      ${t("count_zero", raw(", detect_count", ", 0"))}
      ${t("last_before_first", raw(", first_detected_at, last_detected_at", ", now(), now() - interval '1 hour'"))}
      ${t("evidence_not_object", raw(", evidence", ", '[]'::jsonb"))}
      ${t("evidence_too_big", raw(", evidence", ", jsonb_build_object('note', repeat('x', 20000))"))}
      ${t("blank_hash", `insert into public.anomalies (source, item_key, rule_id, value_hash) values ('DEMO', 'DEMO-9001', 'DATE_ORDER', '  ')`)}
      ${t("missing_assignee", raw(", assignee_id", `, '${randomUUID()}'`))}

      -- 한번 정해지면 바꿀 수 없는 칸
      ${t("change_item_key", `update public.anomalies set item_key = 'DEMO-7777' where id = a1`)}
      ${t("change_rule", `update public.anomalies set rule_id = 'REQUIRED_FIELD' where id = a1`)}
      ${t("change_first_detected", `update public.anomalies set first_detected_at = now() - interval '1 day' where id = a1`)}
      ${t("change_previous", `update public.anomalies set previous_anomaly_id = c1 where id = a1`)}

      -- 바꿀 수 있는 칸
      ${t("update_count_ok", `update public.anomalies set version = version + 1, detect_count = detect_count + 1, last_detected_at = now() where id = a1`)}
      ${t("update_to_investigating_ok", `update public.anomalies set status = 'investigating' where id = a1`)}
      ${t("update_to_resolved_undetermined", `update public.anomalies set status = 'resolved' where id = a1`)}
      ${t("update_to_resolved_ok", `update public.anomalies set status = 'resolved', verdict = 'confirmed_issue' where id = a1`)}
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);

  report(
    probe.def_status === "open" && probe.def_verdict === "undetermined" && probe.def_version === 1 && probe.def_count === 1 && probe.def_assignee_null === true && probe.def_evidence === "{}",
    "새 이상징후의 기본값: 미확인(open)·미판정·버전 1·탐지 1회·담당자 없음",
    `${probe.def_status}/${probe.def_verdict}/v${probe.def_version}/${probe.def_count}회`,
  );

  expect("dup_open", "23505", "같은 출처·물건·규칙의 열린 건이 있으면 새 open 건은 거부");
  expect("dup_investigating", "23505", "열린 건이 있으면 검토 중(investigating) 건을 새로 만드는 것도 거부");
  expect("other_rule_ok", "OK", "같은 물건이라도 다른 규칙의 이상징후는 따로 저장됨");
  expect("other_source_ok", "OK", "같은 물건 ID라도 출처(PUBLIC)가 다르면 따로 저장됨");

  expect("recurrence_ok", "OK", "조치 완료된 건과 같은 물건·규칙이 다시 걸리면 새 건으로 만들고 이전 건과 연결됨");
  expect("recurrence_wrong_item", "23503", "재발 연결이 다른 물건의 건을 가리키면 거부");
  expect("recurrence_wrong_rule", "23503", "재발 연결이 다른 규칙의 건을 가리키면 거부");

  expect("open_with_verdict", "23514", "미확인(open)인데 판정이 있으면 거부");
  expect("resolved_undetermined", "23514", "조치 완료(resolved)인데 미판정이면 거부");
  expect("resolved_false_positive", "23514", "조치 완료(resolved)인데 '정상·오탐' 판정이면 거부");
  expect("dismissed_confirmed", "23514", "정상 판정(dismissed)인데 '실제 오류' 판정이면 거부");
  expect("dismissed_ok", "OK", "정상 판정(dismissed) + 정상·오탐(false_positive) 짝은 저장됨");
  expect("investigating_confirmed_ok", "OK", "검토 중(investigating)에는 판정만 먼저 정할 수 있음");

  expect("bad_status", "23514", "처리 상태는 4가지 외의 값을 거부");
  expect("bad_verdict", "23514", "판정 결과는 3가지 외의 값을 거부");
  expect("bad_rule", "23514", "탐지 규칙 ID는 정해진 4가지 외의 값을 거부 (금액 이상 같은 범위 밖 규칙 차단)");
  expect("bad_source", "23514", "출처는 DEMO/PUBLIC만 허용");
  expect("blank_item_key", "23514", "물건 식별값이 비어 있으면 거부");
  expect("version_zero", "23514", "버전은 1 이상만 허용");
  expect("count_zero", "23514", "탐지 횟수는 1 이상만 허용");
  expect("last_before_first", "23514", "최근 탐지 시각이 최초 탐지 시각보다 빠르면 거부");
  expect("evidence_not_object", "23514", "탐지 근거가 객체가 아니면 거부");
  expect("evidence_too_big", "23514", "탐지 근거가 너무 크면(10,000바이트 초과) 거부");
  expect("blank_hash", "23514", "값 지문이 비어 있으면 거부");
  expect("missing_assignee", "23503", "존재하지 않는 담당자는 지정할 수 없음");

  expect("change_item_key", "23000", "저장된 이상징후의 물건 식별값은 바꿀 수 없음");
  expect("change_rule", "23000", "저장된 이상징후의 탐지 규칙은 바꿀 수 없음");
  expect("change_first_detected", "23000", "최초 탐지 시각은 바꿀 수 없음");
  expect("change_previous", "23000", "재발 연결은 나중에 바꿀 수 없음");

  expect("update_count_ok", "OK", "버전·탐지 횟수·최근 탐지 시각은 갱신할 수 있음");
  expect("update_to_investigating_ok", "OK", "미확인 → 검토 중으로 바꿀 수 있음");
  expect("update_to_resolved_undetermined", "23514", "미판정인 채로 조치 완료로 바꾸는 것은 거부");
  expect("update_to_resolved_ok", "OK", "실제 오류 확인(confirmed_issue)과 함께라면 조치 완료로 바꿀 수 있음");

  await expectEmpty(["anomalies"]);
}

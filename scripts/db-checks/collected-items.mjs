// collected_items(수집 데이터) 테이블이 DESIGN대로 만들어졌는지 확인한다 (PLAN 작업 8)
export const title = "수집 데이터 (collected_items)";

export async function run(ctx) {
  const { report, query, checkReadOnlyTable, rollbackProbe, expectUnchanged } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable(
    "collected_items",
    ["id", "run_id", "source", "item_key", "kind", "fields", "collected_at"],
    { run_id: 1, source: "DEMO", item_key: "DEMO-0001", kind: "list", fields: {} },
  );

  // 연결과 제약이 있는지
  const items = await query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.collected_items'::regclass`,
  );
  const defOf = (name) => items.find((c) => c.conname === name)?.def ?? "";
  report(
    /FOREIGN KEY \(run_id, source\) REFERENCES check_runs\(id, source\)/.test(defOf("collected_items_run_source_fkey")),
    "수집 데이터의 출처가 점검 실행의 출처와 항상 같도록 연결됨 (DEMO/PUBLIC 섞임 방지)",
  );
  report(
    /UNIQUE \(run_id, kind, item_key\)/.test(defOf("collected_items_run_kind_item_key")),
    "한 점검에서 같은 물건의 같은 종류(목록/상세)는 한 줄만 허용",
  );
  report(/demo_item_id/.test(defOf("collected_items_demo_fields_check")), "DEMO는 허용된 6개 필드 이름만 저장 가능 (개인정보 필드 차단)");

  const [runKey] = await query(
    `select 1 as ok from pg_constraint where conrelid = 'public.check_runs'::regclass and conname = 'check_runs_id_source_key'`,
  );
  report(Boolean(runKey), "check_runs: (id, source) 묶음 유일 제약 있음 (위 연결의 바탕)");

  // 동작 확인: 트랜잭션 안에서 넣어 보고 마지막에 전부 되돌린다 (저장되는 줄 없음)
  // 값은 'OK'(들어감) 또는 오류 코드(23514 규칙 위반, 23505 중복, 23503 연결 없음)로 돌아온다.
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const insert = (runVar, source, itemKey, kind, fields) =>
    `insert into public.collected_items (run_id, source, item_key, kind, fields) values (${runVar}, '${source}', '${itemKey}', '${kind}', ${fields})`;
  const good = `'{"demo_item_id":"DEMO-0001","item_name":"시험 물건","org_name":"시험 기관","bid_start_at":"2026-10-29T10:00:00+09:00","bid_end_at":"2026-10-30T10:00:00+09:00","item_status":"bidding"}'::jsonb`;

  const probe = await rollbackProbe(`
    runD bigint; runP bigint;
    begin
      insert into public.check_runs ("trigger", source, status, finished_at) values ('manual', 'DEMO', 'succeeded', now()) returning id into runD;
      insert into public.check_runs ("trigger", source, status, finished_at) values ('manual', 'PUBLIC', 'succeeded', now()) returning id into runP;
      ${t("demo_list_ok", insert("runD", "DEMO", "DEMO-0001", "list", good))}
      ${t("demo_detail_ok", insert("runD", "DEMO", "DEMO-0001", "detail", good))}
      ${t("duplicate_same_kind", insert("runD", "DEMO", "DEMO-0001", "list", good))}
      ${t("raw_missing_fields_ok", insert("runD", "DEMO", "DEMO-0002", "list", `'{"item_name":"이름만 있음"}'::jsonb`))}
      ${t("raw_null_value_ok", insert("runD", "DEMO", "DEMO-0003", "list", `'{"bid_end_at":null}'::jsonb`))}
      ${t("extra_field", insert("runD", "DEMO", "DEMO-0004", "list", `'{"item_name":"x","contact":"x"}'::jsonb`))}
      ${t("fields_not_object", insert("runD", "DEMO", "DEMO-0005", "list", `'[]'::jsonb`))}
      ${t("fields_too_big", insert("runD", "DEMO", "DEMO-0006", "list", `jsonb_build_object('item_name', repeat('x', 20000))`))}
      ${t("blank_item_key", insert("runD", "DEMO", "   ", "list", good))}
      ${t("bad_kind", insert("runD", "DEMO", "DEMO-0007", "summary", good))}
      ${t("bad_source", insert("runD", "TEST", "DEMO-0008", "list", good))}
      ${t("source_differs_from_run", insert("runD", "PUBLIC", "DEMO-0009", "list", `'{}'::jsonb`))}
      ${t("missing_run", insert("-1", "DEMO", "DEMO-0010", "list", good))}
      ${t("public_row_ok", insert("runP", "PUBLIC", "PUB-0001", "list", `'{}'::jsonb`))}
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);
  expect("demo_list_ok", "OK", "DEMO 목록 데이터는 저장됨");
  expect("demo_detail_ok", "OK", "같은 물건의 상세 데이터도 따로 저장됨");
  expect("duplicate_same_kind", "23505", "같은 점검·같은 물건·같은 종류의 두 번째 줄은 거부");
  expect("raw_missing_fields_ok", "OK", "필수 필드가 빠진 원본 이상 데이터도 저장됨 (탐지 규칙이 찾아야 하므로)");
  expect("raw_null_value_ok", "OK", "값이 비어(null) 있는 원본 이상 데이터도 저장됨");
  expect("extra_field", "23514", "DEMO에 허용 목록 밖의 필드(contact)가 있으면 거부 (PRD 7-2)");
  expect("fields_not_object", "23514", "필드 묶음이 객체가 아니면 거부");
  expect("fields_too_big", "23514", "너무 큰 데이터(10,000바이트 초과)는 거부");
  expect("blank_item_key", "23514", "물건 식별값이 비어 있으면 거부");
  expect("bad_kind", "23514", "종류는 list/detail만 허용");
  expect("bad_source", "23514", "출처는 DEMO/PUBLIC만 허용");
  expect("source_differs_from_run", "23503", "점검 실행은 DEMO인데 PUBLIC으로 저장하려 하면 거부 (출처 섞임 방지)");
  expect("missing_run", "23503", "없는 점검 실행에는 저장할 수 없음");
  expect("public_row_ok", "OK", "PUBLIC 점검의 PUBLIC 데이터는 저장됨 (허용 필드 목록은 부록 A 확정 후 추가)");

  await expectUnchanged(["collected_items", "check_runs"]);
}

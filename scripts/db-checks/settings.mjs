// settings(설정값) 테이블이 DESIGN·PRD 5-5대로 만들어졌는지 확인한다 (PLAN 작업 11)
export const title = "설정값 (settings)";

// PRD 5-5 기본값 (마이그레이션이 넣은 값과 같아야 한다)
const EXPECTED = {
  compare_window_minutes: 10,
  api_timeout_seconds: 10,
  api_call_limit_default: 20,
  api_call_limit_max: 100,
  public_daily_budget: null,
  run_time_limit_seconds: 60,
  reason_min_length: 10,
  schedule_missed_grace_minutes: 30,
  stale_running_seconds: 120,
  scheduled_source: "DEMO",
  required_fields: { DEMO: ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"] },
  compare_fields: { DEMO: ["item_name", "org_name", "bid_start_at", "bid_end_at"] },
  excluded_fields: { DEMO: ["item_status"] },
  empty_allowed_by_endpoint: { "demo-list": false, "demo-detail": false },
};

export async function run(ctx) {
  const { report, query, checkReadOnlyTable, rollbackProbe } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부 (settings는 id 칸이 없어 key로 읽기 시험)
  await checkReadOnlyTable(
    "settings",
    ["key", "value", "updated_at"],
    { key: "compare_window_minutes", value: 10 },
    { selectColumn: "key" },
  );

  // 기본값(PRD 5-5)이 그대로 들어 있는지
  const rows = await query("select key, value from public.settings order by key");
  const actual = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  report(rows.length === Object.keys(EXPECTED).length, `설정 항목 ${Object.keys(EXPECTED).length}개가 모두 있음`, `${rows.length}개`);
  const wrong = Object.entries(EXPECTED)
    .filter(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value))
    .map(([key]) => key);
  report(wrong.length === 0, "기본값이 PRD 5-5와 모두 같음", wrong.length ? `다른 항목: ${wrong.join(",")}` : "");
  report(actual.public_daily_budget === null, "PUBLIC 일일 호출 예산은 승인 트래픽 확인 전이라 비어 있음 (부록 A)");

  // 값 검사 함수는 로그인 사용자·비로그인이 API로 직접 부를 수 없고 서버 관리용 키만 쓸 수 있다
  const fnPriv = await query(
    `select r.rolname,
            has_function_privilege(r.rolname, 'public.settings_value_is_valid(text, jsonb)', 'execute') as can_run
     from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname`,
  );
  const canRun = Object.fromEntries(fnPriv.map((p) => [p.rolname, p.can_run]));
  report(canRun.anon === false && canRun.authenticated === false, "값 검사 함수는 비로그인·로그인 사용자가 직접 부를 수 없음");
  report(canRun.service_role === true, "값 검사 함수는 서버 관리용 키(service_role)가 쓸 수 있음 (설정값 저장에 필요)");

  const triggers = await query(
    `select tgname from pg_trigger where tgrelid = 'public.settings'::regclass and not tgisinternal`,
  );
  const names = triggers.map((t) => t.tgname);
  report(names.includes("settings_protect_update") && names.includes("settings_protect_delete") && names.includes("settings_protect_truncate"), "항목 이름 변경·삭제·비우기를 막는 장치 있음");
  report(names.includes("settings_set_updated_at"), "수정 시 updated_at 자동 갱신 장치 있음");

  // 동작 확인: 트랜잭션 안에서 바꿔 보고 마지막에 전부 되돌린다 (기본값은 그대로 남는다)
  // 결과는 'OK'(됨) 또는 오류 코드(23514 규칙 위반, 23505 중복, 23000 변경 금지, 42501 권한 없음)
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  // 다른 권한(role)으로 바꿔서 실행해 본다. 실패하면 역할도 함께 원래대로 돌아온다.
  const asRole = (role, key, stmt) =>
    `begin set local role ${role}; ${stmt}; reset role; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const asRoleValue = (role, key, expr) =>
    `begin set local role ${role}; r := r || jsonb_build_object('${key}', ${expr}); reset role; exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const upd = (key, expr) => `update public.settings set value = ${expr} where key = '${key}'`;
  const j = (literal) => `'${literal}'::jsonb`;

  const probe = await rollbackProbe(`
    begin
      ${t("int_ok", upd("compare_window_minutes", j("15")))}
      r := r || jsonb_build_object('updated_at_bumped', (select updated_at = now() from public.settings where key = 'compare_window_minutes'));

      -- 숫자 범위
      ${t("window_zero", upd("compare_window_minutes", j("0")))}
      ${t("window_61", upd("compare_window_minutes", j("61")))}
      ${t("window_text", upd("compare_window_minutes", j('"ten"')))}
      ${t("window_decimal", upd("compare_window_minutes", j("10.5")))}
      ${t("window_negative", upd("compare_window_minutes", j("-5")))}
      ${t("window_null", upd("compare_window_minutes", j("null")))}
      ${t("timeout_61", upd("api_timeout_seconds", j("61")))}
      ${t("limit_default_101", upd("api_call_limit_default", j("101")))}
      ${t("limit_max_0", upd("api_call_limit_max", j("0")))}
      ${t("limit_max_100_ok", upd("api_call_limit_max", j("100")))}
      ${t("run_limit_9", upd("run_time_limit_seconds", j("9")))}
      ${t("run_limit_301", upd("run_time_limit_seconds", j("301")))}
      ${t("grace_0", upd("schedule_missed_grace_minutes", j("0")))}
      ${t("stale_59", upd("stale_running_seconds", j("59")))}
      ${t("reason_9", upd("reason_min_length", j("9")))}
      ${t("reason_15_ok", upd("reason_min_length", j("15")))}

      -- 일일 호출 예산: 비움(null) 또는 1 이상의 정수
      ${t("budget_null_ok", upd("public_daily_budget", j("null")))}
      ${t("budget_5000_ok", upd("public_daily_budget", j("5000")))}
      ${t("budget_0", upd("public_daily_budget", j("0")))}
      ${t("budget_text", upd("public_daily_budget", j('"many"')))}

      -- 출처
      ${t("source_public_ok", upd("scheduled_source", j('"PUBLIC"')))}
      ${t("source_test", upd("scheduled_source", j('"TEST"')))}
      ${t("source_number", upd("scheduled_source", j("1")))}

      -- 필드 이름 목록
      ${t("fields_ok", upd("required_fields", j('{"DEMO": ["a", "b_1"]}')))}
      ${t("fields_empty_list_ok", upd("excluded_fields", j('{"DEMO": []}')))}
      ${t("fields_bad_source", upd("required_fields", j('{"TEST": ["a"]}')))}
      ${t("fields_not_list", upd("required_fields", j('{"DEMO": "a"}')))}
      ${t("fields_upper_case", upd("required_fields", j('{"DEMO": ["Name"]}')))}
      ${t("fields_number_item", upd("compare_fields", j('{"DEMO": [1]}')))}
      ${t("fields_not_object", upd("compare_fields", j('["a"]')))}
      ${t("fields_too_many", upd("compare_fields", `jsonb_build_object('DEMO', (select jsonb_agg('f' || i) from generate_series(1, 31) as g(i)))`))}

      -- 빈 결과 허용 여부
      ${t("empty_ok", upd("empty_allowed_by_endpoint", j('{"demo-list": true}')))}
      ${t("empty_not_boolean", upd("empty_allowed_by_endpoint", j('{"demo-list": "yes"}')))}
      ${t("empty_bad_name", upd("empty_allowed_by_endpoint", j('{"bad name": true}')))}

      -- 항목 자체는 늘리거나 줄일 수 없다
      ${t("unknown_key", `insert into public.settings (key, value) values ('price_threshold', '1'::jsonb)`)}
      ${t("duplicate_key", `insert into public.settings (key, value) values ('compare_window_minutes', '5'::jsonb)`)}
      ${t("rename_key", `update public.settings set key = 'api_timeout_seconds' where key = 'compare_window_minutes'`)}
      ${t("delete_key", `delete from public.settings where key = 'compare_window_minutes'`)}
      ${t("truncate_table", `truncate table public.settings`)}

      -- 누가 무엇을 할 수 있는지
      ${asRoleValue("authenticated", "auth_read_count", "(select count(*) from public.settings)")}
      ${asRole("authenticated", "auth_update", upd("compare_window_minutes", j("20")))}
      ${asRole("authenticated", "auth_insert", `insert into public.settings (key, value) values ('compare_window_minutes', '5'::jsonb)`)}
      ${asRole("anon", "anon_read", "perform 1 from public.settings limit 1")}
      ${asRole("service_role", "service_update_ok", upd("api_timeout_seconds", j("20")))}
      ${asRole("service_role", "service_update_invalid", upd("api_timeout_seconds", j("99")))}
      ${asRole("service_role", "service_delete", `delete from public.settings where key = 'api_timeout_seconds'`)}
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);
  expect("int_ok", "OK", "범위 안의 값(15분)으로 바꿀 수 있음");
  report(probe.updated_at_bumped === true, "값을 바꾸면 updated_at이 자동으로 갱신됨", `결과 ${probe.updated_at_bumped}`);

  expect("window_zero", "23514", "허용 차이가 0이면 거부");
  expect("window_61", "23514", "허용 차이가 60분을 넘으면 거부");
  expect("window_text", "23514", "숫자 항목에 글자를 넣으면 거부");
  expect("window_decimal", "23514", "소수(10.5)는 거부");
  expect("window_negative", "23514", "음수는 거부");
  expect("window_null", "23514", "비울 수 없는 항목을 null로 바꾸면 거부");
  expect("timeout_61", "23514", "타임아웃이 60초를 넘으면 거부");
  expect("limit_default_101", "23514", "호출 기본 상한이 100회를 넘으면 거부");
  expect("limit_max_0", "23514", "호출 최대 상한이 0이면 거부");
  expect("limit_max_100_ok", "OK", "호출 최대 상한 100회는 허용 (PRD 5-5의 한계값)");
  expect("run_limit_9", "23514", "실행시간 제한이 10초 미만이면 거부");
  expect("run_limit_301", "23514", "실행시간 제한이 300초를 넘으면 거부");
  expect("grace_0", "23514", "예약 누락 판단 대기시간이 0분이면 거부");
  expect("stale_59", "23514", "멈춘 실행 정리 기준이 60초 미만이면 거부");
  expect("reason_9", "23514", "사유 최소 글자 수를 9 이하로 내리는 것은 거부 (이력 테이블이 10자 미만을 항상 거부하므로)");
  expect("reason_15_ok", "OK", "사유 최소 글자 수를 15로 올리는 것은 허용");

  expect("budget_null_ok", "OK", "일일 호출 예산은 비워 둘 수 있음 (승인 트래픽 확인 전)");
  expect("budget_5000_ok", "OK", "일일 호출 예산에 양의 정수를 넣을 수 있음");
  expect("budget_0", "23514", "일일 호출 예산이 0이면 거부");
  expect("budget_text", "23514", "일일 호출 예산에 글자를 넣으면 거부");

  expect("source_public_ok", "OK", "예약 점검 출처를 PUBLIC으로 바꿀 수 있음 (PUBLIC 조회기 완료 후 사용)");
  expect("source_test", "23514", "예약 점검 출처는 DEMO/PUBLIC만 허용");
  expect("source_number", "23514", "예약 점검 출처에 숫자를 넣으면 거부");

  expect("fields_ok", "OK", "필드 이름 목록(영문 소문자·숫자·밑줄)은 저장됨");
  expect("fields_empty_list_ok", "OK", "비교 제외 필드 목록은 비어 있어도 됨");
  expect("fields_bad_source", "23514", "필드 목록의 출처는 DEMO/PUBLIC만 허용");
  expect("fields_not_list", "23514", "필드 목록이 목록(배열)이 아니면 거부");
  expect("fields_upper_case", "23514", "대문자가 섞인 필드 이름은 거부");
  expect("fields_number_item", "23514", "필드 이름이 글자가 아니면 거부");
  expect("fields_not_object", "23514", "출처별 묶음이 아니면 거부");
  expect("fields_too_many", "23514", "필드가 31개를 넘으면 거부");

  expect("empty_ok", "OK", "API별 빈 결과 허용 여부(true/false)는 저장됨");
  expect("empty_not_boolean", "23514", "빈 결과 허용 여부가 true/false가 아니면 거부");
  expect("empty_bad_name", "23514", "API 이름에 공백이 있으면 거부");

  expect("unknown_key", "23514", "정해진 14개 밖의 새 항목은 만들 수 없음");
  expect("duplicate_key", "23505", "같은 항목을 두 번 만들 수 없음");
  expect("rename_key", "23000", "항목 이름은 바꿀 수 없음");
  expect("delete_key", "23000", "항목은 삭제할 수 없음");
  expect("truncate_table", "23000", "설정값 표를 비울 수 없음");

  report(probe.auth_read_count === 14, "로그인 사용자는 설정값 14개를 모두 읽을 수 있음", `결과 ${probe.auth_read_count}`);
  expect("auth_update", "42501", "로그인 사용자는 설정값을 바꿀 수 없음");
  expect("auth_insert", "42501", "로그인 사용자는 설정 항목을 만들 수 없음");
  expect("anon_read", "42501", "비로그인 사용자는 설정값을 읽을 수 없음");
  expect("service_update_ok", "OK", "서버 관리용 키는 범위 안의 값으로 바꿀 수 있음");
  expect("service_update_invalid", "23514", "서버 관리용 키로도 범위 밖의 값은 거부");
  expect("service_delete", "23000", "서버 관리용 키로도 항목은 삭제할 수 없음");

  // 시험 후에도 기본값이 그대로인지 (되돌림 확인)
  const after = await query("select key, value from public.settings");
  const afterMap = Object.fromEntries(after.map((r) => [r.key, r.value]));
  const changed = Object.entries(EXPECTED).filter(([key, value]) => JSON.stringify(afterMap[key]) !== JSON.stringify(value));
  report(changed.length === 0 && after.length === 14, "시험 후에도 기본값 14개가 그대로임 (모두 되돌려짐)");
}

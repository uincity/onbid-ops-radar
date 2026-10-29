// reports(일일 점검보고서 스냅샷) 테이블이 DESIGN·PRD대로 만들어졌는지 확인한다 (PLAN 작업 11)
import { randomUUID } from "node:crypto";

export const title = "보고서 스냅샷 (reports)";

export async function run(ctx) {
  const { report, query, rest, checkReadOnlyTable, rollbackProbe, expectEmpty, keys } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable(
    "reports",
    ["id", "report_date", "source", "generated_by", "generated_at", "covers_until", "content_md", "summary"],
    {
      report_date: "2026-10-29",
      source: "DEMO",
      generated_by: randomUUID(),
      covers_until: "2026-10-29T10:00:00+09:00",
      content_md: "# 시험",
    },
  );

  // 연결과 장치가 있는지
  const cons = await query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.reports'::regclass`,
  );
  report(/FOREIGN KEY \(generated_by\) REFERENCES profiles\(id\)/.test(cons.map((c) => c.def).join(" | ")), "generated_by → profiles 연결됨 (만든 사람이 기록됨)");

  const triggers = await query(`select tgname from pg_trigger where tgrelid = 'public.reports'::regclass and not tgisinternal`);
  const names = triggers.map((t) => t.tgname);
  report(names.includes("reports_check_generator"), "팀장(admin)만 만들 수 있도록 확인하는 장치 있음 (SEC-03)");
  report(names.includes("reports_no_update_delete") && names.includes("reports_no_truncate"), "수정·삭제·비우기를 막는 장치 있음 (SEC-05)");

  // 서버 관리용 키(service_role)는 읽기와 추가만 가능해야 한다 (수정·삭제 권한 없음)
  const grants = await query(
    `select privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'reports' and grantee = 'service_role' order by privilege_type`,
  );
  const privs = grants.map((g) => g.privilege_type);
  report(privs.join(",") === "INSERT,SELECT", "서버 관리용 키(service_role)는 읽기·추가만 가능", `권한: ${privs.join(",") || "없음"}`);

  // 관리용 키로 수정·삭제를 직접 시도해도 권한이 없어 거부된다 (저장되는 줄 없음)
  const deniedUpdate = await rest("reports", "PATCH", keys.secret, { content_md: "조작" }, "?id=eq.1");
  report([401, 403].includes(deniedUpdate.status) && deniedUpdate.code === "42501", "관리용 키로 보고서 수정 시도 → 거부", `응답 ${deniedUpdate.status}, 오류 ${deniedUpdate.code}`);
  const deniedDelete = await rest("reports", "DELETE", keys.secret, undefined, "?id=eq.1");
  report([401, 403].includes(deniedDelete.status) && deniedDelete.code === "42501", "관리용 키로 보고서 삭제 시도 → 거부", `응답 ${deniedDelete.status}, 오류 ${deniedDelete.code}`);

  // 동작 확인: 트랜잭션 안에서 넣어 보고 마지막에 전부 되돌린다 (저장되는 줄 없음)
  // 시험용 사용자(팀장·운영 담당자)도 같은 트랜잭션 안에서만 만들어지고 함께 되돌려진다.
  // 결과는 'OK'(됨) 또는 오류 코드(23514 규칙 위반, 23000 변경 금지, 23503 연결 없음, 42501 권한 없음)
  const t = (key, stmt) =>
    `begin ${stmt}; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const asRole = (role, key, stmt) =>
    `begin set local role ${role}; ${stmt}; reset role; r := r || jsonb_build_object('${key}', 'OK'); exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const asRoleValue = (role, key, expr) =>
    `begin set local role ${role}; r := r || jsonb_build_object('${key}', ${expr}); reset role; exception when others then r := r || jsonb_build_object('${key}', sqlstate); end;`;
  const rep = ({ d = "td", src = "'DEMO'", by = "p2", cov = "now()", content = "'# 일일 점검보고서'", summary = "'{}'::jsonb" } = {}) =>
    `insert into public.reports (report_date, source, generated_by, covers_until, content_md, summary)
     values (${d}, ${src}, ${by}, ${cov}, ${content}, ${summary})`;
  const dayStart = (dateExpr) => `((${dateExpr})::timestamp at time zone 'Asia/Seoul')`;

  const probe = await rollbackProbe(`
    td date := (now() at time zone 'Asia/Seoul')::date;
    p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
    begin
      set local session_replication_role = 'replica';
      insert into public.profiles (id, display_name, role) values (p1, '시험 담당', 'operator'), (p2, '시험 팀장', 'admin');
      set local session_replication_role = 'origin';

      -- 정상 저장
      ${t("today_ok", rep())}
      ${t("today_twice_ok", rep())}
      ${t("past_full_day_ok", rep({ d: "td - 1", cov: dayStart("td") }))}
      ${t("past_partial_ok", rep({ d: "td - 1", cov: `${dayStart("td - 1")} + interval '10 hours'` }))}
      ${t("public_ok", rep({ src: "'PUBLIC'" }))}
      ${t("masked_key_ok", rep({ content: "'참고 https://x.example/a?serviceKey=****'" }))}
      r := r || jsonb_build_object('rows_after_ok', (select count(*) from public.reports));

      -- 날짜·집계 시각
      ${t("future_date", rep({ d: "td + 1" }))}
      ${t("covers_before_day", rep({ cov: `${dayStart("td")} - interval '1 second'` }))}
      ${t("covers_after_day", rep({ d: "td - 1", cov: `${dayStart("td")} + interval '1 second'` }))}
      ${t("covers_in_future", rep({ cov: "now() + interval '1 hour'" }))}

      -- 값 검사
      ${t("bad_source", rep({ src: "'TEST'" }))}
      ${t("blank_content", rep({ content: "'   '" }))}
      ${t("content_too_big", rep({ content: "repeat('x', 500001)" }))}
      ${t("content_with_key", rep({ content: "'참고 https://x.example/a?serviceKey=abc123'" }))}
      ${t("summary_array", rep({ summary: "'[]'::jsonb" }))}
      ${t("summary_too_big", rep({ summary: "jsonb_build_object('n', repeat('x', 30000))" }))}

      -- 팀장만 만들 수 있다 (SEC-03)
      ${t("operator_generated", rep({ by: "p1" }))}
      ${t("unknown_generated", rep({ by: "gen_random_uuid()" }))}

      -- 수정·삭제·비우기는 소유자 권한으로도 막힌다 (SEC-05)
      ${t("update_blocked", `update public.reports set content_md = '조작'`)}
      ${t("delete_blocked", `delete from public.reports`)}
      ${t("truncate_blocked", `truncate table public.reports`)}
      ${t("delete_generator_blocked", `delete from public.profiles where id = p2`)}

      -- 누가 무엇을 할 수 있는지
      ${asRole("service_role", "service_insert_ok", rep())}
      ${asRole("service_role", "service_insert_operator", rep({ by: "p1" }))}
      ${asRole("service_role", "service_update", `update public.reports set content_md = '조작'`)}
      ${asRole("service_role", "service_delete", `delete from public.reports`)}
      ${asRole("service_role", "service_truncate", `truncate table public.reports`)}
      ${asRole("authenticated", "auth_insert", rep())}
      ${asRole("authenticated", "auth_update", `update public.reports set content_md = '조작'`)}
      ${asRoleValue("authenticated", "auth_read_ok", "(select count(*) >= 1 from public.reports)")}
      ${asRole("anon", "anon_read", "perform 1 from public.reports limit 1")}
  `);

  const expect = (key, want, label) => report(probe[key] === want, label, `결과 ${probe[key]}`);
  expect("today_ok", "OK", "오늘 보고서(생성 시각까지 집계)는 저장됨");
  expect("today_twice_ok", "OK", "같은 날 두 번째 보고서도 따로 저장됨 (모두 남음, PRD 5-4 규칙 5)");
  expect("past_full_day_ok", "OK", "지난 날짜 보고서(그날 끝까지 집계)는 저장됨");
  expect("past_partial_ok", "OK", "지난 날짜의 중간 시각까지 집계한 보고서도 저장됨");
  expect("public_ok", "OK", "PUBLIC 출처 보고서는 출처별로 따로 저장됨");
  expect("masked_key_ok", "OK", "인증키를 ****로 가린 내용은 저장됨");
  report(probe.rows_after_ok === 6, "위 정상 저장 6건이 모두 쌓임", `결과 ${probe.rows_after_ok}건`);

  expect("future_date", "23514", "아직 오지 않은 날짜의 보고서는 거부");
  expect("covers_before_day", "23514", "집계 시각이 그 날짜보다 이전이면 거부");
  expect("covers_after_day", "23514", "지난 날짜 보고서가 그날을 넘겨 집계하면 거부");
  expect("covers_in_future", "23514", "집계 시각이 생성 시각보다 미래이면 거부");

  expect("bad_source", "23514", "출처는 DEMO/PUBLIC만 허용");
  expect("blank_content", "23514", "내용이 비어 있으면 거부");
  expect("content_too_big", "23514", "내용이 너무 크면(500,000자 초과) 거부");
  expect("content_with_key", "23514", "내용에 인증키(serviceKey=값)가 있으면 거부 (PRD 7-3 규칙 7)");
  expect("summary_array", "23514", "숫자 요약이 객체가 아니면 거부");
  expect("summary_too_big", "23514", "숫자 요약이 너무 크면(20,000바이트 초과) 거부");

  expect("operator_generated", "42501", "운영 담당자(operator)가 만든 보고서는 거부 (팀장만 가능, SEC-03)");
  expect("unknown_generated", "42501", "존재하지 않는 사용자가 만든 보고서는 거부");

  expect("update_blocked", "23000", "저장된 보고서는 수정할 수 없음 (소유자 권한으로도)");
  expect("delete_blocked", "23000", "저장된 보고서는 삭제할 수 없음");
  expect("truncate_blocked", "23000", "보고서 전체 비우기는 할 수 없음");
  expect("delete_generator_blocked", "23503", "보고서를 만든 사용자는 지울 수 없음");

  expect("service_insert_ok", "OK", "서버 관리용 키는 팀장 명의의 보고서를 추가할 수 있음");
  expect("service_insert_operator", "42501", "서버 관리용 키로도 운영 담당자 명의의 보고서는 추가할 수 없음");
  expect("service_update", "42501", "서버 관리용 키는 보고서를 수정할 수 없음 (권한 없음)");
  expect("service_delete", "42501", "서버 관리용 키는 보고서를 삭제할 수 없음 (권한 없음)");
  expect("service_truncate", "42501", "서버 관리용 키는 보고서를 비울 수 없음 (권한 없음)");
  expect("auth_insert", "42501", "로그인 사용자가 직접 보고서를 만들 수는 없음 (서버가 팀장 확인 후에만 추가)");
  expect("auth_update", "42501", "로그인 사용자는 보고서를 수정할 수 없음");
  report(probe.auth_read_ok === true, "로그인 사용자는 보고서를 읽을 수 있음", `결과 ${probe.auth_read_ok}`);
  expect("anon_read", "42501", "비로그인 사용자는 보고서를 읽을 수 없음");

  await expectEmpty(["reports", "profiles"]);
}

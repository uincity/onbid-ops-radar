// profiles 테이블이 DESIGN대로 만들어졌는지 확인한다 (PLAN 작업 6)
import { randomUUID } from "node:crypto";

export const title = "profiles (사용자 역할)";

export async function run(ctx) {
  const { report, query, rest, checkReadOnlyTable, expectUnchanged, keys } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부
  await checkReadOnlyTable("profiles", ["id", "display_name", "role", "created_at", "updated_at"], {
    id: randomUUID(),
    display_name: "시험",
    role: "admin",
  });

  // profiles만의 구조
  const columns = await query(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'`,
  );
  const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));
  report(byName.id?.data_type === "uuid", "profiles.id: uuid");
  report(byName.display_name?.is_nullable === "NO", "profiles.display_name: 필수");
  report(
    byName.role?.is_nullable === "NO" && String(byName.role.column_default).includes("operator"),
    "profiles.role: 필수, 기본값 operator",
  );

  const constraints = await query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.profiles'::regclass`,
  );
  const defs = constraints.map((c) => c.def).join(" | ");
  report(/operator/.test(defs) && /admin/.test(defs), "profiles.role은 operator/admin만 허용");
  report(/FOREIGN KEY \(id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(defs), "profiles.id가 로그인 계정(auth.users)과 연결됨");

  const [trigger] = await query(
    `select 1 as ok from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_set_updated_at'`,
  );
  report(Boolean(trigger), "profiles: 수정 시 updated_at 자동 갱신 장치 있음");

  // 관리용 키로도 규칙을 어기는 줄은 들어가지 않는다 (거부되는지만 확인, 저장되는 줄 없음)
  const badRole = await rest("profiles", "POST", keys.secret, { id: randomUUID(), display_name: "시험", role: "superuser" });
  report(badRole.code === "23514", "profiles: 잘못된 역할('superuser')은 관리용 키로도 거부", `오류 ${badRole.code}`);

  const badName = await rest("profiles", "POST", keys.secret, { id: randomUUID(), display_name: "   ", role: "operator" });
  report(badName.code === "23514", "profiles: 빈 이름은 관리용 키로도 거부", `오류 ${badName.code}`);

  const noAccount = await rest("profiles", "POST", keys.secret, { id: randomUUID(), display_name: "시험", role: "operator" });
  report(noAccount.code === "23503", "profiles: 존재하지 않는 로그인 계정에는 줄을 만들 수 없음", `오류 ${noAccount.code}`);

  await expectUnchanged(["profiles"]);
}

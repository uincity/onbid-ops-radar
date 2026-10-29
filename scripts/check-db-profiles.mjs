// profiles 테이블이 DESIGN대로 만들어졌는지 확인하는 스크립트 (PLAN 작업 6)
// 실행: npm run check:db
// - 구조 확인은 읽기 전용 조회만 한다.
// - 동작 확인은 "일부러 틀린 값을 넣어 보고 거부되는지" 보는 방식이라, 실제로 저장되는 줄은 없다.
// 비밀 값은 출력하지 않는다.
import { randomUUID } from "node:crypto";

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;

let failed = 0;
function report(ok, label, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
}

if (![ref, token, url, publishable, secret].every(Boolean)) {
  console.error("실패: 환경변수가 부족합니다. npm run check:env를 먼저 실행해 주세요.");
  process.exit(1);
}

// 읽기 전용 SQL 조회 (Supabase 관리 API)
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`조회 실패 (응답 ${res.status})`);
  return res.json();
}

// 데이터 API 요청: 응답 상태와 오류 코드만 돌려준다
async function rest(method, key, body) {
  const res = await fetch(`${url}/rest/v1/profiles${method === "GET" ? "?select=id&limit=1" : ""}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  let code = "";
  try {
    code = (await res.json())?.code ?? "";
  } catch {
    // 본문이 비어 있으면 코드 없음
  }
  return { status: res.status, code };
}

// ---------------------------------------------------------------- 구조 확인
const [table] = await query(
  `select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles' and c.relkind = 'r'`,
);
report(Boolean(table), "public.profiles 테이블 있음");

if (table) {
  report(table.rls === true, "RLS(출입 규칙) 켜짐");

  const columns = await query(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' order by ordinal_position`,
  );
  const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]));
  report(byName.id?.data_type === "uuid", "id: uuid");
  report(byName.display_name?.data_type === "text" && byName.display_name.is_nullable === "NO", "display_name: 글자, 필수");
  report(
    byName.role?.data_type === "text" && byName.role.is_nullable === "NO" && String(byName.role.column_default).includes("operator"),
    "role: 글자, 필수, 기본값 operator",
  );
  report(Boolean(byName.created_at) && Boolean(byName.updated_at), "created_at, updated_at 있음");

  const constraints = await query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.profiles'::regclass`,
  );
  const defs = constraints.map((c) => c.def).join(" | ");
  report(/operator/.test(defs) && /admin/.test(defs), "role은 operator/admin만 허용");
  report(/FOREIGN KEY \(id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(defs), "id가 로그인 계정(auth.users)과 연결됨");

  const policies = await query(
    `select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'profiles'`,
  );
  report(
    policies.length === 1 && policies[0].cmd === "SELECT" && String(policies[0].roles).includes("authenticated"),
    "정책은 '로그인 사용자 읽기' 하나뿐 (쓰기 정책 없음)",
    `정책 ${policies.length}개`,
  );

  const grants = await query(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')`,
  );
  const anon = grants.filter((g) => g.grantee === "anon");
  const auth = grants.filter((g) => g.grantee === "authenticated").map((g) => g.privilege_type);
  report(anon.length === 0, "비로그인(anon)은 아무 권한 없음");
  report(auth.length === 1 && auth[0] === "SELECT", "로그인 사용자는 읽기(SELECT)만 가능", `권한: ${auth.join(",") || "없음"}`);

  const [trigger] = await query(
    `select 1 as ok from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_set_updated_at'`,
  );
  report(Boolean(trigger), "수정 시 updated_at 자동 갱신 장치 있음");
}

// ---------------------------------------------------------------- 동작 확인 (저장되는 줄 없음)
const anonRead = await rest("GET", publishable);
report([401, 403].includes(anonRead.status), "로그인 없이 읽기 시도 → 거부", `응답 ${anonRead.status}`);

const anonWrite = await rest("POST", publishable, { id: randomUUID(), display_name: "시험", role: "admin" });
report([401, 403].includes(anonWrite.status), "로그인 없이 admin 줄 만들기 시도 → 거부", `응답 ${anonWrite.status}`);

const badRole = await rest("POST", secret, { id: randomUUID(), display_name: "시험", role: "superuser" });
report(badRole.code === "23514", "관리용 키로도 잘못된 역할('superuser')은 거부", `오류 ${badRole.code}`);

const badName = await rest("POST", secret, { id: randomUUID(), display_name: "   ", role: "operator" });
report(badName.code === "23514", "관리용 키로도 빈 이름은 거부", `오류 ${badName.code}`);

const noAccount = await rest("POST", secret, { id: randomUUID(), display_name: "시험", role: "operator" });
report(noAccount.code === "23503", "존재하지 않는 로그인 계정에는 줄을 만들 수 없음", `오류 ${noAccount.code}`);

const [{ count }] = await query("select count(*)::int as count from public.profiles");
report(count === 0, "시험 후에도 profiles는 비어 있음 (저장된 줄 없음)", `${count}줄`);

console.log(failed === 0 ? "\nprofiles 테이블 확인 완료" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

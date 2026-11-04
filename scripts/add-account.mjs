// 실제 사용자 계정을 추가하고 "비밀번호 설정 링크"를 만들어 주는 스크립트 (시연 계정 대신 실명 계정으로 운영하기 위한 서버 관리 절차)
// 실행: npm run add:account -- --email 주소 --name 이름 --role admin|operator
//       npm run add:account -- --email 주소 --link-only   → 이미 있는 계정의 새 비밀번호 설정 링크만 다시 만든다 (비밀번호를 잊었을 때)
//
// PRD 4-4의 "서버의 승인된 관리 절차"이다. 화면에는 계정을 만드는 기능이 없다.
//   - 계정은 Supabase Auth 관리 기능(서버 전용 키 SUPABASE_SECRET_KEY)으로 만들고, 역할(admin/operator)은 profiles에 넣는다.
//   - 비밀번호는 만들지도, 알지도 않는다. 계정을 만들 때는 아무도 모르는 무작위 값을 넣고, 본인이 링크로 들어와 직접 정한다.
//   - 링크는 한 번만 쓸 수 있고 일정 시간(Supabase 설정, 기본 1시간) 뒤 만료된다. 링크는 이 터미널에만 출력한다 (채팅·로그·파일에 남기지 않는다).
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SITE = "https://onbid-ops-radar.vercel.app";
const ROLES = ["admin", "operator"];

function fail(message) {
  console.error(`실패: ${message}`);
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const linkOnly = process.argv.includes("--link-only");
const email = arg("email")?.trim().toLowerCase();
const displayName = arg("name")?.trim();
const role = arg("role")?.trim();
const site = (arg("site") ?? DEFAULT_SITE).trim().replace(/\/+$/, "");

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail("--email에 올바른 이메일 주소를 넣어 주세요.");
if (!/^https?:\/\/[^\s/]+$/.test(site)) fail("--site는 https://주소 형태여야 합니다. (끝에 경로 없음)");
if (!linkOnly) {
  if (!displayName || displayName.length > 50) fail("--name에 표시할 이름을 50자 이내로 넣어 주세요.");
  if (!ROLES.includes(role ?? "")) fail("--role은 admin(팀장) 또는 operator(운영 담당자)여야 합니다.");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail(".env에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY가 없습니다. (npm run setup:env)");

// 서버 관리용 연결: 로그인 세션을 저장하거나 갱신하지 않는다.
const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserByEmail(target) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`계정 목록을 가져오지 못했습니다. (${error.message})`);
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

let user = await findUserByEmail(email);
let state;

if (linkOnly) {
  if (!user) fail("그 이메일의 계정이 없습니다. --link-only 없이 --name, --role을 넣어 새로 만들어 주세요.");
  state = "이미 있는 계정 (링크만 새로 만듦)";
} else if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: randomBytes(32).toString("base64url"), // 아무도 모르는 값. 본인이 링크로 들어와 새로 정한다
    email_confirm: true,
  });
  if (error || !data.user) fail(`계정을 만들지 못했습니다. (${error?.message ?? "알 수 없는 오류"})`);
  user = data.user;
  state = "새로 만듦";
} else {
  state = "이미 있는 계정 (이름·역할을 입력한 값으로 맞춤)";
}

if (!linkOnly) {
  // 역할 부여: profiles에 이름과 역할을 넣는다 (이 관리 절차로만 가능, SEC-07)
  const { error } = await supabase.from("profiles").upsert({ id: user.id, display_name: displayName, role }, { onConflict: "id" });
  if (error) fail(`프로필(이름·역할)을 저장하지 못했습니다. (${error.message})`);
}

const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "recovery", email });
const tokenHash = link?.properties?.hashed_token;
if (linkError || !tokenHash) fail(`비밀번호 설정 링크를 만들지 못했습니다. (${linkError?.message ?? "알 수 없는 오류"})`);

console.log(`계정: ${email} — ${state}`);
if (!linkOnly) console.log(`이름: ${displayName} / 역할: ${role === "admin" ? "팀장" : "운영 담당자"}`);
console.log("\n아래 링크를 본인에게 전달해 주세요. 한 번만 쓸 수 있고 일정 시간 뒤 만료됩니다. (이 링크를 채팅·문서에 남기지 마세요)\n");
console.log(`${site}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);
console.log("\n만료되거나 잃어버렸으면: npm run add:account -- --email 주소 --link-only");

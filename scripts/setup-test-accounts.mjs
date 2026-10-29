// 시연·테스트용 로그인 계정 2개(팀장, 운영 담당자)를 만들고 역할을 부여하는 스크립트 (PLAN 작업 13)
// 실행: npm run setup:accounts
//       npm run setup:accounts -- --reset-passwords   → 두 계정의 비밀번호를 새로 만들어 .env에 다시 저장
//
// 이 스크립트가 PRD 4-4의 "서버의 승인된 관리 절차"이다.
//   - Supabase Auth 관리 기능(서버 전용 키 SUPABASE_SECRET_KEY)으로 계정을 만든다. (화면에는 회원가입이 없다)
//   - 역할(admin/operator)은 이 절차로만 profiles에 넣는다. 사용자 본인은 자기 역할을 바꿀 수 없다. (SEC-07)
//   - 이메일·이름은 가상이다. 실제 개인정보를 쓰지 않는다. (PRD 7-2) 테스트 계정은 가상(DEMO) 데이터만 다룬다.
//   - 비밀번호는 무작위로 만들어 .env에만 저장하고, 화면·로그·소스코드에 절대 출력하지 않는다. (CLAUDE.md)
// 여러 번 실행해도 안전하다: 이미 있는 계정은 새로 만들지 않고, 비밀번호가 .env에 있으면 그대로 둔다.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { upsertEnvValues } from "./lib/env-file.mjs";

const resetPasswords = process.argv.includes("--reset-passwords");

// 가상 이메일은 예약 도메인(example.com)만 허용한다. 다른 도메인이면 실제 사람의 계정을 건드릴 수 있어 거부한다.
const ALLOWED_EMAIL_DOMAIN = "@example.com";

const ACCOUNTS = [
  { label: "팀장", role: "admin", displayName: "시연 팀장", emailVar: "DEMO_ADMIN_EMAIL", passwordVar: "DEMO_ADMIN_PASSWORD", defaultEmail: "admin-demo@example.com" },
  { label: "운영 담당자", role: "operator", displayName: "시연 담당자", emailVar: "DEMO_OPERATOR_EMAIL", passwordVar: "DEMO_OPERATOR_PASSWORD", defaultEmail: "operator-demo@example.com" },
];

function fail(message) {
  console.error(`실패: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail(".env에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY가 없습니다. (npm run setup:env)");

// 서버 관리용 연결: 로그인 세션을 저장하거나 갱신하지 않는다.
const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

const newPassword = () => randomBytes(18).toString("base64url"); // 24자, 무작위

// 이메일로 기존 계정 찾기 (계정이 몇 개 안 되므로 목록에서 찾는다)
async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`계정 목록을 가져오지 못했습니다. (${error.message})`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

const envUpdates = []; // .env에 쓸 값 (이메일·비밀번호)
const summary = [];

for (const account of ACCOUNTS) {
  const email = (process.env[account.emailVar] || account.defaultEmail).trim().toLowerCase();
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    fail(`${account.emailVar}는 가상 이메일(${ALLOWED_EMAIL_DOMAIN})이어야 합니다. 실제 사람의 이메일은 쓸 수 없습니다.`);
  }

  let password = process.env[account.passwordVar]?.trim() || "";
  let user = await findUserByEmail(email);
  let accountState;
  let passwordState;

  if (!user) {
    if (!password || resetPasswords) password = newPassword();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 가상 이메일이라 확인 메일을 보내지 않고 바로 사용할 수 있게 한다
      user_metadata: { demo: true },
    });
    if (error || !data.user) fail(`${account.label} 계정을 만들지 못했습니다. (${error?.message ?? "알 수 없는 오류"})`);
    user = data.user;
    accountState = "새로 만듦";
    passwordState = "새로 만들어 .env에 저장";
  } else {
    accountState = "이미 있음";
    if (!password || resetPasswords) {
      // 계정은 있는데 비밀번호를 모르는 경우(.env에 없음) 또는 다시 만들라고 한 경우
      password = newPassword();
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (error) fail(`${account.label} 비밀번호를 바꾸지 못했습니다. (${error.message})`);
      passwordState = "새로 만들어 .env에 저장";
    } else {
      passwordState = ".env의 값을 그대로 사용";
    }
  }

  // 역할 부여: profiles에 이름과 역할을 넣는다 (이 관리 절차로만 가능, SEC-07)
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: account.displayName, role: account.role }, { onConflict: "id" });
  if (profileError) fail(`${account.label} 프로필(역할)을 저장하지 못했습니다. (${profileError.message})`);

  envUpdates.push(
    { name: account.emailVar, value: email, note: account.label === "팀장" ? "시연·테스트 계정 (가상 데이터 전용, 개발 도구용 — Vercel에 등록 금지). npm run setup:accounts가 기록" : undefined },
    { name: account.passwordVar, value: password },
  );
  summary.push({ label: account.label, role: account.role, email, accountState, passwordState });
}

upsertEnvValues(envUpdates);

console.log("시연·테스트 계정 준비 완료\n");
for (const s of summary) {
  console.log(`[${s.label}] 역할 ${s.role}`);
  console.log(`  이메일: ${s.email}`);
  console.log(`  계정: ${s.accountState}`);
  console.log(`  비밀번호: ${s.passwordState} (값은 출력하지 않음 — .env의 변수 확인)`);
}
console.log("\n확인: npm run check:accounts");

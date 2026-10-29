// 시연·테스트 계정이 제대로 만들어졌고 권한이 설계대로인지 "실제로 로그인해서" 확인하는 스크립트 (PLAN 작업 13)
// 실행: npm run check:accounts
// - 두 계정으로 진짜 로그인해서 받은 로그인 정보(JWT)로 DB를 직접 호출해 본다. (SEC-07, SEC-03, SEC-04를 실제 계정으로 확인)
// - 수정 시도는 "거부되는지"만 본다. 저장되는 데이터는 없다.
// - 비밀번호·로그인 정보(토큰)는 절대 출력하지 않는다. 시험이 끝나면 로그인 세션도 정리(로그아웃)한다.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const managementToken = process.env.SUPABASE_ACCESS_TOKEN;

let failed = 0;
let warned = 0;

function report(ok, label, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
}
function warn(label, detail) {
  warned += 1;
  console.log(`주의 | ${label} — ${detail}`);
}

if (![url, publishable, secret].every(Boolean)) {
  console.error("실패: 환경변수가 부족합니다. npm run check:env를 먼저 실행해 주세요.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const ACCOUNTS = [
  { label: "팀장", role: "admin", displayName: "시연 팀장", emailVar: "DEMO_ADMIN_EMAIL", passwordVar: "DEMO_ADMIN_PASSWORD" },
  { label: "운영 담당자", role: "operator", displayName: "시연 담당자", emailVar: "DEMO_OPERATOR_EMAIL", passwordVar: "DEMO_OPERATOR_PASSWORD" },
];

// ---------------------------------------------------------------- 1. 환경변수 (값은 출력하지 않음)
for (const a of ACCOUNTS) {
  for (const name of [a.emailVar, a.passwordVar]) {
    const filled = Boolean(process.env[name]?.trim());
    report(filled, name, filled ? "값 있음" : "값 없음 — npm run setup:accounts를 실행해 주세요");
  }
  report((process.env[a.emailVar] ?? "").toLowerCase().endsWith("@example.com"), `${a.emailVar}는 가상 이메일(@example.com)`);
}
if (failed > 0) {
  console.log(`\n실패 ${failed}건`);
  process.exit(1);
}

// ---------------------------------------------------------------- 2. 계정이 Auth에 있는지
async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`계정 목록 조회 실패 (${error.message})`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

const allUsers = await listAllUsers();
const byEmail = (email) => allUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());

for (const a of ACCOUNTS) {
  a.user = byEmail(process.env[a.emailVar]);
  report(Boolean(a.user), `${a.label} 계정이 로그인 서비스(Auth)에 있음`);
  report(Boolean(a.user?.email_confirmed_at) && !a.user?.banned_until, `${a.label} 계정이 사용 가능 상태 (이메일 확인됨, 정지 아님)`);
}
const [adminAcc, opAcc] = ACCOUNTS;
if (!adminAcc.user || !opAcc.user) {
  console.log(`\n실패 ${failed}건`);
  process.exit(1);
}

// 테스트 계정 외의 계정이 있으면 알린다 (공개 회원가입으로 누군가 가입했을 가능성). 개인정보 보호를 위해 개수만 출력한다.
const others = allUsers.filter((u) => u.id !== adminAcc.user.id && u.id !== opAcc.user.id);
if (others.length > 0) {
  warn("테스트 계정 외의 계정이 있음", `${others.length}개 — 공개 회원가입으로 만들어졌을 수 있으니 Supabase 대시보드 Authentication > Users에서 확인하세요`);
} else {
  report(true, "로그인 계정은 테스트 계정 2개뿐임");
}

// ---------------------------------------------------------------- 3. 역할(profiles)
const { data: profiles, error: profilesError } = await admin.from("profiles").select("id, display_name, role");
report(!profilesError, "profiles 조회 (서버 관리용 키)", profilesError?.message ?? "");
for (const a of ACCOUNTS) {
  const p = profiles?.find((x) => x.id === a.user.id);
  report(p?.role === a.role, `${a.label}의 역할이 ${a.role}로 부여됨`, p ? `현재 ${p.role}` : "프로필 없음");
  report(p?.display_name === a.displayName, `${a.label}의 이름이 가상 이름(${a.displayName})임`);
}
report(profiles?.length === 2, "profiles에는 테스트 계정 2개의 줄만 있음", `${profiles?.length ?? 0}줄`);

// ---------------------------------------------------------------- 4. 실제 로그인
function decodeJwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function signIn(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, accessToken: body.access_token, errorCode: body.error_code ?? body.code };
}

const sessions = []; // 시험 후 로그아웃할 토큰들
for (const a of ACCOUNTS) {
  const s = await signIn(process.env[a.emailVar], process.env[a.passwordVar]);
  a.token = s.accessToken;
  if (a.token) sessions.push(a.token);
  report(s.status === 200 && Boolean(a.token), `${a.label} 계정으로 이메일·비밀번호 로그인 성공`, `응답 ${s.status}`);
  const claims = decodeJwtPayload(a.token ?? "");
  report(claims.sub === a.user.id && claims.role === "authenticated", `${a.label}의 로그인 정보(JWT)가 본인 계정·authenticated 역할`);
}
if (!adminAcc.token || !opAcc.token) {
  console.log(`\n실패 ${failed}건`);
  process.exit(1);
}

const wrong = await signIn(process.env[adminAcc.emailVar], `${process.env[adminAcc.passwordVar]}-wrong`);
report(wrong.status === 400 && !wrong.accessToken, "틀린 비밀번호로는 로그인되지 않음", `응답 ${wrong.status}`);

// ---------------------------------------------------------------- 5. 로그인한 사용자 권한으로 DB를 직접 호출
async function rest(token, method, table, { search = "", body } = {}) {
  const res = await fetch(`${url}/rest/v1/${table}${search}`, {
    method,
    headers: {
      apikey: publishable,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, code: json?.code, json };
}

const denied = (r) => r.status === 403 && r.code === "42501";

// 읽기는 된다
const adminProfiles = await rest(adminAcc.token, "GET", "profiles", { search: "?select=id,role" });
report(adminProfiles.status === 200 && adminProfiles.json?.length === 2, "팀장 로그인으로 profiles 2줄을 읽을 수 있음", `응답 ${adminProfiles.status}`);
const opSettings = await rest(opAcc.token, "GET", "settings", { search: "?select=key" });
report(opSettings.status === 200 && opSettings.json?.length === 14, "운영 담당자 로그인으로 settings 14개를 읽을 수 있음", `응답 ${opSettings.status}`);
const opRuns = await rest(opAcc.token, "GET", "check_runs", { search: "?select=id&limit=1" });
report(opRuns.status === 200, "운영 담당자 로그인으로 점검 실행 이력을 읽을 수 있음", `응답 ${opRuns.status}`);

// 로그인 없이는 안 된다
const anonProfiles = await rest(undefined, "GET", "profiles", { search: "?select=id" });
report(anonProfiles.status === 401, "로그인 없이는 profiles를 읽을 수 없음", `응답 ${anonProfiles.status}`);

// SEC-07: 역할 변경 시도는 거부된다
const opSelfPromote = await rest(opAcc.token, "PATCH", "profiles", { search: `?id=eq.${opAcc.user.id}`, body: { role: "admin" } });
report(denied(opSelfPromote), "운영 담당자가 자기 역할을 admin으로 바꾸려 하면 거부 (SEC-07)", `응답 ${opSelfPromote.status}, 오류 ${opSelfPromote.code}`);
const opDemoteAdmin = await rest(opAcc.token, "PATCH", "profiles", { search: `?id=eq.${adminAcc.user.id}`, body: { role: "operator" } });
report(denied(opDemoteAdmin), "운영 담당자가 팀장의 역할을 바꾸려 하면 거부", `응답 ${opDemoteAdmin.status}, 오류 ${opDemoteAdmin.code}`);
const adminSelf = await rest(adminAcc.token, "PATCH", "profiles", { search: `?id=eq.${opAcc.user.id}`, body: { role: "admin" } });
report(denied(adminSelf), "팀장도 API로 직접 역할을 바꿀 수 없음 (서버 관리 절차로만)", `응답 ${adminSelf.status}, 오류 ${adminSelf.code}`);
const opInsertProfile = await rest(opAcc.token, "POST", "profiles", { body: { id: opAcc.user.id, display_name: "위조", role: "admin" } });
report(denied(opInsertProfile), "운영 담당자가 admin 프로필을 직접 만들려 하면 거부", `응답 ${opInsertProfile.status}, 오류 ${opInsertProfile.code}`);

// SEC-03/05: 팀장 계정도 직접 보고서를 만들거나 이력을 고칠 수 없다
const adminReport = await rest(adminAcc.token, "POST", "reports", {
  body: { report_date: "2026-10-29", source: "DEMO", generated_by: adminAcc.user.id, covers_until: "2026-10-29T10:00:00+09:00", content_md: "# 직접 만든 보고서" },
});
report(denied(adminReport), "팀장 계정도 API로 직접 보고서를 만들 수 없음 (서버가 확인 후에만 추가)", `응답 ${adminReport.status}, 오류 ${adminReport.code}`);
const adminEvents = await rest(adminAcc.token, "DELETE", "anomaly_events", { search: "?id=eq.1" });
report(denied(adminEvents), "팀장 계정도 이력을 직접 지울 수 없음 (SEC-05)", `응답 ${adminEvents.status}, 오류 ${adminEvents.code}`);
const opAnomaly = await rest(opAcc.token, "POST", "anomalies", { body: { source: "DEMO", item_key: "DEMO-9999", rule_id: "DATE_ORDER", value_hash: "x" } });
report(denied(opAnomaly), "운영 담당자가 이상징후를 직접 만들 수 없음 (SEC-04, 변경은 DB 함수로만)", `응답 ${opAnomaly.status}, 오류 ${opAnomaly.code}`);

// 시도 후에도 역할이 그대로인지
const { data: after } = await admin.from("profiles").select("id, role");
report(
  after?.find((p) => p.id === opAcc.user.id)?.role === "operator" && after?.find((p) => p.id === adminAcc.user.id)?.role === "admin",
  "위 시도 후에도 두 계정의 역할이 그대로임",
);

// ---------------------------------------------------------------- 6. 로그인 세션 정리 (이 시험이 만든 세션만)
let loggedOut = 0;
for (const token of sessions) {
  const res = await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: publishable, Authorization: `Bearer ${token}` } });
  if (res.status === 204) loggedOut += 1;
}
report(loggedOut === sessions.length, "시험에 쓴 로그인 세션을 모두 정리(로그아웃)함", `${loggedOut}/${sessions.length}`);

// ---------------------------------------------------------------- 7. 공개 회원가입 설정 (읽기 전용 조회)
if (projectRef && managementToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    headers: { Authorization: `Bearer ${managementToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const config = res.ok ? await res.json() : undefined;
  if (!config) {
    warn("공개 회원가입 설정을 조회하지 못함", `응답 ${res.status}`);
  } else if (config.disable_signup === true) {
    report(true, "공개 회원가입이 꺼져 있음 (새 계정은 서버 관리 절차로만 만들 수 있음)");
  } else {
    warn(
      "공개 회원가입이 켜져 있음",
      "누구나 로그인 키로 계정을 만들 수 있습니다. Supabase 대시보드 > Authentication > Sign In / Providers > \"Allow new users to sign up\"을 끄세요 (직접 조치 필요)",
    );
  }
  report(config?.external_anonymous_users_enabled !== true, "익명 로그인은 꺼져 있음");
}

console.log(failed === 0 ? `\n테스트 계정 확인 완료${warned ? ` (주의 ${warned}건)` : ""}` : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

// 텔레그램 알림 비밀값 등록 스크립트 (홈페이지 모니터링 W12, PRD 부록 G)
// 실행:
//   npm run setup:telegram                                              (미리 보기: 어디에 무엇을 등록할지만 보여 줌, 값은 가림, 아무것도 바꾸지 않음)
//   npm run setup:telegram -- --check                                   (봇 토큰이 맞는지 getMe로 확인. 토큰은 출력하지 않음)
//   npm run setup:telegram -- --send-test                               (텔레그램 대화방에 시험 메시지 1건을 실제로 보냄)
//   npm run setup:telegram -- --app-url https://배포주소 --apply         (Supabase Vault + Vercel Production 환경변수에 등록)
//   npm run setup:telegram -- --remove --apply                          (두 곳에서 지움)
//
// 비밀값(.env의 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID)은 두 곳에만 둔다: Supabase Vault(DB 감시용)와 Vercel 환경변수(앱 알림용).
// 값은 화면·로그·커밋에 남기지 않는다(출력은 모두 가림). 등록 뒤에는 Vercel을 다시 배포해야 앱이 새 값을 읽는다. 교체할 때는 두 곳을 함께 바꾼다(이 스크립트를 다시 실행).
// 개발·시험에서는 WEB_NOTIFY_MODE를 두지 않으므로(log) .env에 값이 있어도 실제로 보내지 않는다. 운영 Vercel에만 telegram으로 등록한다.
import { readFileSync } from "node:fs";
import { buildVaultRemoveStatements, buildVaultStatements, buildVercelEnvEntries, maskTelegram, validateTelegramInputs } from "./lib/telegram-setup.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const remove = args.includes("--remove");
const check = args.includes("--check");
const sendTest = args.includes("--send-test");
const urlIndex = args.indexOf("--app-url");
const appUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const ref = process.env.SUPABASE_PROJECT_REF;
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;
const vercelToken = process.env.VERCEL_TOKEN;

const mask = (text) => maskTelegram(String(text), { token, chatId, appUrl });
const say = (text) => console.log(mask(text));
const fail = (message) => {
  console.error(`실패: ${mask(message)}`);
  process.exit(1);
};

if (!remove) {
  const problems = validateTelegramInputs({ token, chatId });
  if (problems.length > 0) fail(problems.join(" "));
}
if (apply && !remove && !appUrl) {
  // --apply는 앱 주소가 필요하다 (메시지의 상세 링크 APP_BASE_URL)
  fail("--app-url https://도메인 형식(경로 없이)으로 배포 주소를 알려 주세요.");
}
if (appUrl && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(appUrl)) fail("--app-url은 https://도메인 형식(경로 없이)이어야 합니다.");

// ----- 확인·시험 메시지 (외부 서비스 호출: 사용자가 요청한 경우에만) -----
if (check || sendTest) {
  if (check) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res || !res.ok) fail(`봇 토큰 확인 실패 (응답 ${res ? res.status : "없음"}). BotFather의 토큰인지 확인하세요.`);
    const body = await res.json();
    say(`봇 확인 완료: @${body?.result?.username ?? "(이름 없음)"} — 토큰은 출력하지 않습니다.`);
  }
  if (sendTest) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ [온비드 홈페이지 모니터링] 텔레그램 연결 시험 메시지입니다.", parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res || !res.ok) fail(`시험 메시지 전송 실패 (응답 ${res ? res.status : "없음"}). 채팅 ID가 맞는지, 봇이 그 대화방에 들어가 있는지 확인하세요.`);
    say("시험 메시지를 보냈습니다. 텔레그램에서 확인하세요.");
  }
  process.exit(0);
}

// ----- 등록 계획 -----
const vaultStatements = remove ? buildVaultRemoveStatements() : buildVaultStatements({ token, chatId });
const envEntries = remove ? [] : buildVercelEnvEntries({ token, chatId, appUrl: appUrl ?? "(--app-url 필요)" });
say(remove ? "텔레그램 비밀값 해제 계획" : "텔레그램 비밀값 등록 계획");
say("- Supabase Vault (DB 감시용): onbid_telegram_token, onbid_telegram_chat_id");
for (const s of vaultStatements) say(`  SQL> ${s.slice(0, 150)}`);
say(remove ? "- Vercel Production 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEB_NOTIFY_MODE, APP_BASE_URL 삭제" : "- Vercel Production 환경변수 (앱 알림용):");
for (const e of envEntries) say(`  ${e.key} = ${e.type === "sensitive" ? "****(sensitive)" : e.value}`);

if (!apply) {
  say("\n미리 보기입니다. 아무것도 바뀌지 않았습니다. 실제로 반영하려면 --apply를 붙여 다시 실행하세요. (등록 뒤 Vercel을 다시 배포해야 앱이 새 값을 읽습니다)");
  process.exit(0);
}

if (!ref || !supabaseToken) fail(".env에 SUPABASE_PROJECT_REF·SUPABASE_ACCESS_TOKEN이 없습니다.");
if (!vercelToken) fail(".env에 VERCEL_TOKEN이 없습니다.");
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
const vercelQuery = `teamId=${project.orgId}`;

for (const statement of vaultStatements) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${supabaseToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: statement }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) fail(`Vault 반영 실패 (응답 ${res.status}) — 비밀값 보호를 위해 내용은 출력하지 않습니다. Supabase 대시보드의 Vault를 확인하세요.`);
}
say(remove ? "Vault에서 지웠습니다." : "Vault에 등록했습니다.");

const vercelHeaders = { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" };
if (remove) {
  const list = await fetch(`https://api.vercel.com/v9/projects/${project.projectId}/env?${vercelQuery}`, { headers: vercelHeaders, signal: AbortSignal.timeout(30_000) });
  if (!list.ok) fail(`Vercel 환경변수 목록 조회 실패 (응답 ${list.status})`);
  const names = new Set(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "WEB_NOTIFY_MODE", "APP_BASE_URL"]);
  for (const env of (await list.json()).envs ?? []) {
    if (!names.has(env.key)) continue;
    const del = await fetch(`https://api.vercel.com/v9/projects/${project.projectId}/env/${env.id}?${vercelQuery}`, { method: "DELETE", headers: vercelHeaders, signal: AbortSignal.timeout(30_000) });
    if (!del.ok) fail(`Vercel 환경변수 삭제 실패 (${env.key}, 응답 ${del.status})`);
  }
  say("Vercel 환경변수에서 지웠습니다. 다시 배포해야 반영됩니다.");
} else {
  for (const e of envEntries) {
    const res = await fetch(`https://api.vercel.com/v10/projects/${project.projectId}/env?${vercelQuery}&upsert=true`, {
      method: "POST",
      headers: vercelHeaders,
      body: JSON.stringify({ key: e.key, value: e.value, type: e.type, target: ["production"] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) fail(`Vercel 환경변수 등록 실패 (${e.key}, 응답 ${res.status}) — 값은 출력하지 않습니다.`);
  }
  say("Vercel Production 환경변수에 등록했습니다. 다시 배포해야 앱이 새 값을 읽습니다.");
}

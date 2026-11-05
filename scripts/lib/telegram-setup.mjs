// 텔레그램 비밀값 등록의 순수 부분 (홈페이지 모니터링 W12) — scripts/setup-telegram.mjs가 쓰고, 단위 시험이 가림과 입력 검사를 확인한다
// 비밀값(봇 토큰·채팅 ID)은 두 곳에만 둔다: Supabase Vault(DB 감시용)와 Vercel 환경변수(앱 알림용). 같은 값이며 교체할 때는 두 곳을 함께 바꾼다.
import { maskText } from "./cron-jobs.mjs";

export const VAULT_TOKEN_NAME = "onbid_telegram_token";
export const VAULT_CHAT_NAME = "onbid_telegram_chat_id";

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

// 봇 토큰은 "숫자:영문숫자_-" 모양, 채팅 ID는 정수(그룹은 음수)다. 모양이 틀리면 등록하지 않는다
export function validateTelegramInputs({ token, chatId }) {
  const problems = [];
  if (!token) problems.push(".env에 TELEGRAM_BOT_TOKEN이 없습니다.");
  else if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) problems.push("TELEGRAM_BOT_TOKEN 모양이 올바르지 않습니다. (BotFather가 알려 준 값 그대로여야 합니다)");
  if (!chatId) problems.push(".env에 TELEGRAM_CHAT_ID가 없습니다.");
  else if (!/^-?\d{5,}$/.test(chatId)) problems.push("TELEGRAM_CHAT_ID는 숫자(그룹은 -로 시작)여야 합니다.");
  return problems;
}

// Vault에 값을 만들거나(없을 때) 맞춘다(있을 때). create_secret은 uuid, update_secret은 void를 돌려줘 한 문장으로 합치면 타입 오류가 나므로 두 문장으로 나눈다
export function buildVaultStatements({ token, chatId }) {
  const upsert = (value, name) => [
    `select vault.create_secret(${lit(value)}, ${lit(name)}) where not exists (select 1 from vault.secrets where name = ${lit(name)})`,
    `select vault.update_secret(id, ${lit(value)}) from vault.secrets where name = ${lit(name)}`,
  ];
  return [...upsert(token, VAULT_TOKEN_NAME), ...upsert(chatId, VAULT_CHAT_NAME)];
}

export const buildVaultRemoveStatements = () => [`delete from vault.secrets where name in (${lit(VAULT_TOKEN_NAME)}, ${lit(VAULT_CHAT_NAME)})`];

// Vercel(Production) 환경변수: 비밀값은 sensitive(등록 뒤 값을 다시 볼 수 없음), 나머지는 plain
export function buildVercelEnvEntries({ token, chatId, appUrl }) {
  return [
    { key: "TELEGRAM_BOT_TOKEN", value: token, type: "sensitive" },
    { key: "TELEGRAM_CHAT_ID", value: chatId, type: "sensitive" },
    { key: "WEB_NOTIFY_MODE", value: "telegram", type: "plain" },
    { key: "APP_BASE_URL", value: appUrl, type: "plain" },
  ];
}

// 화면 출력용: 봇 토큰·채팅 ID·앱 주소를 가린다
export const maskTelegram = (text, { token, chatId, appUrl }) => maskText(text, { secrets: [token, chatId], appUrl });

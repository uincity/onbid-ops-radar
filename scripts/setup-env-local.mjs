// 앱이 쓰는 환경변수를 .env.local에 채워 넣는 스크립트 (PLAN 작업 3)
// 실행: npm run setup:env
// - 이미 값이 있는 변수는 건드리지 않고, 비어 있거나 잘못된 것만 채운다. (여러 번 실행해도 안전)
// - Supabase 주소·키는 Supabase 관리 API로 가져오고, 값은 화면에 출력하지 않는다.
// - DATA_GO_KR_SERVICE_KEY는 공공데이터포털 활용신청 승인 후 직접 입력해야 하므로 빈 줄만 만든다.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

const envLocalPath = path.join(rootDir, ".env.local");

function fail(message) {
  console.error(`실패: ${message}`);
  process.exit(1);
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef) fail("SUPABASE_PROJECT_REF가 없습니다. 먼저 npm run setup:supabase를 실행해 주세요.");
if (!accessToken) fail(".env에 SUPABASE_ACCESS_TOKEN 값이 없습니다.");

// 값이 올바른 모양인지 검사한다. (가려진 키 "sb_secret_8i····"가 저장된 경우를 걸러내기 위함)
const validators = {
  NEXT_PUBLIC_SUPABASE_URL: (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: (v) => /^sb_publishable_[A-Za-z0-9_-]+$/.test(v),
  SUPABASE_SECRET_KEY: (v) => /^sb_secret_[A-Za-z0-9_-]+$/.test(v),
  CRON_SECRET: (v) => v.length >= 32,
};

const original = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
const lines = original === "" ? [] : original.split(/\r?\n/);

function currentValue(name) {
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[1] === name) return match[2];
  }
  return undefined; // 줄 자체가 없음
}

const isOk = (name) => {
  const value = currentValue(name);
  return value !== undefined && value !== "" && (validators[name]?.(value) ?? true);
};

const updates = []; // { name, value, note }

if (!["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"].every(isOk)) {
  // reveal=true 를 붙여야 가려지지 않은 secret 키를 받을 수 있다
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) fail(`Supabase API 키를 가져오지 못했습니다. (응답 ${res.status})`);
  const keys = await res.json();
  const publishable = keys.find((k) => k.type === "publishable")?.api_key;
  const secret = keys.find((k) => k.type === "secret")?.api_key;
  if (!publishable || !secret) fail("publishable/secret 키를 찾지 못했습니다.");

  const fresh = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SECRET_KEY: secret,
  };
  const notes = {
    NEXT_PUBLIC_SUPABASE_URL: "브라우저·서버 공용 (공개되어도 되는 값)",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "브라우저·서버 공용 (공개 키, 데이터 보호는 RLS가 담당)",
    SUPABASE_SECRET_KEY: "서버 전용 — 브라우저 코드에서 절대 사용 금지",
  };
  for (const name of Object.keys(fresh)) {
    if (!isOk(name)) {
      if (!validators[name](fresh[name])) fail(`${name} 값의 모양이 올바르지 않습니다.`);
      updates.push({ name, value: fresh[name], note: notes[name] });
    }
  }
}

if (!isOk("CRON_SECRET")) {
  updates.push({
    name: "CRON_SECRET",
    value: randomBytes(32).toString("base64url"),
    note: "서버 전용 — 예약 점검 입구 인증용 (나중에 Supabase Vault·Vercel에도 같은 값 등록)",
  });
}

if (currentValue("DATA_GO_KR_SERVICE_KEY") === undefined) {
  updates.push({ name: "DATA_GO_KR_SERVICE_KEY", value: "", note: "서버 전용 — 공공데이터포털 활용신청 승인 후 직접 입력" });
}

if (updates.length === 0) {
  console.log(".env.local에 채울 값이 없습니다. (이미 모두 있음)");
  process.exit(0);
}

// 줄이 이미 있으면 그 줄의 값을 바꾸고, 없으면 파일 끝에 설명과 함께 추가한다
for (const { name, value, note } of updates) {
  const index = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (index >= 0) {
    lines[index] = `${name}=${value}`;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`# ${note}`, `${name}=${value}`);
  }
  console.log(`${name}: ${value === "" ? "빈 줄 추가 (직접 입력 필요)" : "값 저장됨"}`);
}
writeFileSync(envLocalPath, `${lines.join("\n").replace(/\n+$/, "")}\n`);

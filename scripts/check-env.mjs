// 환경변수와 Supabase 키가 제대로 준비됐는지 확인하는 스크립트 (PLAN 작업 3)
// 실행: npm run check:env
// 값은 절대 출력하지 않고 "값 있음/없음"과 통과/실패만 보여 준다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

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

// 1. .env.example에 적힌 이름이 모두 .env.local에 있는지 (값은 출력하지 않음)
const examplePath = path.join(rootDir, ".env.example");
const exampleLines = readFileSync(examplePath, "utf8").split(/\r?\n/);
const names = exampleLines.map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean);

report(
  names.every((m) => m[2] === ""),
  ".env.example에는 이름만 있고 값이 없음",
);

const SERVICE_KEY = "DATA_GO_KR_SERVICE_KEY"; // 활용신청 승인 후 직접 입력하는 값
for (const [, name] of names) {
  const filled = Boolean(process.env[name]?.trim());
  if (name === SERVICE_KEY && !filled) {
    warn(name, "값 없음 — 공공데이터포털 활용신청 승인 후 .env.local에 직접 입력하세요 (PUBLIC 점검 전까지는 비워 둬도 됨)");
  } else {
    report(filled, name, filled ? "값 있음" : "값 없음");
  }
}

// 2. 서버 전용 키가 NEXT_PUBLIC_ 값에 섞여 들어가지 않았는지
const secret = process.env.SUPABASE_SECRET_KEY;
const publicNames = Object.keys(process.env).filter((n) => n.startsWith("NEXT_PUBLIC_"));
report(
  Boolean(secret) && publicNames.every((n) => process.env[n] !== secret),
  "서버 전용 키가 NEXT_PUBLIC_ 값으로 노출되지 않음",
);

// 3. 키가 실제로 동작하는지 (Supabase에 읽기 전용 요청)
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function status(pathname, key) {
  try {
    // supabase-js와 같은 방식: 키를 apikey와 Authorization 두 헤더에 모두 담아 보낸다
    const res = await fetch(`${url}${pathname}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

if (url && publishable && secret) {
  const publicOk = await status("/auth/v1/settings", publishable);
  report(publicOk === 200, "공개 키(publishable)로 Supabase 접속", `응답 ${publicOk}`);

  const secretOk = await status("/auth/v1/admin/users?per_page=1", secret);
  report(secretOk === 200, "서버 전용 키(secret)로 관리 기능 접속", `응답 ${secretOk}`);

  const publicAdmin = await status("/auth/v1/admin/users?per_page=1", publishable);
  report(publicAdmin === 401 || publicAdmin === 403, "공개 키로는 관리 기능이 막힘", `응답 ${publicAdmin}`);
}

// 4. 파일이 준비됐는지
for (const file of [
  "lib/supabase/env.ts",
  "lib/supabase/client.ts",
  "lib/supabase/server.ts",
  "lib/supabase/admin.ts",
]) {
  report(existsSync(path.join(rootDir, file)), `${file} 있음`);
}

console.log(failed === 0 ? `\n환경변수 확인 완료${warned ? ` (주의 ${warned}건)` : ""}` : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

// Supabase 프로젝트를 만들고 이 폴더(supabase/)와 연결하는 스크립트 (PLAN 작업 2)
// 실행: npm run setup:supabase
// - .env에 SUPABASE_PROJECT_REF가 이미 있으면 새로 만들지 않고 연결만 다시 한다.
// - DB 비밀번호는 무작위로 만들어 .env에만 저장하고 화면에 출력하지 않는다.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runSupabase, maskSecrets, rootDir } from "./lib/supabase-cli.mjs";

const PROJECT_NAME = "onbid-ops-radar";
const REGION = "ap-northeast-2"; // 서울
const SECRET_NAMES = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const envPath = path.join(rootDir, ".env");

function fail(message, output = "") {
  console.error(`실패: ${message}`);
  const detail = maskSecrets(output, SECRET_NAMES).trim().split("\n").slice(-3).join("\n  ");
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

function listProjects() {
  const run = runSupabase(["projects", "list", "--output", "json"]);
  if (run.status !== 0) fail("프로젝트 목록을 가져오지 못했습니다.", run.stderr);
  return JSON.parse(run.stdout);
}

if (!process.env.SUPABASE_ACCESS_TOKEN) fail(".env에 SUPABASE_ACCESS_TOKEN 값이 없습니다.");

// 1. 프로젝트 만들기 (이미 만들었으면 건너뜀)
if (!process.env.SUPABASE_PROJECT_REF) {
  const orgs = runSupabase(["orgs", "list", "--output", "json"]);
  if (orgs.status !== 0) fail("조직 목록을 가져오지 못했습니다.", orgs.stderr);
  const orgList = JSON.parse(orgs.stdout);
  if (orgList.length !== 1) fail(`조직이 ${orgList.length}개라 자동으로 고를 수 없습니다.`);

  if (listProjects().some((p) => p.name === PROJECT_NAME)) {
    fail(`'${PROJECT_NAME}' 프로젝트가 이미 있습니다. .env에 SUPABASE_PROJECT_REF를 확인해 주세요.`);
  }

  const dbPassword = randomBytes(24).toString("base64url");
  process.env.SUPABASE_DB_PASSWORD = dbPassword;

  console.log(`'${PROJECT_NAME}' 프로젝트를 ${REGION}(서울)에 만드는 중...`);
  const created = runSupabase([
    "projects", "create", PROJECT_NAME,
    "--org-id", orgList[0].id,
    "--region", REGION,
    "--db-password", dbPassword,
  ]);
  if (created.status !== 0) fail("프로젝트를 만들지 못했습니다.", created.stderr || created.stdout);

  const project = listProjects().find((p) => p.name === PROJECT_NAME);
  if (!project) fail("만든 프로젝트를 목록에서 찾지 못했습니다.");
  process.env.SUPABASE_PROJECT_REF = project.id;

  // 비밀번호를 잃어버리지 않도록 만든 직후 바로 .env에 저장한다 (.gitignore 대상)
  // .env는 직접 만든 파일이라 마지막 줄 끝에 줄바꿈이 없을 수 있다. 없으면 먼저 줄을 바꿔 앞 줄과 붙지 않게 한다.
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const prefix = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(
    envPath,
    `${prefix}# Supabase 프로젝트 (npm run setup:supabase가 기록)\n` +
      `SUPABASE_PROJECT_REF=${project.id}\nSUPABASE_DB_PASSWORD=${dbPassword}\n`,
  );
  console.log("프로젝트를 만들었고, 연결 정보를 .env에 저장했습니다.");
}

// 2. 프로젝트가 사용 가능해질 때까지 기다림 (최대 5분)
const ref = process.env.SUPABASE_PROJECT_REF;
for (let waited = 0; ; waited += 10) {
  const status = listProjects().find((p) => p.id === ref)?.status;
  if (status === "ACTIVE_HEALTHY") break;
  if (waited >= 300) fail(`프로젝트가 아직 준비되지 않았습니다 (상태: ${status ?? "알 수 없음"}).`);
  console.log(`프로젝트 준비 중... (상태: ${status ?? "알 수 없음"}, ${waited}초 경과)`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

// 3. 이 폴더의 supabase/와 연결 (비밀번호는 환경변수로만 넘김)
if (!process.env.SUPABASE_DB_PASSWORD) fail(".env에 SUPABASE_DB_PASSWORD 값이 없습니다.");
const linked = runSupabase(["link", "--project-ref", ref], {
  env: { SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD },
});
if (linked.status !== 0) fail("supabase/ 폴더를 프로젝트와 연결하지 못했습니다.", linked.stderr || linked.stdout);

console.log("연결 완료: supabase/ 폴더가 Supabase 프로젝트와 연결되었습니다.");

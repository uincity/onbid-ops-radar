// supabase/ 폴더가 Supabase 프로젝트와 제대로 연결됐는지 확인하는 스크립트 (PLAN 작업 2)
// 실행: npm run check:supabase
// 비밀 값은 출력하지 않고 "값 있음/없음"과 결과만 보여 준다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runSupabase, maskSecrets, rootDir } from "./lib/supabase-cli.mjs";

const SECRET_NAMES = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
let failed = 0;

function report(ok, label, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
}

// 1. 필요한 값이 있는지
for (const name of [...SECRET_NAMES, "SUPABASE_PROJECT_REF"]) {
  report(Boolean(process.env[name]?.trim()), name, process.env[name]?.trim() ? "값 있음" : "값 없음");
}

// 2. supabase/ 폴더가 준비됐는지
report(existsSync(path.join(rootDir, "supabase", "config.toml")), "supabase/config.toml 있음");

// 3. 연결된 프로젝트가 .env의 프로젝트와 같은지
const refFile = path.join(rootDir, "supabase", ".temp", "project-ref");
const linkedRef = existsSync(refFile) ? readFileSync(refFile, "utf8").trim() : "";
report(
  linkedRef !== "" && linkedRef === process.env.SUPABASE_PROJECT_REF,
  "supabase/ 폴더가 .env의 프로젝트와 연결됨",
);

// 4. 프로젝트가 실행 중인지
const list = runSupabase(["projects", "list", "--output", "json"]);
const project = list.status === 0
  ? JSON.parse(list.stdout).find((p) => p.id === process.env.SUPABASE_PROJECT_REF)
  : undefined;
report(project?.status === "ACTIVE_HEALTHY", "프로젝트 상태", project ? `${project.name}, ${project.status}, ${project.region}` : "찾지 못함");

// 5. 원격 DB에 실제로 접속되는지 (마이그레이션 목록 조회는 읽기 전용)
const migrations = runSupabase(["migration", "list"], {
  env: { SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD ?? "" },
});
report(
  migrations.status === 0,
  "원격 DB 접속",
  migrations.status === 0
    ? "마이그레이션 목록 조회 성공"
    : maskSecrets(migrations.stderr, SECRET_NAMES).trim().split("\n").slice(-1)[0],
);

console.log(failed === 0 ? "\nSupabase 연결 확인 완료" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

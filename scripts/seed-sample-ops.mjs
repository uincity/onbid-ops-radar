// 예시 운영 데이터를 DB에 한 번 넣는 스크립트 (대시보드·목록·보고서가 비어 보이지 않게 하는 용도)
// 실행: npm run seed:sample   (.env의 서버 관리용 키 · 공개 키 · 시연 계정이 필요. 값은 출력하지 않는다)
//
// 주의: 이상징후 이력은 한번 만들면 지울 수 없다. 그래서 처음 한 번만 동작하고,
//       이상징후가 이미 있으면 아무것도 하지 않고 끝낸다.
// 점검 엔진(TypeScript)을 써야 해서, 점검 엔진 실제 DB 시험(test:engine-live)처럼 vitest 실행기를 빌려 쓴다.
// 실제 내용은 tests/unit/seed-sample-live.test.ts에 있다.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

// 필요한 환경변수가 있는지 이름만 확인한다 (값은 출력하지 않는다)
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DEMO_ADMIN_EMAIL",
  "DEMO_ADMIN_PASSWORD",
  "DEMO_OPERATOR_EMAIL",
  "DEMO_OPERATOR_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`.env에 값이 없는 항목이 있어 시작하지 않았습니다: ${missing.join(", ")}`);
  console.error("먼저 npm run setup:env, npm run setup:accounts를 실행해 주세요.");
  process.exit(1);
}

const vitest = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "seed-sample-live"], {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, SEED_SAMPLE: "1" },
});
process.exit(run.status ?? 1);

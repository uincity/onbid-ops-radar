// 점검 엔진을 실제 DB에 한 번 돌려 보는 시험을 실행하는 스크립트 (PLAN 작업 22)
// 실행: npm run test:engine-live   (.env의 서버 관리용 키 필요. 시험이 만든 기록은 끝나면 지운다)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

const vitest = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "check-engine-live"], {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, LIVE_DB: "1" },
});
process.exit(run.status ?? 1);

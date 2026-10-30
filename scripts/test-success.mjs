// 성공 기준 시험 중 실제 DB가 필요한 것을 실행한다 (R08, PRD 3-1, PLAN 35)
// 실행: npm run test:success   (.env의 서버 관리용 키 필요. DB에 아무것도 남기지 않는다)
//   - 보고서 60초 이내 · 같은 데이터로 10회 (tests/unit/report-live.test.ts)
// 나머지 성공 기준은 이미 있는 시험이 맡는다:
//   - DEMO 160건(정상 100·이상 30·경계 30) 채점: npm run test:unit (run-check.test.ts, demo-scenarios.test.ts)
//   - 담당자 배정·상태 변경 20건 이상, 이력 누락 0건: npm run test:db (11_success_state_changes.test.sql)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

const vitest = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "report-live"], { cwd: rootDir, stdio: "inherit", env: { ...process.env, LIVE_DB: "1" } });
process.exit(run.status ?? 1);

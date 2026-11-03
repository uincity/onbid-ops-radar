// 추가 오퍼레이션 13개를 실제 온비드 OpenAPI에 한 번씩 불러 보는 시험을 실행하는 스크립트 (R04 확장)
// 실행: npm run test:public-probes   (.env의 DATA_GO_KR_SERVICE_KEY 필요. 호출은 최대 14번뿐이고 DB에는 아무것도 쓰지 않는다)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

if (!process.env.DATA_GO_KR_SERVICE_KEY) {
  console.error("실패: .env에 DATA_GO_KR_SERVICE_KEY가 없습니다.");
  process.exit(1);
}

const vitest = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "public-probes-live", "--reporter=verbose"], {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, LIVE_PUBLIC: "1" },
});
process.exit(run.status ?? 1);

// 유형별 시험 알림을 실제 텔레그램으로 보내 보는 스크립트 (홈페이지 모니터링 알림 문구 확인용)
// 실행: npm run test:notify-samples                 (모든 유형 17건을 순서대로 보냄)
//       NOTIFY_SAMPLES_ONLY=down-5xx,cert npm run test:notify-samples   (일부만: id를 쉼표로)
// .env의 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID가 필요하다. DB에는 아무것도 쓰지 않고, 모든 문구에 [시험] 표시가 붙는다. 토큰은 출력하지 않는다.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.error("실패: .env에 TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없습니다.");
  process.exit(1);
}

const vitest = path.join(rootDir, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "web-notify-samples-live", "--reporter=verbose"], {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, NOTIFY_SAMPLES: "1" },
});
process.exit(run.status ?? 1);

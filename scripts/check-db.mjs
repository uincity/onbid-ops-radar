// 만들어 둔 DB 테이블이 DESIGN대로인지 한꺼번에 확인하는 스크립트 (PLAN 작업 6~)
// 실행: npm run check:db
// 새 테이블을 만들 때마다 scripts/db-checks/ 에 확인 파일을 하나 추가하고 아래 목록에 넣는다.
// 구조는 읽기 전용으로 조회하고, 동작은 "거부되는지 보기"와 "되돌리는 시험"으로만 확인한다. (저장되는 줄 없음)
import { createChecker } from "./lib/db-check.mjs";
import * as profiles from "./db-checks/profiles.mjs";
import * as checkRuns from "./db-checks/check-runs.mjs";
import * as collectedItems from "./db-checks/collected-items.mjs";
import * as anomalies from "./db-checks/anomalies.mjs";
import * as anomalyEvents from "./db-checks/anomaly-events.mjs";
import * as settings from "./db-checks/settings.mjs";
import * as reports from "./db-checks/reports.mjs";

const modules = [profiles, checkRuns, collectedItems, anomalies, anomalyEvents, settings, reports];
const ctx = createChecker();

// 시험을 시작하기 전의 줄 수를 기록해 둔다. 시험이 끝난 뒤 줄 수가 같은지(저장된 줄이 없는지) 비교하기 위해서다.
// 이렇게 하면 시연 계정처럼 테이블에 실제 데이터가 있어도 "시험이 남긴 줄"만 정확히 가려낼 수 있다.
await ctx.snapshot();

for (const mod of modules) {
  console.log(`\n== ${mod.title} ==`);
  try {
    await mod.run(ctx);
  } catch (error) {
    ctx.report(false, `${mod.title} 확인 중 오류`, error instanceof Error ? error.message : String(error));
  }
}

const failed = ctx.finish();
console.log(failed === 0 ? "\nDB 테이블 확인 완료" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

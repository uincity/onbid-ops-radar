// DEMO 시나리오 160건을 DB(collected_items)에 주입하는 스크립트 (PLAN 작업 17)
// 실행: npm run seed:demo            → 이전에 주입한 것을 지우고 새로 주입 (몇 번을 돌려도 같은 상태가 된다)
//       npm run seed:demo -- --clear → 주입한 것만 지우고 끝냄 (다른 점검 데이터는 건드리지 않음)
//
// 주입하는 것은 "수집된 원본 데이터"뿐이다. 이상징후는 만들지 않는다. (탐지는 탐지 규칙·점검 엔진, PLAN 18~23번이 한다)
// 정답 표시(expected)는 DB에 넣지 않는다. (DB는 부록 B의 6개 필드 이름만 받는다) 정답은 data/demo/scenarios.json에만 있다.
import {
  LIST_COLLECTED_AFTER_START_MS,
  RUN_LENGTH_MS,
  SEED_LOG_CODE,
  createAdmin,
  fail,
  findSeedRunIds,
  loadScenarioFile,
  removeSeed,
} from "./lib/demo-seed.mjs";

const clearOnly = process.argv.includes("--clear");
const admin = createAdmin();

// 1. 이전에 주입한 것 지우기
const previous = await findSeedRunIds(admin);
const removed = await removeSeed(admin, previous);
if (previous.length > 0) console.log(`이전 주입분 삭제: 점검 실행 ${removed.runs}건, 수집 데이터 ${removed.items}줄`);
if (clearOnly) {
  console.log(previous.length > 0 ? "주입한 DEMO 데이터를 모두 지웠습니다." : "지울 DEMO 주입 데이터가 없습니다.");
  process.exit(0);
}

const file = loadScenarioFile();

// 2. 점검 실행 1건 만들기. 지금보다 2시간 전에 시작해 1시간 동안 돌았다고 적는다. (대시보드의 "오늘" 기준에 어색하지 않게)
const startedAt = new Date(Math.floor((Date.now() - 2 * 3600_000) / 1000) * 1000);
const finishedAt = new Date(startedAt.getTime() + RUN_LENGTH_MS);
const { data: run, error: runError } = await admin
  .from("check_runs")
  .insert({
    trigger: "manual",
    source: "DEMO",
    status: "succeeded",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    api_call_count: 0,
  })
  .select("id")
  .single();
if (runError || !run) fail("점검 실행을 만들지 못했습니다.", runError);

// 3. 표식 메모 남기기 (이 실행이 시연용 주입분임을 나중에 정확히 찾기 위해)
const counts = (group) => file.scenarios.filter((s) => s.group === group).length;
const { error: logError } = await admin.from("run_logs").insert({
  run_id: run.id,
  level: "info",
  code: SEED_LOG_CODE,
  message: `DEMO 시나리오 ${file.scenarios.length}건 주입 (정상 ${counts("normal")}·이상 ${counts("anomaly")}·경계 ${counts("boundary")})`,
});
if (logError) {
  await removeSeed(admin, [run.id]);
  fail("주입 표식을 남기지 못했습니다.", logError);
}

// 4. 수집 데이터 넣기: 시나리오마다 목록 1줄·상세 1줄 (없는 쪽은 넣지 않는다)
const listAt = startedAt.getTime() + LIST_COLLECTED_AFTER_START_MS;
const rows = [];
for (const s of file.scenarios) {
  if (s.list) {
    rows.push({ run_id: run.id, source: "DEMO", item_key: s.id, kind: "list", fields: s.list, collected_at: new Date(listAt).toISOString() });
  }
  if (s.detail) {
    rows.push({
      run_id: run.id,
      source: "DEMO",
      item_key: s.id,
      kind: "detail",
      fields: s.detail,
      collected_at: new Date(listAt + s.detailOffsetSeconds * 1000).toISOString(),
    });
  }
}
for (let i = 0; i < rows.length; i += 100) {
  const { error } = await admin.from("collected_items").insert(rows.slice(i, i + 100));
  if (error) {
    await removeSeed(admin, [run.id]); // 중간에 실패하면 반쯤 들어간 상태를 남기지 않고 모두 되돌린다
    fail(`수집 데이터를 넣지 못했습니다. (${i}번째 줄부터) 주입한 것을 모두 되돌렸습니다.`, error);
  }
}

console.log(`DEMO 시나리오 주입 완료: 물건 ${file.scenarios.length}건 → 수집 데이터 ${rows.length}줄 (점검 실행 #${run.id})`);
console.log(`  정상 ${counts("normal")} · 이상 ${counts("anomaly")} · 경계 ${counts("boundary")}`);
console.log("확인: npm run check:demo   |   지우기: npm run seed:demo -- --clear");

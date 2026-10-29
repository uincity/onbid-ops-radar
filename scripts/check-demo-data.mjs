// DB에 주입된 DEMO 시나리오가 data/demo/scenarios.json과 정확히 같은지 확인하는 스크립트 (PLAN 작업 17)
// 실행: npm run check:demo   (먼저 npm run seed:demo로 주입해 두어야 한다)
// 읽기 전용이다. 아무것도 바꾸지 않는다.
import { LIST_COLLECTED_AFTER_START_MS, createAdmin, findSeedRunIds, loadScenarioFile } from "./lib/demo-seed.mjs";

let failed = 0;
function report(ok, label, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
}

// 키 순서가 달라도 같은 값이면 같다고 본다 (jsonb는 키 순서를 바꿔 저장한다)
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const admin = createAdmin();
const file = loadScenarioFile();

const runIds = await findSeedRunIds(admin);
report(runIds.length === 1, "주입한 점검 실행이 정확히 1건 있음", `${runIds.length}건`);
if (runIds.length !== 1) {
  console.log("\n먼저 npm run seed:demo로 주입해 주세요.");
  process.exit(1);
}
const runId = runIds[0];

const { data: run, error: runError } = await admin.from("check_runs").select("id, trigger, source, status, started_at, finished_at, api_call_count").eq("id", runId).single();
report(!runError && run.source === "DEMO" && run.status === "succeeded" && run.trigger === "manual", "점검 실행: 출처 DEMO · 수동 · 완료 상태", run ? `${run.source}/${run.trigger}/${run.status}` : runError?.message);

const { data: rows, error: rowsError } = await admin
  .from("collected_items")
  .select("item_key, kind, source, fields, collected_at")
  .eq("run_id", runId)
  .limit(2000);
report(!rowsError, "수집 데이터 조회", rowsError?.message ?? "");

const expectedRows = file.scenarios.reduce((sum, s) => sum + (s.list ? 1 : 0) + (s.detail ? 1 : 0), 0);
report(rows?.length === expectedRows, `수집 데이터가 ${expectedRows}줄 (320줄에서 목록 또는 상세가 없는 2건 제외)`, `${rows?.length ?? 0}줄`);
report(rows?.every((r) => r.source === "DEMO"), "모든 줄의 출처가 DEMO");

const byKey = new Map((rows ?? []).map((r) => [`${r.item_key}|${r.kind}`, r]));
const startedMs = new Date(run.started_at).getTime();
const listAtMs = startedMs + LIST_COLLECTED_AFTER_START_MS;

let missing = 0;
let wrongFields = 0;
let wrongTime = 0;
let unexpected = 0;
for (const s of file.scenarios) {
  const list = byKey.get(`${s.id}|list`);
  const detail = byKey.get(`${s.id}|detail`);
  if (Boolean(list) !== Boolean(s.list) || Boolean(detail) !== Boolean(s.detail)) missing += 1;
  if (list && s.list && canonical(list.fields) !== canonical(s.list)) wrongFields += 1;
  if (detail && s.detail && canonical(detail.fields) !== canonical(s.detail)) wrongFields += 1;
  if (list && new Date(list.collected_at).getTime() !== listAtMs) wrongTime += 1;
  if (list && detail && new Date(detail.collected_at).getTime() - new Date(list.collected_at).getTime() !== s.detailOffsetSeconds * 1000) wrongTime += 1;
}
const known = new Set(file.scenarios.map((s) => s.id));
for (const r of rows ?? []) if (!known.has(r.item_key)) unexpected += 1;

report(missing === 0, "시나리오 160건 모두 목록·상세가 있어야 할 곳에 있고, 없어야 할 곳에는 없음 (DEMO-0158 상세 없음, DEMO-0159 목록 없음)", missing ? `어긋난 물건 ${missing}건` : "");
report(wrongFields === 0, "저장된 필드 값이 시나리오 파일과 모두 같음 (누락·null·잘못된 형식 같은 이상 데이터도 그대로)", wrongFields ? `다른 줄 ${wrongFields}개` : "");
report(wrongTime === 0, "수집 시각이 시나리오대로임 (목록·상세 시간차 599·600·601초 경계 포함)", wrongTime ? `어긋난 줄 ${wrongTime}개` : "");
report(unexpected === 0, "시나리오에 없는 물건이 섞여 있지 않음");

// 경계 시나리오의 시간차가 DB에서도 정확히 보존되는지 (10분 경계의 핵심)
const gap = (id) => {
  const l = byKey.get(`${id}|list`);
  const d = byKey.get(`${id}|detail`);
  return l && d ? Math.round((new Date(d.collected_at).getTime() - new Date(l.collected_at).getTime()) / 1000) : null;
};
const boundaryGaps = file.scenarios.filter((s) => s.group === "boundary" && s.expected.listDetail !== "skipped:NO_COUNTERPART" && [599, 600, 601].includes(Math.abs(s.detailOffsetSeconds)));
report(
  boundaryGaps.length >= 6 && boundaryGaps.every((s) => gap(s.id) === s.detailOffsetSeconds),
  "시간차 경계 시나리오(599·600·601초, 상세가 먼저인 경우 포함)가 DB에서도 정확함",
  boundaryGaps.map((s) => `${s.id}:${gap(s.id)}s`).join(" "),
);

// 이 스크립트는 이상징후를 만들지 않는다
const { count: anomalyCount } = await admin.from("anomalies").select("id", { count: "exact", head: true }).eq("source", "DEMO");
report(anomalyCount === 0, "이상징후는 아직 만들어지지 않음 (탐지는 PLAN 18~23번)", `${anomalyCount}건`);

console.log(failed === 0 ? "\nDEMO 시나리오 주입 확인 완료" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

// Design Ref: DESIGN §5.1 흐름 ① — 점검 실행 엔진 (PLAN 작업 22)
// 시작(중복 차단) → 조회(호출 상한·시간 제한) → 정리·저장 → 탐지(규칙 3개 + 빈 결과) → 마감.
// 탐지 결과는 저장소의 recordDetection(= DB 함수 record_detection)으로 등록한다. 중복·재발·정상 판정 억제는 DB 함수가 지킨다 (PLAN 23).
// 서비스키·한도 문제가 생긴 실행에서는 데이터 이상징후를 만들지 않는다 (PRD 5-2 규칙 6).
import { detectItem, type ItemDetection } from "@/lib/rules/detect-item";
import type { Settings } from "@/lib/settings/schema";
import { buildDetectionEvidence, buildEmptyResultEvidence } from "./evidence";
import type { ApiFetchResult, CheckStore, DetectionRecord, FetchedRecord, Fetcher, RecordAction, RunStatus, RunTrigger, RunSource } from "./types";

// 출처별로 부르는 조회 이름. 목록 → 상세 순서다.
const ENDPOINTS: Record<"DEMO", { name: string; kind: "list" | "detail" }[]> = {
  DEMO: [
    { name: "demo-list", kind: "list" },
    { name: "demo-detail", kind: "detail" },
  ],
};

// 등록할 탐지 결과 + 규칙 판정 상세 (EMPTY_RESULT는 판정 상세가 없음)
export type EngineDetection = DetectionRecord & { detection: ItemDetection | null };

export type RunCheckInput = {
  trigger: RunTrigger;
  source: RunSource;
  triggeredBy?: string | null; // 수동 점검을 누른 팀장 (예약은 비움)
  settings: Settings;
  store: CheckStore;
  fetcher: Fetcher;
  callLimit?: number; // 안 주면 기본 상한(20회). 최대 상한(100회)을 넘을 수 없다
  clock?: () => number; // 지금 시각(ms). 시험에서 바꿔 끼운다
};

export type RunCheckResult = {
  runId: number;
  status: RunStatus | "blocked";
  apiCallCount: number;
  detections: EngineDetection[];
  registered: Record<RecordAction, number>; // 등록 결과 집계
};

const noRegistered = (): Record<RecordAction, number> => ({ created: 0, recurred: 0, detected_again: 0, suppressed: 0 });

export async function runCheck(input: RunCheckInput): Promise<RunCheckResult> {
  const { trigger, source, settings, store, fetcher, clock = Date.now } = input;

  // 시작 전에 막을 수 있는 잘못된 요청은 실행 기록을 만들지 않고 거부한다
  if (source !== "DEMO") throw new Error("PUBLIC 조회기는 아직 없습니다 (PLAN 33번). DEMO만 점검할 수 있습니다.");
  const callLimit = input.callLimit ?? settings.apiCallLimitDefault;
  if (!Number.isInteger(callLimit) || callLimit < 1 || callLimit > settings.apiCallLimitMax) {
    throw new Error(`호출 상한은 1~${settings.apiCallLimitMax} 사이의 정수여야 합니다.`);
  }

  const started = await store.startRun(trigger, source, input.triggeredBy ?? null);
  if (started.status === "blocked") return { runId: started.runId, status: "blocked", apiCallCount: 0, detections: [], registered: noRegistered() };
  const runId = started.runId;

  let calls = 0;
  try {
    const t0 = clock();
    const timeLimitMs = settings.runTimeLimitSeconds * 1000;
    const collected: Record<"list" | "detail", FetchedRecord[]> = { list: [], detail: [] };
    const emptyApis: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let authProblem = false;
    let limitHit = false;

    for (const { name, kind } of ENDPOINTS[source]) {
      // 제한에 걸리면 남은 작업은 하지 않고 이유를 남긴다 (PRD 5-2 규칙 5)
      if (clock() - t0 >= timeLimitMs) {
        await store.log(runId, "warn", "RUN_TIME_LIMIT", `실행시간 ${settings.runTimeLimitSeconds}초 제한에 걸려 '${name}' 이후 작업을 하지 않았습니다.`);
        limitHit = true;
        break;
      }
      if (calls >= callLimit) {
        await store.log(runId, "warn", "CALL_LIMIT_REACHED", `호출 상한 ${callLimit}회에 도달해 '${name}' 이후 작업을 하지 않았습니다.`);
        limitHit = true;
        break;
      }

      const result: ApiFetchResult = await fetcher(name);
      calls += 1;
      await store.recordApiCheck(runId, result);

      if (result.outcome === "success") {
        succeeded += 1;
        collected[kind] = result.records;
        await store.saveCollected(runId, source, kind, result.records);
      } else if (result.outcome === "empty_result") {
        succeeded += 1; // 응답은 정상으로 왔다. 0건이 문제인지는 API별 허용 여부로 따로 정한다 (PRD 5-2 규칙 4)
        const allowed = settings.emptyAllowedByEndpoint[name];
        if (allowed === undefined) throw new Error(`'${name}'의 빈 결과 허용 여부가 설정값에 없습니다.`);
        if (!allowed) emptyApis.push(name);
      } else if (result.outcome === "auth_or_quota") {
        failed += 1;
        authProblem = true;
        await store.log(runId, "error", "AUTH_OR_QUOTA", `'${name}' 호출에서 서비스키 또는 호출 한도 문제가 있었습니다.`);
      } else {
        failed += 1;
        await store.log(runId, "warn", result.outcome === "timeout" ? "API_TIMEOUT" : "API_HTTP_ERROR", `'${name}' 호출이 실패했습니다 (${result.outcome}).`);
      }
    }

    // 탐지: 서비스키·한도 문제가 있었던 실행에서는 건너뛴다 (PRD 5-2 규칙 6)
    const detections: EngineDetection[] = [];
    if (authProblem) {
      await store.log(runId, "warn", "DETECTION_SKIPPED", "서비스키·한도 문제가 있어 이 실행에서는 이상징후 탐지를 하지 않았습니다.");
    } else {
      const windowSeconds = settings.compareWindowMinutes * 60;
      const byKey = (records: FetchedRecord[]) => new Map(records.map((r) => [r.itemKey, r]));
      const lists = byKey(collected.list);
      const details = byKey(collected.detail);
      const itemKeys = [...new Set([...lists.keys(), ...details.keys()])].sort();

      const skipped: Record<string, string[]> = {};
      for (const itemKey of itemKeys) {
        const list = lists.get(itemKey);
        const detail = details.get(itemKey);
        const detection = detectItem(
          { list: list ? { fields: list.fields as Record<string, unknown>, collectedAtMs: list.collectedAtMs } : null, detail: detail ? { fields: detail.fields as Record<string, unknown>, collectedAtMs: detail.collectedAtMs } : null },
          windowSeconds,
        );
        for (const ruleId of detection.rules) {
          const built = buildDetectionEvidence(ruleId, list?.fields ?? null, detail?.fields ?? null, detection.listDetail);
          detections.push({ source, itemKey, ruleId, detection, ...built });
        }
        if (detection.listDetail.outcome === "skipped") (skipped[detection.listDetail.reason] ??= []).push(itemKey);
      }

      // 비교 제외 사유는 물건마다 한 줄씩 남기면 너무 많아져서 사유별로 묶어 1줄(건수 + 예시)로 남긴다
      for (const [reason, keys] of Object.entries(skipped)) {
        await store.log(runId, "info", "COMPARE_SKIPPED", `목록·상세 비교 제외 ${keys.length}건 (${reason}) 예: ${keys.slice(0, 3).join(", ")}`);
      }
      for (const apiName of emptyApis) detections.push({ source, itemKey: apiName, ruleId: "EMPTY_RESULT", detection: null, ...buildEmptyResultEvidence(apiName) });
    }

    // 등록: 탐지 결과를 이상징후로 저장한다. 시간 제한에 걸리면 남은 것은 등록하지 않는다 (다음 점검에서 다시 탐지된다)
    const registered = noRegistered();
    let done = 0;
    for (const detection of detections) {
      if (clock() - t0 >= timeLimitMs) {
        await store.log(runId, "warn", "RUN_TIME_LIMIT", `실행시간 ${settings.runTimeLimitSeconds}초 제한에 걸려 이상징후 ${detections.length - done}건을 등록하지 못했습니다.`);
        limitHit = true;
        break;
      }
      const { action } = await store.recordDetection({ source: detection.source, itemKey: detection.itemKey, ruleId: detection.ruleId, evidence: detection.evidence, valueHash: detection.valueHash });
      registered[action] += 1;
      done += 1;
    }
    if (done > 0) {
      await store.log(runId, "info", "DETECTIONS_RECORDED", `이상징후 등록 ${done}건: 새 건 ${registered.created}, 재발 ${registered.recurred}, 재탐지 ${registered.detected_again}, 정상 판정 건과 같은 값 ${registered.suppressed}`);
    }

    // 마감: 하나도 성공 못 했거나 서비스키·한도 문제면 실패, 일부만 됐거나 제한에 걸렸으면 일부 완료
    const status: RunStatus = authProblem || succeeded === 0 ? "failed" : failed > 0 || limitHit ? "partial" : "succeeded";
    await store.finishRun(runId, status, calls);
    return { runId, status, apiCallCount: calls, detections, registered };
  } catch (error) {
    // 실행 기록이 'running'으로 남아 다음 점검을 막지 않도록 반드시 실패로 마감한다. 내부 오류 문구는 기록에 옮기지 않는다 (SEC-11).
    void error;
    await store.log(runId, "error", "ENGINE_ERROR", "점검 중 예상하지 못한 오류가 생겨 실패로 마감했습니다.");
    await store.finishRun(runId, "failed", calls);
    return { runId, status: "failed", apiCallCount: calls, detections: [], registered: noRegistered() };
  }
}

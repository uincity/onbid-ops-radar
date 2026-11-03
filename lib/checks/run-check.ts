// Design Ref: DESIGN §5.1 흐름 ① — 점검 실행 엔진 (PLAN 작업 22)
// 시작(중복 차단) → 조회(호출 상한·시간 제한) → 정리·저장 → 탐지(규칙 3개 + 빈 결과) → 마감.
// 탐지 결과는 저장소의 recordDetection(= DB 함수 record_detection)으로 등록한다. 중복·재발·정상 판정 억제는 DB 함수가 지킨다 (PLAN 23).
// 서비스키·한도 문제가 생긴 실행에서는 데이터 이상징후를 만들지 않는다 (PRD 5-2 규칙 6).
import { detectItem, type ItemDetection } from "@/lib/rules/detect-item";
import { detectCrossApiRef, detectListDetailRef, detectSchemaIssue } from "@/lib/rules/dq-rules";
import { profileOf } from "@/lib/rules/field-profile";
import type { Settings } from "@/lib/settings/schema";
import { findOperation } from "@/lib/registry";
import { buildDetectionEvidence, buildEmptyResultEvidence } from "./evidence";
import { buildApiDetection, countFailStreak } from "./api-streak";
import { buildListDetailRefEvidence, buildSchemaEvidence } from "./dq-evidence";
import { buildBatches, unprobeableOperations } from "./batch-plan";
import { classifyProbe } from "./probe/classify";
import { observationFromCheck, policyFromOperation } from "./probe/from-check";
import { checkReadiness } from "./probe/readiness";
import type { SchemaCheckResult } from "./probe/schema-check";
import { describeProbe, type NotRunReason, type ProbeResult, type UnverifiedReason } from "./probe/status";
import { PUBLIC_ENDPOINT_OPERATIONS } from "./public-fetcher";
import type { ApiCheckRecord, CheckStore, ProbeRecord, DetectionRecord, FetchedRecord, Fetcher, RecordAction, RunStatus, RunTrigger, RunSource } from "./types";

// 출처별로 부르는 조회 이름. 목록 → 상세 순서다.
const ENDPOINTS: Record<RunSource, { name: string; kind: "list" | "detail" }[]> = {
  DEMO: [
    { name: "demo-list", kind: "list" },
    { name: "demo-detail", kind: "detail" },
  ],
  PUBLIC: [
    { name: "public-list", kind: "list" },
    { name: "public-detail", kind: "detail" },
  ],
};

// 연속 FAIL을 세려고 읽는 과거 판정 수. 사이에 낀 검증 불가·미점검을 건너뛰어도 기준(최대 10회)에 닿을 만큼 넉넉히 읽는다
const API_STREAK_LOOKBACK = 50;

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
  // PUBLIC: 목록·상세 외에 일반 조회기로 점검할 오퍼레이션 (generic-probe.ts). 오퍼레이션마다 호출 1번이며, 호출 상한에서 이만큼을 미리 떼어 두어 목록·상세가 다 써 버리지 않게 한다
  extraEndpoints?: readonly { endpoint: string; operationKey: string }[];
};

// 점검 하나(조회 이름)의 판정 결과. PUBLIC 점검에서만 만든다 (등록부에 있는 오퍼레이션만 판정한다)
export type ProbeEntry = { endpoint: string; operationKey: string; result: ProbeResult };

export type RunCheckResult = {
  runId: number;
  status: RunStatus | "blocked";
  apiCallCount: number;
  detections: EngineDetection[];
  registered: Record<RecordAction, number>; // 등록 결과 집계
  probes: ProbeEntry[]; // 실제로 점검한 오퍼레이션의 판정 (PASS_DATA·FAIL·UNVERIFIED …)
  unprobeable: string[]; // 조회기가 없어 요청을 보내지 않고 UNVERIFIED로만 남긴 오퍼레이션 ("서비스ID/오퍼레이션ID", PUBLIC만)
};

const noRegistered = (): Record<RecordAction, number> => ({ created: 0, recurred: 0, detected_again: 0, suppressed: 0 });

// 점검 이름 → "서비스ID/오퍼레이션ID" (전용 조회기 2개 + 일반 조회기로 점검하는 추가 오퍼레이션)
type KeyOf = (endpoint: string) => string;

// 요청을 보내지 못했거나 판단할 수 없는 점검들의 판정 목록 (PUBLIC만)
function unprobed(source: RunSource, endpoints: readonly string[], why: { notRun?: NotRunReason; unverified?: UnverifiedReason }, keyOf: KeyOf): ProbeEntry[] {
  if (source !== "PUBLIC") return [];
  return endpoints.map((endpoint) => ({
    endpoint,
    operationKey: keyOf(endpoint),
    result: why.unverified ? { status: "UNVERIFIED", attempted: false, reason: why.unverified } : { status: "NOT_RUN", attempted: false, reason: why.notRun ?? "BUDGET_SKIP" },
  }));
}

// 점검 판정 1줄을 DB(probe_results)에 남긴다. 요청을 못 보낸 점검은 관측값(check)이 없어 비어 있다
async function saveProbe(store: CheckStore, runId: number, source: RunSource, entry: ProbeEntry, check?: ApiCheckRecord): Promise<void> {
  const [apiId, operationId] = entry.operationKey.split("/");
  const probe: ProbeRecord = {
    apiId,
    operationId,
    result: entry.result,
    resultCode: check?.resultCode ?? null,
    httpStatus: check?.httpStatus ?? null,
    durationMs: check?.durationMs ?? null,
    recordCount: check?.recordCount ?? null,
    schema: check?.schema ?? null,
    requestSummary: check?.requestSummary ?? null,
  };
  await store.recordProbe(runId, source, probe);
}

// 요청을 보낼 조회기가 없는 오퍼레이션을 UNVERIFIED(승인 미확인 등)로 남긴다. 분모에는 들어가지만 정상·실패로 세지 않는다 (PRD 3-3).
// 서비스 25종을 서비스 단위 배치로 나눈 계획에서 가져온다. 한 오퍼레이션의 저장 실패가 다른 기록을 막지 않게 하나씩 처리한다.
async function saveUnprobeable(store: CheckStore, runId: number, source: RunSource, callable: Readonly<Record<string, string>>): Promise<string[]> {
  if (source !== "PUBLIC") return [];
  const keys: string[] = [];
  for (const op of unprobeableOperations(buildBatches(callable))) {
    await store.recordProbe(runId, source, {
      apiId: op.serviceId,
      operationId: op.operationId,
      result: { status: "UNVERIFIED", attempted: false, reason: op.notReadyReason },
      resultCode: null,
      httpStatus: null,
      durationMs: null,
      recordCount: null,
      schema: null,
      requestSummary: null,
    });
    keys.push(op.key);
  }
  return keys;
}

export async function runCheck(input: RunCheckInput): Promise<RunCheckResult> {
  const { trigger, source, settings, store, fetcher, clock = Date.now } = input;

  // 시작 전에 막을 수 있는 잘못된 요청은 실행 기록을 만들지 않고 거부한다
  const callLimit = input.callLimit ?? settings.apiCallLimitDefault;
  if (!Number.isInteger(callLimit) || callLimit < 1 || callLimit > settings.apiCallLimitMax) {
    throw new Error(`호출 상한은 1~${settings.apiCallLimitMax} 사이의 정수여야 합니다.`);
  }

  // PUBLIC: 점검 이름 → 등록부 오퍼레이션. 추가 오퍼레이션은 목록·상세 뒤에 오퍼레이션마다 1번씩 점검한다
  const extras = source === "PUBLIC" ? (input.extraEndpoints ?? []) : [];
  const callable: Record<string, string> = { ...PUBLIC_ENDPOINT_OPERATIONS, ...Object.fromEntries(extras.map((e) => [e.endpoint, e.operationKey])) };
  const keyOf: KeyOf = (endpoint) => callable[endpoint];
  const endpoints: { name: string; kind: "list" | "detail" | "extra" }[] = [...ENDPOINTS[source], ...extras.map((e) => ({ name: e.endpoint, kind: "extra" as const }))];
  const started = await store.startRun(trigger, source, input.triggeredBy ?? null);
  const allEndpoints = endpoints.map((e) => e.name);
  if (started.status === "blocked") {
    const blockedProbes = unprobed(source, allEndpoints, { notRun: "RUN_BLOCKED" }, keyOf);
    for (const entry of blockedProbes) await saveProbe(store, started.runId, source, entry);
    const unprobeable = await saveUnprobeable(store, started.runId, source, callable);
    return { runId: started.runId, status: "blocked", apiCallCount: 0, detections: [], registered: noRegistered(), probes: blockedProbes, unprobeable };
  }
  const runId = started.runId;

  const probes: ProbeEntry[] = [];
  let calls = 0;
  try {
    const t0 = clock();
    const profile = profileOf(source);

    // PUBLIC: 오늘(KST) 이미 쓴 호출 수를 합산해 일일 호출 예산을 넘으면 호출하지 않고 이유만 남긴다 (DESIGN 5.1 2단계).
    // 예산이 아직 정해지지 않았으면(null) 실행당 상한만 적용한다.
    let effectiveLimit = callLimit;
    if (source === "PUBLIC" && settings.publicDailyBudget !== null) {
      const left = settings.publicDailyBudget - (await store.countPublicCallsToday());
      if (left <= 0) {
        await store.log(runId, "error", "BUDGET_EXCEEDED", `PUBLIC 일일 호출 예산 ${settings.publicDailyBudget}회를 오늘 모두 써서 호출하지 않았습니다.`);
        await store.finishRun(runId, "failed", 0);
        const skipped = unprobed(source, allEndpoints, { notRun: "BUDGET_SKIP" }, keyOf);
        for (const entry of skipped) await saveProbe(store, runId, source, entry);
        const unprobeable = await saveUnprobeable(store, runId, source, callable);
        return { runId, status: "failed", apiCallCount: 0, detections: [], registered: noRegistered(), probes: skipped, unprobeable };
      }
      effectiveLimit = Math.min(callLimit, left);
    }
    // 목록·상세가 쓸 수 있는 호출 수: 추가 오퍼레이션 몫(오퍼레이션당 1번)을 미리 떼어 둔다. 추가 오퍼레이션이 없으면 전체 상한과 같다
    const mainLimit = Math.min(effectiveLimit, Math.max(2, effectiveLimit - extras.length));
    const timeLimitMs = settings.runTimeLimitSeconds * 1000;
    const collected: Record<"list" | "detail", FetchedRecord[]> = { list: [], detail: [] };
    const emptyApis: string[] = [];
    const schemas = new Map<string, SchemaCheckResult | null>(); // 점검 이름별 응답 구조 확인 결과 (DQ_SCHEMA 판정용)
    let succeeded = 0;
    let failed = 0;
    let authProblem = false;
    let limitHit = false;
    let mainLimitLogged = false;

    // 점검 하나의 판정을 모으고 DB(probe_results)와 실행 메모(PROBE_RESULT)로 남긴다 (PUBLIC만)
    const record = async (endpoint: string, result: ProbeResult, check?: ApiCheckRecord) => {
      const operationKey = keyOf(endpoint);
      const entry: ProbeEntry = { endpoint, operationKey, result };
      probes.push(entry);
      await saveProbe(store, runId, source, entry, check);
      await store.log(runId, result.status === "FAIL" ? "warn" : "info", "PROBE_RESULT", `'${endpoint}' 점검 판정: ${describeProbe(result)}`);
    };

    for (const { name, kind } of endpoints) {
      // 제한에 걸리면 남은 작업은 하지 않고 이유를 남긴다 (PRD 5-2 규칙 5)
      if (clock() - t0 >= timeLimitMs) {
        await store.log(runId, "warn", "RUN_TIME_LIMIT", `실행시간 ${settings.runTimeLimitSeconds}초 제한에 걸려 '${name}' 이후 작업을 하지 않았습니다.`);
        limitHit = true;
        break;
      }
      // 목록·상세는 미리 떼어 둔 추가 오퍼레이션 몫을 쓰지 못한다. 한도에 닿아도 추가 오퍼레이션은 자기 몫으로 계속한다
      const limitForThis = kind === "extra" ? effectiveLimit : mainLimit;
      if (calls >= limitForThis) {
        if (kind === "extra" || !mainLimitLogged) {
          await store.log(runId, "warn", "CALL_LIMIT_REACHED", `호출 상한 ${limitForThis}회에 도달해 '${name}' 이후 작업을 하지 않았습니다.`);
          if (kind !== "extra") mainLimitLogged = true;
        }
        limitHit = true;
        if (kind === "extra") break; // 추가 오퍼레이션은 한도에 닿으면 남은 것도 하지 않는다(아래에서 미점검으로 남긴다)
        continue;
      }

      // PUBLIC: 보내기 전에 "점검할 수 있는 상태인가"를 확인한다. 입력값이 없거나 선행 점검이 실패했으면 요청하지 않고 검증 불가로 남긴다 (장애로 세지 않음)
      const op = source === "PUBLIC" ? findOperation(keyOf(name) ?? "") : undefined;
      if (source === "PUBLIC") {
        if (!op) throw new Error(`'${name}'에 해당하는 서비스 등록부 오퍼레이션이 없습니다.`);
        const preceding = kind === "detail" ? probes.find((p) => p.endpoint === ENDPOINTS[source].find((e) => e.kind === "list")?.name) : undefined;
        // 선행 목록이 실패했어도 쓸 수 있는 식별 입력값을 이미 얻었다면(예: 응답 구조 경고뿐) 상세 점검은 계속한다
        const reason = checkReadiness(op.operation, { hasValidInput: kind !== "detail" || collected.list.length > 0, precedingFailed: preceding?.result.status === "FAIL" && collected.list.length === 0 });
        if (reason) {
          await record(name, { status: "UNVERIFIED", attempted: false, reason });
          continue;
        }
      }

      // 조회기가 예외를 던져도 그 점검 하나만 판단 불가로 남기고 다음 점검은 계속한다 (한 API의 문제가 다른 API를 막지 않는다, PRD R04)
      // 조회기가 던진 예외는 우리 쪽 문제일 수 있어 API 장애(FAIL)로 단정하지 않고 UNVERIFIED로 남긴다. 내부 오류 문구는 기록하지 않는다 (SEC-11).
      let result: Awaited<ReturnType<Fetcher>>;
      try {
        result = await fetcher(name, { remainingCalls: limitForThis - calls, remainingMs: timeLimitMs - (clock() - t0) });
      } catch {
        failed += 1;
        await store.log(runId, "error", "FETCH_ERROR", `'${name}' 조회 중 예상하지 못한 오류가 있어 이 점검만 건너뛰고 계속합니다.`);
        if (op) await record(name, { status: "UNVERIFIED", attempted: true, reason: "PRECONDITION_FAILED" });
        continue;
      }
      calls += result.httpCalls ?? 1; // 조회 하나가 실제 호출을 여러 번 했으면(PUBLIC 상세) 그만큼 센다
      const checks: ApiCheckRecord[] = result.subChecks ?? [result]; // 호출 1번마다 api_checks 한 줄
      for (const check of checks) await store.recordApiCheck(runId, check);
      schemas.set(name, result.schema ?? null);
      if (op) await record(name, classifyProbe({ policy: policyFromOperation(op.operation), observation: observationFromCheck(result) }), result);

      if (result.outcome === "success") {
        succeeded += 1;
        // 추가 오퍼레이션은 점검 판정에만 쓰고 응답 데이터는 저장하지 않는다
        if (kind !== "extra") {
          collected[kind] = result.records;
          await store.saveCollected(runId, source, kind, result.records);
        }
      } else if (result.outcome === "empty_result") {
        succeeded += 1; // 응답은 정상으로 왔다. 0건이 문제인지는 API별 허용 여부로 따로 정한다 (PRD 5-2 규칙 4)
        // 기존 정책(EMPTY_RESULT)은 DEMO에서만 쓴다. PUBLIC의 0건은 이상징후를 만들지 않고 점검 판정(PASS_NO_DATA·UNVERIFIED)으로만 남긴다 (PRD 5-2-3)
        if (source !== "PUBLIC") {
          const allowed = settings.emptyAllowedByEndpoint[name];
          if (allowed === undefined) throw new Error(`'${name}'의 빈 결과 허용 여부가 설정값에 없습니다.`);
          if (!allowed) emptyApis.push(name);
        }
      } else if (result.outcome === "auth_or_quota") {
        failed += 1;
        authProblem = true;
        await store.log(runId, "error", "AUTH_OR_QUOTA", `'${name}' 호출에서 서비스키 또는 호출 한도 문제가 있었습니다.`);
        break; // 키·한도 문제가 난 뒤에는 더 부르지 않는다
      } else {
        failed += 1;
        await store.log(runId, "warn", result.outcome === "timeout" ? "API_TIMEOUT" : "API_HTTP_ERROR", `'${name}' 호출이 실패했습니다 (${result.outcome}).`);
      }
    }

    // 호출 상한·시간 제한으로 시도하지 못했거나(미점검), 선행 점검의 서비스키·한도 문제로 판단할 수 없는 점검을 남긴다 (PUBLIC)
    const probed = new Set(probes.map((p) => p.endpoint));
    const left = allEndpoints.filter((e) => !probed.has(e));
    if (left.length > 0) {
      for (const entry of unprobed(source, left, authProblem ? { unverified: "PRECONDITION_FAILED" } : { notRun: "BUDGET_SKIP" }, keyOf)) await record(entry.endpoint, entry.result);
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
          profile,
        );
        for (const ruleId of detection.rules) {
          // PUBLIC: 필수정보는 새 규칙 이름(DQ_REQUIRED)으로 등록하고, 날짜 역전은 PUBLIC 핵심 지표에서 제외해 등록하지 않는다 (PRD 5-2A). DEMO는 이전 이름 그대로
          if (source === "PUBLIC" && ruleId === "DATE_ORDER") continue;
          const asRule = source === "PUBLIC" && ruleId === "REQUIRED_FIELD" ? "DQ_REQUIRED" : undefined;
          const built = buildDetectionEvidence(ruleId, list?.fields ?? null, detail?.fields ?? null, detection.listDetail, profile, asRule);
          detections.push({ source, itemKey, ruleId: asRule ?? ruleId, detection, ...built });
        }
        // DQ_LIST_DETAIL_REF (PUBLIC): 목록의 식별값으로 상세를 불렀는데 다른 물건·공매조건이 돌아왔는가
        if (source === "PUBLIC") {
          const mismatches = detectListDetailRef(list?.fields ?? null, detail?.fields ?? null);
          if (mismatches.length > 0) detections.push({ source, itemKey, ruleId: "DQ_LIST_DETAIL_REF", detection: null, ...buildListDetailRefEvidence(itemKey, mismatches) });
        }
        if (detection.listDetail.outcome === "skipped") (skipped[detection.listDetail.reason] ??= []).push(itemKey);
      }

      // 비교 제외 사유는 물건마다 한 줄씩 남기면 너무 많아져서 사유별로 묶어 1줄(건수 + 예시)로 남긴다
      for (const [reason, keys] of Object.entries(skipped)) {
        await store.log(runId, "info", "COMPARE_SKIPPED", `목록·상세 비교 제외 ${keys.length}건 (${reason}) 예: ${keys.slice(0, 3).join(", ")}`);
      }
      if (source === "PUBLIC") {
        // DQ_LIST_DETAIL_REF 판정 보류: 상세가 0건인 물건은 정상 종료·철회·공고 변경과 구분할 수 없어 이상징후를 만들지 않고 보류로만 남긴다 (PRD 5-2A)
        const noCounterpart = skipped["NO_COUNTERPART"] ?? [];
        if (noCounterpart.length > 0) await store.log(runId, "info", "DQ_REF_UNVERIFIED", `DQ_LIST_DETAIL_REF 판정 보류(UNVERIFIED) ${noCounterpart.length}건: 상세 조회 결과가 없어 정상 종료·철회 등과 구분할 수 없습니다. 예: ${noCounterpart.slice(0, 3).join(", ")}`);
        // DQ_SCHEMA: 점검한 오퍼레이션의 응답 구조에서 명세의 필수 항목 누락·자료형 어긋남이 있으면 의심으로 등록한다
        for (const entry of probes) {
          const issue = detectSchemaIssue(schemas.get(entry.endpoint));
          if (!issue) continue;
          const [apiId, operationId] = entry.operationKey.split("/");
          detections.push({ source, itemKey: entry.operationKey, ruleId: "DQ_SCHEMA", detection: null, ...buildSchemaEvidence(apiId, operationId, issue) });
        }
        // DQ_CROSS_API_REF: 공식적으로 연결되는 다른 API(공고·입찰결과 등)를 아직 점검하지 않으므로 적용하지 않는다. 연결된 점검이 생기면 같은 판정 함수를 쓴다
        const cross = detectCrossApiRef(new Set(), []);
        if (cross.outcome === "NOT_APPLICABLE") await store.log(runId, "info", "DQ_CROSS_API_NOT_APPLICABLE", "DQ_CROSS_API_REF 적용 제외(NOT_APPLICABLE): 연결해서 비교할 API 점검이 아직 없습니다.");
      }
      // API 상태 이상징후 (PUBLIC): 이번에 FAIL인 오퍼레이션이 연속 N번(설정값) 실패했으면 만든다. 설정이 없으면(null) 만들지 않는다
      if (source === "PUBLIC" && settings.apiFailStreakThreshold !== null) {
        for (const entry of probes) {
          if (entry.result.status !== "FAIL") continue;
          const [apiId, operationId] = entry.operationKey.split("/");
          const history = await store.recentProbeHistory(source, apiId, operationId, API_STREAK_LOOKBACK);
          const built = buildApiDetection(apiId, operationId, countFailStreak(history), settings.apiFailStreakThreshold);
          if (built) detections.push({ source, itemKey: built.itemKey, ruleId: built.ruleId, evidence: built.evidence, valueHash: built.valueHash, detection: null });
        }
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
    // 점검 판정(FAIL·DEGRADED)도 실행 상태에 반영한다: 응답은 왔어도 구조 오류가 있으면 "성공"으로 마감하지 않는다
    const probeProblem = probes.some((p) => p.result.status === "FAIL" || p.result.status === "DEGRADED");
    const status: RunStatus = authProblem || succeeded === 0 ? "failed" : failed > 0 || limitHit || probeProblem ? "partial" : "succeeded";
    const unprobeable = await saveUnprobeable(store, runId, source, callable);
    await store.finishRun(runId, status, calls);
    return { runId, status, apiCallCount: calls, detections, registered, probes, unprobeable };
  } catch (error) {
    // 실행 기록이 'running'으로 남아 다음 점검을 막지 않도록 반드시 실패로 마감한다. 내부 오류 문구는 기록에 옮기지 않는다 (SEC-11).
    void error;
    await store.log(runId, "error", "ENGINE_ERROR", "점검 중 예상하지 못한 오류가 생겨 실패로 마감했습니다.");
    await store.finishRun(runId, "failed", calls);
    return { runId, status: "failed", apiCallCount: calls, detections: [], registered: noRegistered(), probes, unprobeable: [] };
  }
}

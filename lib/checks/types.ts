// Design Ref: DESIGN §5.1(점검 흐름), §6.1(check_runs·api_checks·run_logs·collected_items) — 점검 엔진이 쓰는 공통 모양
// 엔진은 "무엇을 조회하는지(조회기)"와 "어디에 저장하는지(저장소)"를 직접 알지 못하고, 아래 두 약속(인터페이스)으로만 대화한다.
// 그래서 DB 없이 가짜 저장소로 엔진을 빠르게 시험할 수 있고, 나중에 PUBLIC 조회기도 같은 약속만 지키면 끼워 넣을 수 있다.
import type { AnyRuleId } from "@/lib/anomalies/labels";
import type { SchemaCheckResult } from "./probe/schema-check";
import type { ProbeResult, ProbeStatus } from "./probe/status";

// api_checks.outcome 값과 같다. 서비스키·한도 문제(auth_or_quota)는 PUBLIC 조회기가 만든다.
export type ApiOutcome = "success" | "http_error" | "timeout" | "auth_or_quota" | "empty_result";

export type FetchedRecord = {
  itemKey: string; // 물건 식별값
  fields: Record<string, unknown>; // 저장이 허용된 필드만 (DEMO: 부록 B, PUBLIC: 부록 A)
  collectedAtMs: number; // 수집 시각. 목록·상세 시간차(10분) 비교에 쓴다
};

// api_checks 한 줄이 되는 "API 호출 1번의 결과"
export type ApiCheckRecord = {
  endpointName: string;
  httpStatus: number | null;
  durationMs: number;
  outcome: ApiOutcome;
  recordCount: number | null;
  dataValid: boolean | null;
  // 아래는 PUBLIC 점검이 채운다. DEMO는 비어 있다(이전 방식 그대로)
  apiId?: string | null; // 서비스 등록부의 서비스ID (SVC-API-NNN) → api_checks.api_id
  operationId?: string | null; // 오퍼레이션 ID → api_checks.operation_id
  requestSummary?: string | null; // 마스킹된 요청 요약(인증키 제외) → api_checks.request_summary
  resultCode?: string | null; // 응답 본문의 업무 결과코드 (00 정상, 03 데이터없음, 22 호출 한도 초과 …) → api_checks.result_code
  schema?: SchemaCheckResult | null; // 필수 응답 항목 확인 결과 (점검 판정에 쓰고 probe_results에 요약만 저장)
};

export type ApiFetchResult = ApiCheckRecord & {
  records: FetchedRecord[];
  // 조회 하나가 실제 호출을 여러 번 하는 경우(PUBLIC 상세: 물건마다 1번): 실제 호출 수와 호출별 결과. 없으면 호출 1번으로 본다.
  httpCalls?: number;
  subChecks?: ApiCheckRecord[];
  // PUBLIC 상세: 상세가 0건으로 와서 한 번 더 조회한 물건 수와, 그중 두 번째 조회에서 상세를 받은 수 (DQ_LIST_DETAIL_REF 판정 보류를 줄이려는 재조회)
  requeried?: { tried: number; recovered: number };
};

// 엔진이 조회기에 알려 주는 "지금 남은 한도". 조회기는 이를 넘겨 호출하지 않는다 (호출 상한 20/100회, 실행시간 60초).
export type FetchContext = { remainingCalls: number; remainingMs: number };

// 조회기: 조회 이름을 받아 결과를 돌려준다. 호출 상한·시간 제한의 최종 확인은 엔진이 한다.
export type Fetcher = (endpoint: string, context: FetchContext) => Promise<ApiFetchResult> | ApiFetchResult;

export type RunTrigger = "scheduled" | "manual";
export type RunSource = "DEMO" | "PUBLIC";
export type RunStatus = "succeeded" | "partial" | "failed";
export type LogLevel = "info" | "warn" | "error";

// 오퍼레이션별 점검 판정 1줄 (DB probe_results). 판정(result)과 그 근거가 된 관측값을 함께 담는다
export type ProbeRecord = {
  apiId: string;
  operationId: string;
  result: ProbeResult;
  resultCode: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  recordCount: number | null;
  schema: SchemaCheckResult | null;
  requestSummary: string | null;
};

// 등록할 탐지 결과 1건 (DB 함수 record_detection의 입력). 데이터 이상징후는 itemKey가 물건 식별값, EMPTY_RESULT는 API 이름이다.
export type DetectionRecord = {
  source: RunSource;
  itemKey: string;
  ruleId: AnyRuleId; // 이전 4개 + DQ_* + API_* (DB 허용 목록과 같다)
  evidence: Record<string, unknown>;
  valueHash: string;
};

// created 새 건 / recurred 종결 뒤 재발로 새 건 / detected_again 열린 건의 횟수만 갱신 / suppressed 정상 판정 건과 값이 같아 횟수만 기록
export type RecordAction = "created" | "recurred" | "detected_again" | "suppressed";

// 저장소: 점검 한 번에 필요한 기록을 남기는 곳 (실제로는 Supabase, 시험에서는 메모리)
export interface CheckStore {
  // DB 함수 start_check_run을 부른다. 이미 실행 중이면 status가 "blocked"로 돌아온다.
  startRun(trigger: RunTrigger, source: RunSource, triggeredBy: string | null): Promise<{ runId: number; status: "running" | "blocked" }>;
  recordApiCheck(runId: number, result: ApiCheckRecord): Promise<void>;
  // 오퍼레이션별 점검 판정을 probe_results에 저장한다 (PUBLIC 점검)
  recordProbe(runId: number, source: RunSource, probe: ProbeRecord): Promise<void>;
  // 한 오퍼레이션의 최근 점검 판정 (가장 최근이 먼저, 이번 실행 것 포함). 연속 FAIL을 세는 데 쓴다 (R04)
  recentProbeHistory(source: RunSource, apiId: string, operationId: string, limit: number): Promise<{ status: ProbeStatus; reason: string | null }[]>;
  // 오늘(KST) 이미 쓴 PUBLIC API 호출 수 (일일 호출 예산 확인용, DESIGN 5.1 2단계)
  countPublicCallsToday(): Promise<number>;
  // 오늘(KST) 이미 쓴 PUBLIC API 호출 수를 서비스ID(SVC-API-NNN)별로 센 것 (서비스별 일일 예산 확인용, R04)
  countPublicCallsTodayByService(): Promise<Record<string, number>>;
  saveCollected(runId: number, source: RunSource, kind: "list" | "detail", records: FetchedRecord[]): Promise<void>;
  // DB 함수 record_detection을 부른다 (중복·재발·정상 판정 억제는 DB 함수가 지킨다)
  recordDetection(detection: DetectionRecord): Promise<{ anomalyId: number; action: RecordAction }>;
  log(runId: number, level: LogLevel, code: string, message: string): Promise<void>;
  finishRun(runId: number, status: RunStatus, apiCallCount: number): Promise<void>;
}

// Design Ref: DESIGN §5.1(점검 흐름), §6.1(check_runs·api_checks·run_logs·collected_items) — 점검 엔진이 쓰는 공통 모양
// 엔진은 "무엇을 조회하는지(조회기)"와 "어디에 저장하는지(저장소)"를 직접 알지 못하고, 아래 두 약속(인터페이스)으로만 대화한다.
// 그래서 DB 없이 가짜 저장소로 엔진을 빠르게 시험할 수 있고, 나중에 PUBLIC 조회기도 같은 약속만 지키면 끼워 넣을 수 있다.
import type { DemoFields } from "@/lib/demo/types";
import type { RuleId } from "@/lib/rules/detect-item";

// api_checks.outcome 값과 같다. 서비스키·한도 문제(auth_or_quota)는 PUBLIC 조회기가 만든다.
export type ApiOutcome = "success" | "http_error" | "timeout" | "auth_or_quota" | "empty_result";

export type FetchedRecord = {
  itemKey: string; // 물건 식별값
  fields: DemoFields;
  collectedAtMs: number; // 수집 시각. 목록·상세 시간차(10분) 비교에 쓴다
};

export type ApiFetchResult = {
  endpointName: string;
  httpStatus: number | null;
  durationMs: number;
  outcome: ApiOutcome;
  recordCount: number | null;
  dataValid: boolean | null;
  records: FetchedRecord[];
};

// 조회기: 조회 이름을 받아 결과를 돌려준다. 실제 호출 한도·시간 제한은 엔진이 지킨다.
export type Fetcher = (endpoint: string) => Promise<ApiFetchResult> | ApiFetchResult;

export type RunTrigger = "scheduled" | "manual";
export type RunSource = "DEMO" | "PUBLIC";
export type RunStatus = "succeeded" | "partial" | "failed";
export type LogLevel = "info" | "warn" | "error";

// 등록할 탐지 결과 1건 (DB 함수 record_detection의 입력). 데이터 이상징후는 itemKey가 물건 식별값, EMPTY_RESULT는 API 이름이다.
export type DetectionRecord = {
  source: RunSource;
  itemKey: string;
  ruleId: RuleId | "EMPTY_RESULT";
  evidence: Record<string, unknown>;
  valueHash: string;
};

// created 새 건 / recurred 종결 뒤 재발로 새 건 / detected_again 열린 건의 횟수만 갱신 / suppressed 정상 판정 건과 값이 같아 횟수만 기록
export type RecordAction = "created" | "recurred" | "detected_again" | "suppressed";

// 저장소: 점검 한 번에 필요한 기록을 남기는 곳 (실제로는 Supabase, 시험에서는 메모리)
export interface CheckStore {
  // DB 함수 start_check_run을 부른다. 이미 실행 중이면 status가 "blocked"로 돌아온다.
  startRun(trigger: RunTrigger, source: RunSource, triggeredBy: string | null): Promise<{ runId: number; status: "running" | "blocked" }>;
  recordApiCheck(runId: number, result: ApiFetchResult): Promise<void>;
  saveCollected(runId: number, source: RunSource, kind: "list" | "detail", records: FetchedRecord[]): Promise<void>;
  // DB 함수 record_detection을 부른다 (중복·재발·정상 판정 억제는 DB 함수가 지킨다)
  recordDetection(detection: DetectionRecord): Promise<{ anomalyId: number; action: RecordAction }>;
  log(runId: number, level: LogLevel, code: string, message: string): Promise<void>;
  finishRun(runId: number, status: RunStatus, apiCallCount: number): Promise<void>;
}

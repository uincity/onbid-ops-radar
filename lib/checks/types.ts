// Design Ref: DESIGN §5.1(점검 흐름), §6.1(check_runs·api_checks·run_logs·collected_items) — 점검 엔진이 쓰는 공통 모양
// 엔진은 "무엇을 조회하는지(조회기)"와 "어디에 저장하는지(저장소)"를 직접 알지 못하고, 아래 두 약속(인터페이스)으로만 대화한다.
// 그래서 DB 없이 가짜 저장소로 엔진을 빠르게 시험할 수 있고, 나중에 PUBLIC 조회기도 같은 약속만 지키면 끼워 넣을 수 있다.
import type { DemoFields } from "@/lib/demo/types";

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

// 저장소: 점검 한 번에 필요한 기록을 남기는 곳 (실제로는 Supabase, 시험에서는 메모리)
export interface CheckStore {
  // DB 함수 start_check_run을 부른다. 이미 실행 중이면 status가 "blocked"로 돌아온다.
  startRun(trigger: RunTrigger, source: RunSource, triggeredBy: string | null): Promise<{ runId: number; status: "running" | "blocked" }>;
  recordApiCheck(runId: number, result: ApiFetchResult): Promise<void>;
  saveCollected(runId: number, source: RunSource, kind: "list" | "detail", records: FetchedRecord[]): Promise<void>;
  log(runId: number, level: LogLevel, code: string, message: string): Promise<void>;
  finishRun(runId: number, status: RunStatus, apiCallCount: number): Promise<void>;
}

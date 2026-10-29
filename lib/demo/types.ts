// Design Ref: DESIGN §10(DEMO 시나리오 160건), PRD 부록 B(DEMO 가상 스키마)
// data/demo/scenarios.json의 모양. DEMO 조회기(PLAN 21번)와 탐지 규칙 시험(PLAN 18~20번)이 함께 쓴다.

export type DemoRuleId = "DATE_ORDER" | "REQUIRED_FIELD" | "LIST_DETAIL_MISMATCH";

// 목록·상세 비교 결과: 비교함 / 수집 시각 차이가 10분을 넘어 제외 / 목록 또는 상세가 없어 비교할 수 없음
export type DemoListDetailOutcome = "compared" | "skipped:WINDOW_EXCEEDED" | "skipped:NO_COUNTERPART";

// 부록 B의 6개 필드. 값이 없거나(필드 자체가 없음) 비어 있거나(null) 형식이 틀린 "원본 이상 데이터"도 담아야 하므로 값의 종류는 정해 두지 않는다.
export type DemoFields = {
  demo_item_id?: unknown;
  item_name?: unknown;
  org_name?: unknown;
  bid_start_at?: unknown;
  bid_end_at?: unknown;
  item_status?: unknown;
};

export type DemoScenario = {
  id: string; // DEMO-0001 ~ DEMO-0160 (물건 식별값, demo_item_id와 같다)
  group: "normal" | "anomaly" | "boundary";
  category: "NORMAL" | DemoRuleId;
  title: string; // 이 시나리오가 무엇을 시험하는지 한국어 한 줄
  expected: { rules: DemoRuleId[]; listDetail: DemoListDetailOutcome };
  detailOffsetSeconds: number; // 상세 수집 시각 − 목록 수집 시각(초). 음수면 상세를 먼저 수집
  list: DemoFields | null; // 목록 조회 결과 (없으면 null)
  detail: DemoFields | null; // 상세 조회 결과 (없으면 null)
};

export type DemoScenarioFile = {
  version: number;
  description: string;
  source: "DEMO";
  compareWindowSeconds: number;
  scenarios: DemoScenario[];
};

// 이상징후 화면들이 함께 쓰는 한국어 표시 이름 (대시보드·목록·상세·이력·보고서가 같은 말을 쓰도록 한곳에 둔다)
// 탐지 결과는 "오류"가 아니라 항상 "이상징후"로 표현한다 (CLAUDE.md 도메인 규칙).

export const STATUSES = ["open", "investigating", "resolved", "dismissed"] as const;
export type AnomalyStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<AnomalyStatus, string> = {
  open: "미확인",
  investigating: "검토 중",
  resolved: "조치 완료",
  dismissed: "정상 판정",
};

export const VERDICTS = ["undetermined", "confirmed_issue", "false_positive"] as const;
export type AnomalyVerdict = (typeof VERDICTS)[number];
export const VERDICT_LABEL: Record<AnomalyVerdict, string> = {
  undetermined: "미판정",
  confirmed_issue: "실제 이상 확인",
  false_positive: "정상(오탐)",
};

// 이전 규칙 4개 (기존 기록·DEMO 회귀 테스트 보존). 대시보드·보고서의 "규칙별 신규" 집계는 R05부터 ALL_RULE_IDS 전체를 센다
export const RULE_IDS = ["DATE_ORDER", "REQUIRED_FIELD", "LIST_DETAIL_MISMATCH", "EMPTY_RESULT"] as const;
export type RuleId = (typeof RULE_IDS)[number];

// PRD v2.0 데이터 품질 핵심 4규칙 (R06에서 구현)
export const DQ_RULE_IDS = ["DQ_SCHEMA", "DQ_REQUIRED", "DQ_LIST_DETAIL_REF", "DQ_CROSS_API_REF"] as const;

// API 상태 이상징후: 점검 판정 FAIL의 세부 오류 코드별 "API_<코드>" (대상 식별값은 "서비스ID/오퍼레이션ID"). 생성 규칙은 R04에서 정한다
// (FAIL 세부 코드 7개 앞에 "API_"를 붙인 것. 같은 값인지 tests/unit/rule-id-drift.test.ts가 확인한다)
export const API_RULE_IDS = ["API_HTTP_ERROR", "API_TIMEOUT", "API_BUSINESS_ERROR", "API_SCHEMA_ERROR", "API_POSITIVE_DATA_MISSING", "API_AUTH_ERROR", "API_QUOTA_EXCEEDED"] as const;

// DB(anomalies_rule_id_check)가 허용하는 규칙 ID 전체. 둘이 같은지 tests/unit/rule-id-drift.test.ts가 지킨다
export const ALL_RULE_IDS = [...RULE_IDS, ...DQ_RULE_IDS, ...API_RULE_IDS] as const;
export type AnyRuleId = (typeof ALL_RULE_IDS)[number];

export const RULE_LABEL: Record<AnyRuleId, string> = {
  DATE_ORDER: "날짜 정합성",
  REQUIRED_FIELD: "필수정보",
  LIST_DETAIL_MISMATCH: "목록·상세 정합성",
  EMPTY_RESULT: "API 빈 결과",
  DQ_SCHEMA: "응답 구조 변화",
  DQ_REQUIRED: "필수 항목 누락·형식 오류",
  DQ_LIST_DETAIL_REF: "목록→상세 참조 불가",
  DQ_CROSS_API_REF: "API 간 연결 불일치",
  API_HTTP_ERROR: "API 호출 오류(HTTP)",
  API_TIMEOUT: "API 시간 초과",
  API_BUSINESS_ERROR: "API 업무 결과코드 오류",
  API_SCHEMA_ERROR: "API 응답 구조 오류",
  API_POSITIVE_DATA_MISSING: "API 기대한 실데이터 없음",
  API_AUTH_ERROR: "API 서비스키·권한 문제",
  API_QUOTA_EXCEEDED: "API 호출 한도 초과",
};

export const SOURCES = ["DEMO", "PUBLIC"] as const;
export type Source = (typeof SOURCES)[number];

export const EVENT_TYPE_LABEL: Record<string, string> = {
  created: "최초 탐지",
  detected_again: "다시 탐지됨",
  assigned: "담당자 배정",
  status_changed: "처리상태 변경",
  verdict_changed: "판정 변경",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "실행 중",
  succeeded: "완료",
  partial: "일부 완료",
  failed: "실패",
  blocked: "차단됨(이미 실행 중)",
};

export const RUN_TRIGGER_LABEL: Record<string, string> = { scheduled: "예약", manual: "수동" };

export const API_OUTCOME_LABEL: Record<string, string> = {
  success: "성공",
  http_error: "HTTP 오류",
  timeout: "타임아웃",
  auth_or_quota: "서비스키·한도 문제",
  empty_result: "빈 결과",
};

// 모르는 값이 와도 화면이 깨지지 않게, 이름이 없으면 원래 값을 그대로 보여 준다
export const labelOf = (table: Record<string, string>, key: string | null | undefined) => (key == null ? "-" : (table[key] ?? key));

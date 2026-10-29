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

export const RULE_IDS = ["DATE_ORDER", "REQUIRED_FIELD", "LIST_DETAIL_MISMATCH", "EMPTY_RESULT"] as const;
export type RuleId = (typeof RULE_IDS)[number];
export const RULE_LABEL: Record<RuleId, string> = {
  DATE_ORDER: "날짜 정합성",
  REQUIRED_FIELD: "필수정보",
  LIST_DETAIL_MISMATCH: "목록·상세 정합성",
  EMPTY_RESULT: "API 빈 결과",
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

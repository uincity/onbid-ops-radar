// Design Ref: PRD 5-2 규칙 2 / 부록 B — 탐지 규칙 2: 필수정보·형식 (REQUIRED_FIELD)
// 순수 함수다. 부록 B의 DEMO 가상 스키마 필드만 검사하고, 부록에 없는 필드는 만들지 않는다.
import { parseIsoInstant } from "./iso-datetime";

export const REQUIRED_FIELD_RULE_ID = "REQUIRED_FIELD" as const;

const REQUIRED_KEYS = ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"] as const;
const DATE_KEYS = new Set<string>(["bid_start_at", "bid_end_at"]);
const ITEM_ID_PATTERN = /^DEMO-\d{4}$/;
const ALLOWED_STATUSES = ["ready", "bidding", "closed"];

export type RequiredFieldInput = Record<string, unknown>;

export type RequiredFieldProblem = {
  field: string;
  reason: "MISSING" | "BAD_FORMAT"; // 없음·null·공백 / 형식 오류
};

export type RequiredFieldFinding = {
  ruleId: typeof REQUIRED_FIELD_RULE_ID;
  problems: RequiredFieldProblem[];
};

const isBlank = (v: unknown) => typeof v !== "string" || v.trim() === "";

// 문제가 있으면 어떤 필드가 왜 문제인지 모두 담아 돌려주고, 없으면 null
export function detectRequiredField(input: RequiredFieldInput): RequiredFieldFinding | null {
  const problems: RequiredFieldProblem[] = [];

  for (const key of REQUIRED_KEYS) {
    const value = input[key];
    if (isBlank(value)) problems.push({ field: key, reason: "MISSING" });
    else if (DATE_KEYS.has(key) && parseIsoInstant(value) === null) problems.push({ field: key, reason: "BAD_FORMAT" });
    else if (key === "demo_item_id" && !ITEM_ID_PATTERN.test(value as string)) problems.push({ field: key, reason: "BAD_FORMAT" });
  }

  // item_status는 선택이지만, 있으면 허용된 소문자 값이어야 한다
  if (input.item_status !== undefined && !ALLOWED_STATUSES.includes(input.item_status as string)) {
    problems.push({ field: "item_status", reason: "BAD_FORMAT" });
  }

  return problems.length > 0 ? { ruleId: REQUIRED_FIELD_RULE_ID, problems } : null;
}

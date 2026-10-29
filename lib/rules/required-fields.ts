// Design Ref: PRD 5-2 규칙 2 / 부록 B — 탐지 규칙 2: 필수정보·형식 (REQUIRED_FIELD)
// 순수 함수다. 검사할 필드는 출처별 프로필(DEMO: 부록 B, PUBLIC: 부록 A)이 정한다. 부록에 없는 필드는 만들지 않는다.
import { DEMO_PROFILE, type FieldProfile } from "./field-profile";

export const REQUIRED_FIELD_RULE_ID = "REQUIRED_FIELD" as const;


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
export function detectRequiredField(input: RequiredFieldInput, profile: FieldProfile = DEMO_PROFILE): RequiredFieldFinding | null {
  const problems: RequiredFieldProblem[] = [];

  const dateFields = new Set([profile.startField, profile.endField]);
  for (const key of profile.requiredFields) {
    const value = input[key];
    if (isBlank(value)) problems.push({ field: key, reason: "MISSING" });
    else if (dateFields.has(key) && profile.parseDate(value) === null) problems.push({ field: key, reason: "BAD_FORMAT" });
    else if (key === profile.idField && profile.idPattern && !profile.idPattern.test(value as string)) problems.push({ field: key, reason: "BAD_FORMAT" });
  }

  // 선택이지만, 있으면 허용된 값이어야 하는 필드 (DEMO의 item_status)
  const optional = profile.optionalEnum;
  if (optional && input[optional.field] !== undefined && !optional.allowed.includes(input[optional.field] as string)) {
    problems.push({ field: optional.field, reason: "BAD_FORMAT" });
  }

  return problems.length > 0 ? { ruleId: REQUIRED_FIELD_RULE_ID, problems } : null;
}

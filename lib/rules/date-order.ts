// Design Ref: DESIGN §11 / PRD 5-2 규칙 1 — 탐지 규칙 1: 날짜 정합성 (DATE_ORDER)
// 입찰종료일시가 입찰시작일시보다 "엄격히" 빠른 경우에만 이상징후다. 같은 시각은 정상이다.
// 순수 함수다. 데이터만 받아 결과만 돌려주며, DB·화면·현재 시각을 모른다. LLM도 쓰지 않는다.
import { DEMO_PROFILE, type FieldProfile } from "./field-profile";

export const DATE_ORDER_RULE_ID = "DATE_ORDER" as const;

// 이 규칙이 읽는 필드는 입찰 시작·종료 두 개뿐이다. 필드 이름과 날짜 형식은 출처별 프로필이 정한다. (DEMO: 부록 B, PUBLIC: 부록 A)
export type DateOrderInput = Record<string, unknown>;

// 이상징후의 근거. 담당자가 화면에서 "무엇이 어떻게 틀렸는지" 바로 볼 수 있게 원래 값을 그대로 담는다.
export type DateOrderFinding = {
  ruleId: typeof DATE_ORDER_RULE_ID;
  bidStartAt: string;
  bidEndAt: string;
  gapSeconds: number; // 시작이 종료보다 몇 초 늦은지 (항상 1 이상)
};

// 이상징후면 근거를, 아니면 null을 돌려준다.
// 둘 중 하나라도 없거나 올바른 날짜 형식이 아니면 순서를 따질 수 없으므로 null이다.
// (그런 경우는 필수정보 규칙 REQUIRED_FIELD가 잡는다. 한 문제를 두 규칙이 중복해서 잡지 않는다.)
export function detectDateOrder(input: DateOrderInput, profile: FieldProfile = DEMO_PROFILE): DateOrderFinding | null {
  const startValue = input[profile.startField];
  const endValue = input[profile.endField];
  const start = profile.parseDate(startValue);
  const end = profile.parseDate(endValue);
  if (start === null || end === null) return null;
  if (end >= start) return null; // 같거나 더 늦으면 정상

  return {
    ruleId: DATE_ORDER_RULE_ID,
    bidStartAt: startValue as string,
    bidEndAt: endValue as string,
    gapSeconds: Math.ceil((start - end) / 1000),
  };
}

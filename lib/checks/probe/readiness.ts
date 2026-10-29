// Design Ref: PRD 5-2-2 1단계(준비), 5-2-1(verification_state) — 점검을 보내기 전에 "점검할 수 있는 상태인가"를 확인한다
// 점검할 수 없는 이유는 장애가 아니라 UNVERIFIED(검증 불가)다. 순수 함수다. (R01 등록부의 점검 전 상태와 같은 규칙)
import type { RegistryOperation } from "@/lib/registry/schema";
import type { UnverifiedReason } from "./status";

// 다른 서비스의 응답에서 얻어야 하는 식별 파라미터
const ID_PARAMS = ["cltrMngNo", "pbctCdtnNo", "pbancMngNo"];

export type ReadinessContext = {
  // 선행 목록 조회에서 실제로 식별 입력값을 얻었는가 (식별 파라미터가 필수인 오퍼레이션에서만 쓴다)
  hasValidInput: boolean;
  // 선행 점검이 실패했는가 → 이 점검은 판단할 수 없다
  precedingFailed?: boolean;
};

export const needsIdInput = (op: Pick<RegistryOperation, "requiredParams">): boolean => op.requiredParams.some((p) => ID_PARAMS.includes(p.name));

// 점검할 수 없으면 그 이유를, 점검해도 되면 null을 돌려준다.
// 순서: 선행 실패 → 입력값 없음 → 승인 (등록부의 availabilityBeforeProbe와 같은 순서)
export function checkReadiness(op: Pick<RegistryOperation, "requiredParams" | "approval">, ctx: ReadinessContext): UnverifiedReason | null {
  if (ctx.precedingFailed) return "PRECONDITION_FAILED";
  if (needsIdInput(op) && !ctx.hasValidInput) return "NO_VALID_INPUT";
  if (op.approval === "NOT_APPROVED") return "NOT_APPROVED";
  if (op.approval === "UNCONFIRMED") return "APPROVAL_UNCONFIRMED";
  return null;
}

// Design Ref: DESIGN §6.3 — 사용자가 이상징후를 바꾸는 DB 함수 3개를 부르는 얇은 포장 (PLAN 26·27)
// DB 함수는 실패하면 메시지가 "코드" 또는 "코드:자세한 값" 모양인 오류를 낸다(SQLSTATE P0001). 이 파일이 그것을 화면용 결과로 바꾼다.
// 반드시 "로그인한 사용자의 연결"(createClient)로 불러야 한다. 함수 안에서 auth.uid()와 역할을 확인한다.
// 서버 관리용 연결(createAdminClient)로 부르면 사용자가 없어 FORBIDDEN이 된다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnomalyStatus, AnomalyVerdict } from "./labels";

export type AnomalyActionErrorCode =
  | "VERSION_CONFLICT" // 그사이 다른 사람이 바꿈 (화면을 새로고침해야 함)
  | "FORBIDDEN" // 이 역할/담당자로는 할 수 없는 동작
  | "NOT_FOUND"
  | "INVALID_TRANSITION" // 허용되지 않은 상태 전이
  | "REASON_TOO_SHORT" // 조치내용·판정 사유·재개 사유가 공백 제외 10자 미만
  | "VERDICT_MISMATCH" // 상태와 판정이 짝이 안 맞음 (resolved↔confirmed_issue, dismissed↔false_positive)
  | "ACTIVE_DUPLICATE_EXISTS" // 재개하려는데 같은 출처·물건·규칙의 열린 건이 이미 있음 (duplicateId에 그 건 번호)
  | "ALREADY_ASSIGNED" // 담당자가 이미 있는 건을 담당자가 스스로 가져가려 함
  | "NOT_INVESTIGATING" // 판정은 검토 중(investigating)에서만 바꿀 수 있음
  | "INVALID_ASSIGNEE" // 존재하지 않는 담당자
  | "UNKNOWN";

export type AnomalyActionResult =
  | { ok: true; version: number } // 변경 뒤의 새 버전 번호
  | { ok: false; code: AnomalyActionErrorCode; message: string; duplicateId?: number };

export const ACTION_ERROR_MESSAGE: Record<AnomalyActionErrorCode, string> = {
  VERSION_CONFLICT: "그사이 다른 사람이 이 이상징후를 바꿨습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  FORBIDDEN: "이 동작을 할 권한이 없습니다.",
  NOT_FOUND: "이상징후를 찾을 수 없습니다.",
  INVALID_TRANSITION: "허용되지 않는 처리상태 변경입니다.",
  REASON_TOO_SHORT: "사유(조치내용)는 공백을 뺀 10자 이상 적어 주세요.",
  VERDICT_MISMATCH: "처리상태와 판정이 맞지 않습니다. (조치 완료는 '실제 이상 확인', 정상 판정은 '정상(오탐)'이어야 합니다)",
  ACTIVE_DUPLICATE_EXISTS: "같은 물건·규칙의 열린 이상징후가 이미 있어 재개할 수 없습니다.",
  ALREADY_ASSIGNED: "이미 담당자가 있는 이상징후입니다.",
  NOT_INVESTIGATING: "판정은 '검토 중'일 때만 바꿀 수 있습니다.",
  INVALID_ASSIGNEE: "존재하지 않는 담당자입니다.",
  UNKNOWN: "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
};

// DB 오류 메시지 → 결과. 내부 정보가 섞일 수 있는 원문은 화면에 옮기지 않는다 (SEC-11)
export function parseActionError(rawMessage: string | undefined): Extract<AnomalyActionResult, { ok: false }> {
  const [head, detail] = (rawMessage ?? "").trim().split(":");
  const code = (head in ACTION_ERROR_MESSAGE ? head : "UNKNOWN") as AnomalyActionErrorCode;
  const duplicateId = code === "ACTIVE_DUPLICATE_EXISTS" && detail && /^\d+$/.test(detail) ? Number(detail) : undefined;
  return { ok: false, code, message: ACTION_ERROR_MESSAGE[code], ...(duplicateId ? { duplicateId } : {}) };
}

function toResult(data: unknown, error: { message?: string } | null): AnomalyActionResult {
  if (error) return parseActionError(error.message);
  const version = typeof data === "number" ? data : Number(data);
  return Number.isInteger(version) ? { ok: true, version } : parseActionError(undefined);
}

// 담당자 배정: 운영 담당자는 담당자 없는 건을 본인에게만, 팀장은 누구에게나 지정·재배정. 상태는 바꾸지 않는다.
export async function assignAnomaly(supabase: SupabaseClient, input: { id: number; assigneeId: string; expectedVersion: number }): Promise<AnomalyActionResult> {
  const { data, error } = await supabase.rpc("assign_anomaly", { p_id: input.id, p_assignee: input.assigneeId, p_expected_version: input.expectedVersion });
  return toResult(data, error);
}

// 판정만 변경: 검토 중(investigating)에서만 가능
export async function setVerdict(supabase: SupabaseClient, input: { id: number; verdict: AnomalyVerdict; expectedVersion: number }): Promise<AnomalyActionResult> {
  const { data, error } = await supabase.rpc("set_verdict", { p_id: input.id, p_verdict: input.verdict, p_expected_version: input.expectedVersion });
  return toResult(data, error);
}

// 상태 변경: 허용 전이·판정 짝·10자 사유를 DB가 확인한다. verdict는 resolved(confirmed_issue)·dismissed(false_positive)로 닫을 때 넘긴다.
export async function changeAnomalyStatus(
  supabase: SupabaseClient,
  input: { id: number; toStatus: AnomalyStatus; verdict?: AnomalyVerdict | null; note?: string | null; expectedVersion: number },
): Promise<AnomalyActionResult> {
  const { data, error } = await supabase.rpc("change_anomaly_status", {
    p_id: input.id,
    p_to_status: input.toStatus,
    p_verdict: input.verdict ?? null,
    p_note: input.note ?? null,
    p_expected_version: input.expectedVersion,
  });
  return toResult(data, error);
}

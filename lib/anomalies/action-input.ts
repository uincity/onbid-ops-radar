// 이상징후 처리 서버 액션의 "입력 검사"와 "어떤 DB 함수를 어떻게 부를지" 정하는 순수 함수 모음 (PLAN 26·27)
// 서버 액션(app/(app)/anomalies/[id]/actions.ts)이 이 파일을 쓰고, 화면은 결과 타입(ActionState)을 쓴다.
// DB·로그인 없이 시험할 수 있도록 일부러 순수하게 둔다. 진짜 권한·전이 검사는 DB 함수가 한다.
import { z } from "zod";
import { VERDICTS, type AnomalyStatus, type AnomalyVerdict } from "./labels";
import type { AnomalyActionErrorCode } from "./rpc";
import { REASON_MAX_LENGTH, isReasonLongEnough } from "./reason-length";

// 화면이 서버 액션 결과로 받는 단순 객체
export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string; version: number }
  | { status: "error"; code: AnomalyActionErrorCode | "INVALID_INPUT"; message: string; duplicateId?: number };

export const INITIAL_ACTION_STATE: ActionState = { status: "idle" };

export const INTENTS = ["assign", "start_review", "save_verdict", "close_resolved", "close_dismissed", "reopen"] as const;
export type ActionIntent = (typeof INTENTS)[number];

export const SUCCESS_MESSAGE: Record<ActionIntent, string> = {
  assign: "담당자를 저장했습니다.",
  start_review: "검토를 시작했습니다. 처리상태가 '검토 중'으로 바뀌었습니다.",
  save_verdict: "판정을 저장했습니다.",
  close_resolved: "조치 완료로 닫았습니다.",
  close_dismissed: "정상 판정으로 닫았습니다.",
  reopen: "검토를 다시 시작했습니다. 판정은 '미판정'으로 돌아갔습니다.",
};

const idSchema = z.coerce.number().int().positive();
const versionSchema = z.coerce.number().int().min(1);
const uuidSchema = z.uuid();
const verdictSchema = z.enum(VERDICTS);
// 사유: 전체 길이 상한 2000자, 공백 제외 10자 이상 (DB도 다시 확인한다)
const reasonSchema = z
  .string()
  .max(REASON_MAX_LENGTH, `사유는 ${REASON_MAX_LENGTH}자 이하로 적어 주세요.`)
  .refine(isReasonLongEnough, { message: "사유(조치내용)는 공백을 뺀 10자 이상 적어 주세요.", params: { code: "REASON_TOO_SHORT" } });

const base = { id: idSchema, expectedVersion: versionSchema };

const schemas = {
  assign: z.object({ ...base, assigneeId: uuidSchema }),
  start_review: z.object({ ...base }),
  save_verdict: z.object({ ...base, verdict: verdictSchema }),
  close_resolved: z.object({ ...base, note: reasonSchema }),
  close_dismissed: z.object({ ...base, note: reasonSchema }),
  reopen: z.object({ ...base, note: reasonSchema }),
} as const;

export type ParsedAction =
  | { intent: "assign"; id: number; expectedVersion: number; assigneeId: string }
  | { intent: "start_review"; id: number; expectedVersion: number }
  | { intent: "save_verdict"; id: number; expectedVersion: number; verdict: AnomalyVerdict }
  | { intent: "close_resolved" | "close_dismissed" | "reopen"; id: number; expectedVersion: number; note: string };

export type ParseResult =
  | { ok: true; action: ParsedAction }
  | { ok: false; code: "INVALID_INPUT" | "REASON_TOO_SHORT"; message: string };

// 폼에서 온 값(FormData를 단순 객체로 바꾼 것)을 검사한다. 모르는 동작·잘못된 값은 모두 거부.
export function parseActionInput(raw: Record<string, unknown>): ParseResult {
  const intent = raw.intent;
  if (typeof intent !== "string" || !(INTENTS as readonly string[]).includes(intent)) {
    return { ok: false, code: "INVALID_INPUT", message: "알 수 없는 요청입니다." };
  }
  const key = intent as ActionIntent;
  const parsed = schemas[key].safeParse(raw);
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some((i) => i.code === "custom");
    if (tooShort) return { ok: false, code: "REASON_TOO_SHORT", message: "사유(조치내용)는 공백을 뺀 10자 이상 적어 주세요." };
    const first = parsed.error.issues[0];
    return { ok: false, code: "INVALID_INPUT", message: first?.message && first.code === "too_big" ? first.message : "입력값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
  }
  // 사유는 앞뒤 공백만 정리해 저장한다
  const data = parsed.data as Record<string, unknown>;
  if (typeof data.note === "string") data.note = data.note.trim();
  return { ok: true, action: { intent: key, ...data } as ParsedAction };
}

// FormData → 단순 객체 (파일 값은 버린다)
export function formDataToRecord(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

// 검사를 통과한 요청이 부를 DB 함수와 인자. 종결 때 판정은 짝에 맞게 자동으로 정한다 (resolved↔confirmed_issue, dismissed↔false_positive)
export type RpcCall =
  | { fn: "assign"; id: number; assigneeId: string; expectedVersion: number }
  | { fn: "verdict"; id: number; verdict: AnomalyVerdict; expectedVersion: number }
  | { fn: "status"; id: number; toStatus: AnomalyStatus; verdict?: AnomalyVerdict; note?: string; expectedVersion: number };

export function toRpcCall(a: ParsedAction): RpcCall {
  switch (a.intent) {
    case "assign":
      return { fn: "assign", id: a.id, assigneeId: a.assigneeId, expectedVersion: a.expectedVersion };
    case "start_review":
      return { fn: "status", id: a.id, toStatus: "investigating", expectedVersion: a.expectedVersion };
    case "save_verdict":
      return { fn: "verdict", id: a.id, verdict: a.verdict, expectedVersion: a.expectedVersion };
    case "close_resolved":
      return { fn: "status", id: a.id, toStatus: "resolved", verdict: "confirmed_issue", note: a.note, expectedVersion: a.expectedVersion };
    case "close_dismissed":
      return { fn: "status", id: a.id, toStatus: "dismissed", verdict: "false_positive", note: a.note, expectedVersion: a.expectedVersion };
    case "reopen":
      return { fn: "status", id: a.id, toStatus: "investigating", note: a.note, expectedVersion: a.expectedVersion };
  }
}

// 화면 편의: 이 사용자에게 어떤 조작을 보여 줄지. (숨겨도 서버/DB가 다시 확인한다 — 이것은 권한 검사가 아니다)
export type AvailableActions = {
  selfAssign: boolean; // 운영 담당자: 담당자가 없을 때 [내가 맡기]
  assignPicker: boolean; // 팀장: 담당자 선택 + [지정/재배정]
  startReview: boolean;
  verdictAndClose: boolean; // 검토 중: 판정 저장 + 두 가지 종결
  reopen: boolean;
  blockedReason: string | null; // 처리 버튼을 못 보여 주는 이유 (운영 담당자만)
};

export function availableActions(
  anomaly: { status: string; assigneeId: string | null },
  user: { id: string; role: "operator" | "admin" },
): AvailableActions {
  const isAdmin = user.role === "admin";
  const mine = anomaly.assigneeId === user.id;
  const canProcess = isAdmin || mine;
  let blockedReason: string | null = null;
  if (!canProcess) {
    blockedReason = anomaly.assigneeId === null ? "처리하려면 먼저 [내가 맡기]로 담당자가 되어 주세요." : "다른 담당자가 맡고 있어 처리할 수 없습니다. 팀장에게 재배정을 요청해 주세요.";
  }
  return {
    selfAssign: !isAdmin && anomaly.assigneeId === null,
    assignPicker: isAdmin,
    startReview: canProcess && anomaly.status === "open",
    verdictAndClose: canProcess && anomaly.status === "investigating",
    reopen: canProcess && (anomaly.status === "resolved" || anomaly.status === "dismissed"),
    blockedReason,
  };
}

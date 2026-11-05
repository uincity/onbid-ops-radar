// Design Ref: docs/design-homepage-monitoring.md §5.3(처리표)·§5.6(등록·취소) / Plan W15 — 계획 점검 창 판정과 입력 검사 (순수: Next.js·Supabase·네트워크를 모른다)
// 하는 일:
//   · 창 안인가: 점검의 started_at이 취소되지 않은 창 [시작, 종료) 안이면 창 안 (종료 시각 정확히는 창 밖)
//   · 창의 상태 이름(진행 중/예정/끝남/취소됨)
//   · 입력 검사(Zod) + KST 입력 → `+09:00` ISO 변환. **시각 변환은 여기 한 곳에서만 한다**(DB 함수는 변환하지 않는다, 9시간이 두 번 밀리는 일 방지)
//   · DB 오류 코드 → 사용자에게 보여 줄 말
import { z } from "zod";

export type MaintenanceWindow = {
  id: number;
  targetKey: string;
  startsAt: string; // ISO(UTC)
  endsAt: string; // ISO(UTC). 진행 중에 취소했으면 취소 시각으로 당겨져 있다
  reason: string;
  createdAt: string;
  cancelledAt: string | null;
};

export const WINDOW_REASON_MAX = 200;

const ms = (iso: string) => Date.parse(iso);

/** 판정에 쓰이는 창인가: 취소되지 않았거나, 시작한 뒤에 취소된 창(종료 시각이 당겨진 창). 시작 전에 취소된 창은 빠진다 */
export const isEffectiveWindow = (w: Pick<MaintenanceWindow, "startsAt" | "cancelledAt">): boolean => w.cancelledAt === null || ms(w.cancelledAt) > ms(w.startsAt);

/** 이 시각이 대상의 창 [시작, 종료) 안인가 (DB 함수 web_in_maintenance와 같은 규칙) */
export function isInsideWindow(windows: readonly MaintenanceWindow[], targetKey: string, at: Date): boolean {
  const t = at.getTime();
  return windows.some((w) => w.targetKey === targetKey && isEffectiveWindow(w) && ms(w.startsAt) <= t && t < ms(w.endsAt));
}

export type WindowState = "active" | "upcoming" | "ended" | "cancelled";

/** 화면에 보이는 창의 상태: 취소된 창은 어느 때든 "취소됨" */
export function windowState(w: MaintenanceWindow, now: Date): WindowState {
  if (w.cancelledAt !== null) return "cancelled";
  const t = now.getTime();
  if (t < ms(w.startsAt)) return "upcoming";
  if (t < ms(w.endsAt)) return "active";
  return "ended";
}

export const WINDOW_STATE_LABEL: Record<WindowState, string> = { active: "진행 중", upcoming: "예정", ended: "끝남", cancelled: "취소됨" };

/** 같은 대상의 (취소되지 않은) 창과 [시작, 종료)가 겹치는가. 이어 붙이기(종료 = 다음 시작)는 겹침이 아니다 */
export function overlapsAny(windows: readonly MaintenanceWindow[], targetKey: string, startsAt: string, endsAt: string): boolean {
  return windows.some((w) => w.targetKey === targetKey && w.cancelledAt === null && ms(w.startsAt) < ms(endsAt) && ms(startsAt) < ms(w.endsAt));
}

// ----- 입력 검사 -----

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/; // <input type="datetime-local">의 값 (KST 벽시계)

/** "2026-11-09T23:00"(KST) → "2026-11-09T23:00:00+09:00". 없는 날짜·시각이면 null */
export function kstLocalToIso(text: string): string | null {
  const m = LOCAL_PATTERN.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // 2월 30일·25시 같은 값은 Date가 슬쩍 바꿔 주므로 되돌려 같은지 확인한다
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
}

const inputShape = z.object({
  targetKey: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  start: z.string(),
  end: z.string(),
  reason: z.string(),
});

export type WindowInput = { targetKey: string; startsAt: string; endsAt: string; reason: string };
export type WindowInputResult = { ok: true; value: WindowInput } | { ok: false; message: string };

export const WINDOW_INVALID_TEXT = "점검 시간 또는 사유를 확인해 주세요.";

/**
 * 폼 값 검사: 시각 모양, 종료 > 시작, 이미 끝난 창 불가, 사유 1~200자, 길이 ≤ maxHours.
 * 통과하면 `+09:00`이 붙은 ISO 시각을 돌려준다. (DB에서도 같은 검사를 다시 한다)
 */
export function parseWindowInput(raw: { targetKey: unknown; start: unknown; end: unknown; reason: unknown }, opts: { now: Date; maxHours: number }): WindowInputResult {
  const parsed = inputShape.safeParse(raw);
  if (!parsed.success) return { ok: false, message: WINDOW_INVALID_TEXT };
  const startsAt = kstLocalToIso(parsed.data.start);
  const endsAt = kstLocalToIso(parsed.data.end);
  const reason = parsed.data.reason.trim();
  if (!startsAt || !endsAt || reason.length < 1 || [...reason].length > WINDOW_REASON_MAX) return { ok: false, message: WINDOW_INVALID_TEXT };
  const startMs = ms(startsAt);
  const endMs = ms(endsAt);
  if (endMs <= startMs || endMs <= opts.now.getTime()) return { ok: false, message: WINDOW_INVALID_TEXT };
  if (endMs - startMs > opts.maxHours * 3_600_000) return { ok: false, message: `점검 창은 최대 ${opts.maxHours}시간까지 등록할 수 있습니다.` };
  return { ok: true, value: { targetKey: parsed.data.targetKey, startsAt, endsAt, reason } };
}

// ----- 오류 코드 → 사용자 문구 (DB 오류 원문은 화면에 내지 않는다) -----

export const WINDOW_ERROR_TEXT: Record<string, string> = {
  WINDOW_INVALID: WINDOW_INVALID_TEXT,
  WINDOW_NOT_FOUND: "해당 점검 창을 찾을 수 없습니다.",
  WINDOW_OVERLAP: "같은 시간대에 이미 등록된 점검 창이 있습니다. 시간을 바꾸거나 기존 창을 먼저 취소해 주세요.",
  FORBIDDEN: "계획 점검 창은 팀장만 등록·취소할 수 있습니다.",
};
export const WINDOW_FALLBACK_TEXT = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

/** DB(함수)가 돌려준 오류 문구에서 우리 코드만 골라 한국어로 바꾼다. 모르는 오류는 일반 문구로 가린다 */
export function windowErrorMessage(dbMessage: string | null | undefined): string {
  const code = (dbMessage ?? "").trim();
  return Object.hasOwn(WINDOW_ERROR_TEXT, code) ? WINDOW_ERROR_TEXT[code] : WINDOW_FALLBACK_TEXT;
}

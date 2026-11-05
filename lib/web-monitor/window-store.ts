// Design Ref: docs/design-homepage-monitoring.md §5.6·§6.3 / Plan W15 — 계획 점검 창 등록·취소 저장소 약속과 Supabase 구현
// 서버 액션이 "로그인·팀장 확인"을 한 뒤 이 약속을 부른다. Supabase 구현은 **로그인 사용자 연결**로 DB 함수를 부르므로 DB 함수가 팀장을 한 번 더 확인한다(서버 관리용 키를 쓰지 않는다).
// DB 오류 문구는 그대로 옮기지 않고 코드만 골라 돌려준다(SEC-11).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaintenanceWindow, WindowInput } from "./maintenance";

export type WindowWriteResult = { ok: true; id: number } | { ok: false; code: string };

export interface WebWindowWriter {
  create(input: WindowInput): Promise<WindowWriteResult>;
  cancel(id: number): Promise<WindowWriteResult>;
}

export const WINDOW_COLUMNS = "id, target_key, starts_at, ends_at, reason, created_at, cancelled_at";
export type WindowDbRow = { id: number; target_key: string; starts_at: string; ends_at: string; reason: string; created_at: string; cancelled_at: string | null };
export const toWindow = (r: WindowDbRow): MaintenanceWindow => ({
  id: Number(r.id), targetKey: r.target_key, startsAt: r.starts_at, endsAt: r.ends_at, reason: r.reason, createdAt: r.created_at, cancelledAt: r.cancelled_at,
});

// 우리 DB 함수가 던지는 코드 문구(P0001)만 통과시키고, 그 밖의 오류는 INTERNAL로 가린다
const KNOWN = new Set(["FORBIDDEN", "WINDOW_INVALID", "WINDOW_NOT_FOUND", "WINDOW_OVERLAP"]);
const codeOf = (message: string | undefined): string => (message && KNOWN.has(message.trim()) ? message.trim() : "INTERNAL");

export function createSupabaseWindowWriter(supabase: SupabaseClient): WebWindowWriter {
  return {
    async create(input) {
      const { data, error } = await supabase.rpc("create_maintenance_window", { p_target: input.targetKey, p_start: input.startsAt, p_end: input.endsAt, p_reason: input.reason });
      if (error || data == null) return { ok: false, code: codeOf(error?.message) };
      return { ok: true, id: Number(data) };
    },
    async cancel(id) {
      const { data, error } = await supabase.rpc("cancel_maintenance_window", { p_id: id });
      if (error || data == null) return { ok: false, code: codeOf(error?.message) };
      return { ok: true, id: Number(data) };
    },
  };
}

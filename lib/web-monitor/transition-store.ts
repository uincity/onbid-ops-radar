// Design Ref: docs/design-homepage-monitoring.md §5.2·§5.3·§6.3 / Plan W11 — 상태 전환·재확인 대기 줄 저장소 약속과 Supabase 구현
// 점검 기록(store.ts)과 분리했다: 이 약속은 "상태 읽기·전환 저장·재확인 예약·대기 줄 선점"만 안다. 가짜 저장소(store-memory.ts)로 DB 없이 시험한다.
// 서버 관리용 연결(createAdminClient)을 받는 서버 코드에서만 쓴다. DB가 돌려준 오류 문구는 그대로 옮기지 않는다(SEC-11).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransitionDecision, WebStateForDecision } from "./decide";

export type WebTransitionResult =
  | { result: "OK"; version: number; anomalyId: number | null; claimed: string[]; recovered: boolean; confirmed: boolean }
  | { result: "CONFLICT"; version: number | null };

export interface WebTransitionStore {
  /** 대상의 현재 확정 상태(첫 정시 점검 전에는 null) */
  loadState(targetKey: string): Promise<WebStateForDecision | null>;
  /** 상태 전환 저장(record_web_transition). 읽어 간 버전과 다르면 아무것도 저장하지 않고 CONFLICT */
  recordTransition(input: { runId: number; targetKey: string; expectedVersion: number | null; decision: TransitionDecision }): Promise<WebTransitionResult>;
  /** 확인 재시도 예약. 대상에 대기/처리 중 줄이 이미 있으면 null */
  enqueueConfirm(input: { targetKey: string; originRunId: number; delaySec: number }): Promise<number | null>;
}

export type RetryKind = "confirm" | "replace";
export type ClaimedRetry = { id: number; targetKey: string; kind: RetryKind; originRunId: number | null; attempts: number };
export type RetryOutcome = "done" | "cancelled" | "retry";
export type RetryOriginRun = { targetKey: string; trigger: "scheduled" | "retry" | "manual"; slotAt: Date | null };

export interface WebRetryStore {
  /** 예정 시각이 지난 가장 오래된 대기 줄 1개를 원자적으로 선점(없으면 null) */
  claimDue(): Promise<ClaimedRetry | null>;
  /** 처리 결과 기록. 처리 중인 줄만 바꾸며 바꿨으면 true */
  finish(id: number, outcome: RetryOutcome): Promise<boolean>;
  /** 원래 실행의 정보(정시 칸 시각 등). 없으면 null */
  getRun(runId: number): Promise<RetryOriginRun | null>;
}

const fail = (what: string): never => {
  throw new Error(`${what} (DB 응답 오류)`);
};

const STATE_COLUMNS =
  "current_verdict, since, first_failure_at, incident_no, incident_open, incident_last_alert_at, ongoing_count, consecutive_degraded, degraded_start_run_id, consecutive_unverifiable, unverifiable_start_run_id, aux_state, unplanned_since_run_id, unplanned_since, alerts_today, alerts_today_date, version";

export function createSupabaseWebTransitionStore(supabase: SupabaseClient): WebTransitionStore {
  return {
    async loadState(targetKey) {
      const { data, error } = await supabase.from("web_target_state").select(STATE_COLUMNS).eq("target_key", targetKey).maybeSingle();
      if (error) return fail("웹 상태를 읽지 못했습니다");
      return (data as WebStateForDecision | null) ?? null;
    },

    async recordTransition(input) {
      const { data, error } = await supabase.rpc("record_web_transition", {
        p_run_id: input.runId,
        p_target_key: input.targetKey,
        p_expected_version: input.expectedVersion,
        p_decision: input.decision,
      });
      if (error || !data) return fail("웹 상태 전환을 저장하지 못했습니다");
      if (data.result === "CONFLICT") return { result: "CONFLICT", version: data.version ?? null };
      return {
        result: "OK",
        version: Number(data.version),
        anomalyId: data.anomaly_id == null ? null : Number(data.anomaly_id),
        claimed: Array.isArray(data.claimed) ? (data.claimed as string[]) : [],
        recovered: data.recovered === true,
        confirmed: data.confirmed === true,
      };
    },

    async enqueueConfirm(input) {
      const { data, error } = await supabase.rpc("enqueue_web_confirm", { p_target: input.targetKey, p_origin_run_id: input.originRunId, p_delay_sec: input.delaySec });
      if (error) return fail("웹 확인 재시도를 예약하지 못했습니다");
      return data == null ? null : Number(data);
    },
  };
}

export function createSupabaseWebRetryStore(supabase: SupabaseClient): WebRetryStore {
  return {
    async claimDue() {
      const { data, error } = await supabase.rpc("claim_due_web_retry");
      if (error) return fail("웹 재시도 대기 줄을 선점하지 못했습니다");
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      return { id: Number(row.out_id), targetKey: row.out_target_key as string, kind: row.out_kind as RetryKind, originRunId: row.out_origin_run_id == null ? null : Number(row.out_origin_run_id), attempts: Number(row.out_attempts) };
    },

    async finish(id, outcome) {
      const { data, error } = await supabase.rpc("finish_web_retry", { p_id: id, p_outcome: outcome });
      if (error) return fail("웹 재시도 결과를 기록하지 못했습니다");
      return data === true;
    },

    async getRun(runId) {
      const { data, error } = await supabase.from("web_check_runs").select("target_key, trigger, slot_at").eq("id", runId).maybeSingle();
      if (error) return fail("웹 점검 실행을 읽지 못했습니다");
      if (!data) return null;
      return { targetKey: data.target_key as string, trigger: data.trigger as RetryOriginRun["trigger"], slotAt: data.slot_at ? new Date(data.slot_at as string) : null };
    },
  };
}

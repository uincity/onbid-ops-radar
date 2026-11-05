// Design Ref: docs/design-homepage-monitoring.md §6.3·§11 / Plan W06 — 웹 점검 기록 저장소 약속과 Supabase 구현
// 점검 실행기(runner.ts)는 DB를 직접 모르고 이 약속(WebCheckStore)만 안다. 그래서 가짜 저장소(store-memory.ts)로 DB 없이 시험할 수 있다.
// 이 파일은 연결을 직접 만들지 않고 호출하는 쪽(서버 코드)에서 서버 관리용 연결(createAdminClient)을 받는다. 화면(브라우저) 코드에서는 쓰지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProbeResult, WebVerdict } from "./classify";

export type WebRunTrigger = "scheduled" | "retry" | "manual";
export type WebRunFinalStatus = "succeeded" | "partial" | "failed";

export type StartWebRunInput = {
  targetKey: string;
  trigger: WebRunTrigger;
  triggeredBy?: string | null; // 수동 점검을 누른 팀장
  originRunId?: number | null; // 재확인이면 원래 실행
  slotAt?: Date | null; // 정시·대체 실행의 정시 칸 시각
};
export type StartWebRunResult = { runId: number; status: "running" | "blocked" };

export type FinishWebRunInput = {
  runId: number;
  status: WebRunFinalStatus;
  overallVerdict: WebVerdict | null;
  requestCount: number;
  plannedMaintenance?: boolean;
};

export interface WebCheckStore {
  // 점검 시작. 멈춘 실행 정리, 이미 실행 중이면 blocked(정시면 대체 실행 예약)는 저장소(DB 함수)가 한다
  startRun(input: StartWebRunInput): Promise<StartWebRunResult>;
  // 층별 판정 줄 저장 (응답 본문은 담기지 않는다: ProbeResult에 본문 칸이 없음)
  saveProbeResults(runId: number, targetKey: string, probes: readonly ProbeResult[]): Promise<void>;
  // 종료 기록. 실행 중인 줄만 마감하며 마감했으면 true, 이미 정리된 줄이면 false
  finishRun(input: FinishWebRunInput): Promise<boolean>;
}

// DB가 돌려준 오류 문구에는 내부 정보가 섞일 수 있어 그대로 옮기지 않는다 (SEC-11)
const fail = (what: string): never => {
  throw new Error(`${what} (DB 응답 오류)`);
};

export function createSupabaseWebStore(supabase: SupabaseClient): WebCheckStore {
  return {
    async startRun(input) {
      const { data, error } = await supabase.rpc("start_web_check_run", {
        p_target: input.targetKey,
        p_trigger: input.trigger,
        p_triggered_by: input.triggeredBy ?? null,
        p_origin_run_id: input.originRunId ?? null,
        p_slot_at: input.slotAt ? input.slotAt.toISOString() : null,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) return fail("웹 점검을 시작하지 못했습니다");
      return { runId: Number(row.out_run_id), status: row.out_status as "running" | "blocked" };
    },

    async saveProbeResults(runId, targetKey, probes) {
      if (probes.length === 0) return;
      const { error } = await supabase.from("web_probe_results").insert(
        probes.map((p) => ({
          run_id: runId,
          target_key: targetKey,
          layer: p.layer,
          counts_toward_overall: p.countsTowardOverall,
          verdict: p.verdict,
          reason: p.reason,
          http_status: p.httpStatus,
          duration_ms: p.durationMs === null ? null : Math.round(p.durationMs),
          final_url: p.finalUrl,
          cert_days_left: p.certDaysLeft,
        })),
      );
      if (error) fail("웹 점검 판정을 기록하지 못했습니다");
    },

    async finishRun(input) {
      const { data, error } = await supabase.rpc("finish_web_check_run", {
        p_run: input.runId,
        p_status: input.status,
        p_overall_verdict: input.overallVerdict,
        p_request_count: input.requestCount,
        p_planned_maintenance: input.plannedMaintenance ?? false,
      });
      if (error) return fail("웹 점검 종료를 기록하지 못했습니다");
      return data === true;
    },
  };
}

// Design Ref: DESIGN §6.4 — 점검 기록을 실제 Supabase DB에 남기는 저장소
// check_runs·api_checks·run_logs·collected_items는 서버 관리용 연결(createAdminClient)로만 쓸 수 있다.
// 이 파일은 연결을 직접 만들지 않고 호출하는 쪽에서 받는다. 화면(브라우저) 코드에서는 불러오지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiFetchResult, CheckStore, DetectionRecord, FetchedRecord, LogLevel, RecordAction, RunSource, RunStatus, RunTrigger } from "./types";

const BATCH = 100;

// DB가 돌려준 오류 문구에는 내부 정보가 섞일 수 있어 그대로 옮기지 않는다 (SEC-11)
const fail = (what: string): never => {
  throw new Error(`${what} (DB 응답 오류)`);
};

export function createSupabaseCheckStore(supabase: SupabaseClient): CheckStore {
  return {
    async startRun(trigger: RunTrigger, source: RunSource, triggeredBy: string | null) {
      const { data, error } = await supabase.rpc("start_check_run", { p_trigger: trigger, p_source: source, p_triggered_by: triggeredBy });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) return fail("점검을 시작하지 못했습니다");
      return { runId: Number(row.out_run_id), status: row.out_status as "running" | "blocked" };
    },

    async recordApiCheck(runId: number, r: ApiFetchResult) {
      const { error } = await supabase.from("api_checks").insert({
        run_id: runId,
        endpoint_name: r.endpointName,
        http_status: r.httpStatus,
        duration_ms: r.durationMs,
        outcome: r.outcome,
        record_count: r.recordCount,
        data_valid: r.dataValid,
      });
      if (error) fail("API 점검 결과를 기록하지 못했습니다");
    },

    async saveCollected(runId: number, source: RunSource, kind: "list" | "detail", records: FetchedRecord[]) {
      const rows = records.map((r) => ({ run_id: runId, source, item_key: r.itemKey, kind, fields: r.fields, collected_at: new Date(r.collectedAtMs).toISOString() }));
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await supabase.from("collected_items").insert(rows.slice(i, i + BATCH));
        if (error) fail("수집 데이터를 저장하지 못했습니다");
      }
    },

    async recordDetection(d: DetectionRecord) {
      const { data, error } = await supabase.rpc("record_detection", {
        p_source: d.source,
        p_item_key: d.itemKey,
        p_rule_id: d.ruleId,
        p_evidence: d.evidence,
        p_value_hash: d.valueHash,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) return fail("이상징후를 등록하지 못했습니다");
      return { anomalyId: Number(row.out_anomaly_id), action: row.out_action as RecordAction };
    },

    async log(runId: number, level: LogLevel, code: string, message: string) {
      const { error } = await supabase.from("run_logs").insert({ run_id: runId, level, code, message });
      if (error) fail("실행 메모를 남기지 못했습니다");
    },

    async finishRun(runId: number, status: RunStatus, apiCallCount: number) {
      const { error } = await supabase.from("check_runs").update({ status, finished_at: new Date().toISOString(), api_call_count: apiCallCount }).eq("id", runId);
      if (error) fail("점검 실행을 마감하지 못했습니다");
    },
  };
}

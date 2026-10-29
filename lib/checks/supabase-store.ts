// Design Ref: DESIGN §6.4 — 점검 기록을 실제 Supabase DB에 남기는 저장소
// check_runs·api_checks·run_logs·collected_items는 서버 관리용 연결(createAdminClient)로만 쓸 수 있다.
// 이 파일은 연결을 직접 만들지 않고 호출하는 쪽에서 받는다. 화면(브라우저) 코드에서는 불러오지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayRange, toKstDateString } from "@/lib/time";
import type { ProbeStatus } from "./probe/status";
import type { ApiCheckRecord, CheckStore, DetectionRecord, ProbeRecord, FetchedRecord, LogLevel, RecordAction, RunSource, RunStatus, RunTrigger } from "./types";

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

    async recordApiCheck(runId: number, r: ApiCheckRecord) {
      const { error } = await supabase.from("api_checks").insert({
        run_id: runId,
        endpoint_name: r.endpointName,
        http_status: r.httpStatus,
        duration_ms: r.durationMs,
        outcome: r.outcome,
        record_count: r.recordCount,
        data_valid: r.dataValid,
        api_id: r.apiId ?? null,
        operation_id: r.operationId ?? null,
        result_code: r.resultCode ?? null,
        request_summary: r.requestSummary ?? null,
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

    // 오퍼레이션별 점검 판정 1줄. 응답 본문은 저장하지 않고 응답 구조 확인 요약(누락 항목·건수)만 담는다
    async recordProbe(runId: number, source: RunSource, p: ProbeRecord) {
      const r = p.result;
      const reason = r.status === "FAIL" ? r.code : r.status === "UNVERIFIED" || r.status === "NOT_RUN" || r.status === "DEGRADED" ? r.reason : null;
      const { error } = await supabase.from("probe_results").insert({
        run_id: runId,
        source,
        api_id: p.apiId,
        operation_id: p.operationId,
        status: r.status,
        attempted: r.attempted,
        reason,
        had_data: r.status === "DEGRADED" ? r.hadData : null,
        result_code: p.resultCode,
        http_status: p.httpStatus,
        duration_ms: p.durationMs,
        record_count: p.recordCount,
        schema_summary: p.schema ? { checked: p.schema.checked, ok: p.schema.ok, inspected: p.schema.inspected, warnings: p.schema.warnings, problems: p.schema.problems.slice(0, 20).map((x) => ({ field: x.field, count: x.count })) } : null,
        request_summary: p.requestSummary,
      });
      if (error) fail("점검 판정을 기록하지 못했습니다");
    },

    async recentProbeHistory(source: RunSource, apiId: string, operationId: string, limit: number) {
      const { data, error } = await supabase
        .from("probe_results")
        .select("status, reason")
        .eq("source", source)
        .eq("api_id", apiId)
        .eq("operation_id", operationId)
        .order("id", { ascending: false })
        .limit(limit);
      if (error) return fail("최근 점검 판정을 읽지 못했습니다");
      return (data ?? []).map((r) => ({ status: r.status as ProbeStatus, reason: (r.reason as string | null) ?? null }));
    },

    // 오늘(KST) 쓴 PUBLIC API 호출 수: 어제 시작해 오늘까지 이어진 실행까지 놓치지 않도록 하루 전부터의 PUBLIC 실행을 후보로 삼는다
    async countPublicCallsToday() {
      const { start, end } = kstDayRange(toKstDateString(new Date()));
      const { data: runs, error: runError } = await supabase
        .from("check_runs")
        .select("id")
        .eq("source", "PUBLIC")
        .gte("started_at", new Date(start.getTime() - 24 * 3_600_000).toISOString())
        .lt("started_at", end.toISOString());
      if (runError) return fail("오늘 호출 수를 확인하지 못했습니다");
      const ids = (runs ?? []).map((r) => r.id);
      if (ids.length === 0) return 0;
      const { count, error } = await supabase
        .from("api_checks")
        .select("id", { count: "exact", head: true })
        .in("run_id", ids)
        .gte("checked_at", start.toISOString())
        .lt("checked_at", end.toISOString());
      if (error) return fail("오늘 호출 수를 확인하지 못했습니다");
      return count ?? 0;
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
      // 시작 시각은 DB의 시계(now())로 찍히고 종료 시각은 이 서버의 시계로 찍는다. 두 시계가 어긋나 종료가 시작보다 이르면 DB 제약(종료 ≥ 시작)이
      // 마감을 거부하고 그 점검이 running으로 남아 다음 점검을 막으므로, 종료 시각은 시작 시각보다 이르지 않게 맞춘다.
      const { data: run } = await supabase.from("check_runs").select("started_at").eq("id", runId).single();
      const startedMs = run?.started_at ? Date.parse(run.started_at) : 0;
      // +1ms: DB 시각은 마이크로초까지 있는데 JS는 밀리초까지만 읽어 잘리므로, 보정할 때는 시작 시각보다 확실히 뒤가 되게 한다
      const finishedAt = new Date(Math.max(Date.now(), Number.isFinite(startedMs) ? startedMs + 1 : 0)).toISOString();
      const { error } = await supabase.from("check_runs").update({ status, finished_at: finishedAt, api_call_count: apiCallCount }).eq("id", runId);
      if (error) fail("점검 실행을 마감하지 못했습니다");
    },
  };
}

// Supabase 저장소가 점검 기록을 DB 칸으로 옮기는 방식 시험 (R03) — 가짜 연결로 "무엇을 insert하는지"만 확인한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseCheckStore } from "@/lib/checks/supabase-store";
import type { ProbeResult } from "@/lib/checks/probe/status";
import type { ProbeRecord } from "@/lib/checks/types";

function fakeClient(error: { message: string } | null = null) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserts };
}

const probe = (result: ProbeResult, over: Partial<ProbeRecord> = {}): ProbeRecord => ({
  apiId: "SVC-API-001",
  operationId: "getRlstCltrList",
  result,
  resultCode: "00",
  httpStatus: 200,
  durationMs: 321,
  recordCount: 19,
  schema: null,
  requestSummary: "pageNo=1&numOfRows=19",
  ...over,
});

const saved = async (p: ProbeRecord, error: { message: string } | null = null) => {
  const { client, inserts } = fakeClient(error);
  await createSupabaseCheckStore(client).recordProbe(7, "PUBLIC", p);
  return inserts;
};

describe("recordProbe: 판정 → probe_results 칸", () => {
  it("PASS_DATA: 사유 없음, had_data 없음, 관측값이 그대로 들어간다", async () => {
    const [{ table, row }] = await saved(probe({ status: "PASS_DATA", attempted: true }));
    expect(table).toBe("probe_results");
    expect(row).toMatchObject({ run_id: 7, source: "PUBLIC", api_id: "SVC-API-001", operation_id: "getRlstCltrList", status: "PASS_DATA", attempted: true, reason: null, had_data: null, result_code: "00", http_status: 200, duration_ms: 321, record_count: 19, request_summary: "pageNo=1&numOfRows=19" });
  });

  it("FAIL: 세부 코드가 reason으로 들어간다", async () => {
    const [{ row }] = await saved(probe({ status: "FAIL", attempted: true, code: "QUOTA_EXCEEDED" }, { resultCode: "22", httpStatus: 200 }));
    expect(row).toMatchObject({ status: "FAIL", reason: "QUOTA_EXCEEDED", had_data: null, result_code: "22" });
  });

  it("UNVERIFIED·NOT_RUN: 사유가 들어가고 요청을 보냈는지(attempted)가 그대로다", async () => {
    const [a] = await saved(probe({ status: "UNVERIFIED", attempted: false, reason: "NO_VALID_INPUT" }, { resultCode: null, httpStatus: null, durationMs: null, recordCount: null, requestSummary: null }));
    expect(a.row).toMatchObject({ status: "UNVERIFIED", attempted: false, reason: "NO_VALID_INPUT", http_status: null, duration_ms: null, request_summary: null });
    const [b] = await saved(probe({ status: "NOT_RUN", attempted: false, reason: "RUN_BLOCKED" }));
    expect(b.row).toMatchObject({ status: "NOT_RUN", attempted: false, reason: "RUN_BLOCKED" });
  });

  it("DEGRADED: 사유와 데이터 여부(had_data)가 들어간다", async () => {
    const [yes] = await saved(probe({ status: "DEGRADED", attempted: true, reason: "FIELD_WARNING", hadData: true }));
    expect(yes.row).toMatchObject({ reason: "FIELD_WARNING", had_data: true });
    const [no] = await saved(probe({ status: "DEGRADED", attempted: true, reason: "RETRIED_THEN_OK", hadData: false }));
    expect(no.row).toMatchObject({ reason: "RETRIED_THEN_OK", had_data: false });
  });

  it("응답 구조 확인은 요약만 저장한다 (누락 항목·건수), 앞의 20개 항목까지", async () => {
    const problems = Array.from({ length: 25 }, (_, i) => ({ code: "MISSING_REQUIRED_FIELD" as const, field: `f${i}`, count: i + 1 }));
    const [{ row }] = await saved(probe({ status: "FAIL", attempted: true, code: "SCHEMA_ERROR" }, { schema: { checked: true, ok: false, inspected: 3, problems, warnings: 2 } }));
    const summary = row.schema_summary as { checked: boolean; ok: boolean; inspected: number; warnings: number; problems: { field: string; count: number }[] };
    expect(summary).toMatchObject({ checked: true, ok: false, inspected: 3, warnings: 2 });
    expect(summary.problems).toHaveLength(20);
    expect(summary.problems[0]).toEqual({ field: "f0", count: 1 });
    expect(JSON.stringify(summary)).not.toContain("code"); // 항목 이름과 건수만
  });

  it("스키마를 확인하지 못했으면 schema_summary는 null", async () => {
    const [{ row }] = await saved(probe({ status: "PASS_DATA", attempted: true }));
    expect(row.schema_summary).toBeNull();
  });

  it("DB가 거부하면 내부 오류 문구 없이 일반 문구로 멈춘다 (SEC-11)", async () => {
    await expect(saved(probe({ status: "PASS_DATA", attempted: true }), { message: 'new row violates check constraint "probe_results_x" (DETAIL secret)' })).rejects.toThrow("점검 판정을 기록하지 못했습니다 (DB 응답 오류)");
    await expect(saved(probe({ status: "PASS_DATA", attempted: true }), { message: "secret detail" })).rejects.not.toThrow(/secret/);
  });
});

describe("recordApiCheck: 새 칸(서비스ID·오퍼레이션 ID·결과코드·요청 요약)", () => {
  const base = { endpointName: "public-list", httpStatus: 200, durationMs: 120, outcome: "success" as const, recordCount: 5, dataValid: true };

  it("PUBLIC 점검의 호출 기록에는 새 칸이 채워진다", async () => {
    const { client, inserts } = fakeClient();
    await createSupabaseCheckStore(client).recordApiCheck(9, { ...base, apiId: "SVC-API-001", operationId: "getRlstCltrList", resultCode: "00", requestSummary: "pageNo=1" });
    expect(inserts[0]).toEqual({
      table: "api_checks",
      row: { run_id: 9, endpoint_name: "public-list", http_status: 200, duration_ms: 120, outcome: "success", record_count: 5, data_valid: true, api_id: "SVC-API-001", operation_id: "getRlstCltrList", result_code: "00", request_summary: "pageNo=1" },
    });
  });

  it("DEMO 점검(이전 방식)의 호출 기록은 새 칸이 모두 null이라 이전 행과 같은 모양이다", async () => {
    const { client, inserts } = fakeClient();
    await createSupabaseCheckStore(client).recordApiCheck(9, { ...base, endpointName: "demo-list" });
    expect(inserts[0].row).toMatchObject({ api_id: null, operation_id: null, result_code: null, request_summary: null });
  });
});

describe("finishRun: 종료 시각은 시작 시각보다 이르지 않다 (서버 시계와 DB 시계가 어긋나도 마감된다)", () => {
  function clientWithStartedAt(startedAt: string | null) {
    const updates: Record<string, unknown>[] = [];
    const client = {
      from() {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: startedAt ? { started_at: startedAt } : null, error: null }) }) }),
          update: (row: Record<string, unknown>) => {
            updates.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      },
    } as unknown as SupabaseClient;
    return { client, updates };
  }

  it("서버 시계가 DB보다 늦어 '지금'이 시작 시각보다 이르면, 시작 시각 + 1ms로 맞춘다", async () => {
    const future = new Date(Date.now() + 60_000);
    const { client, updates } = clientWithStartedAt(future.toISOString().replace("Z", "140+00:00")); // 마이크로초까지 있는 DB 형식
    await createSupabaseCheckStore(client).finishRun(1, "succeeded", 2);
    const finished = Date.parse(updates[0].finished_at as string);
    expect(finished).toBeGreaterThan(Date.parse(future.toISOString().replace("Z", "140+00:00"))); // 잘린 밀리초가 아니라 원래 값(마이크로초)보다도 뒤다
    expect(updates[0]).toMatchObject({ status: "succeeded", api_call_count: 2 });
  });

  it("정상적으로 시작 시각이 과거면 지금 시각을 쓴다", async () => {
    const before = Date.now();
    const { client, updates } = clientWithStartedAt(new Date(before - 5000).toISOString());
    await createSupabaseCheckStore(client).finishRun(1, "failed", 0);
    const finished = Date.parse(updates[0].finished_at as string);
    expect(finished).toBeGreaterThanOrEqual(before);
    expect(finished).toBeLessThanOrEqual(Date.now());
  });

  it("시작 시각을 읽지 못해도 마감은 시도한다 (지금 시각)", async () => {
    const { client, updates } = clientWithStartedAt(null);
    await createSupabaseCheckStore(client).finishRun(1, "failed", 0);
    expect(typeof updates[0].finished_at).toBe("string");
  });
});

describe("recentProbeHistory: probe_results에서 최근 판정 읽기", () => {
  it("출처·서비스·오퍼레이션으로 걸러 최근 것부터 limit개를 읽고 상태·사유만 돌려준다", async () => {
    const calls: [string, unknown][] = [];
    const query = {
      select: (c: string) => (calls.push(["select", c]), query),
      eq: (k: string, v: unknown) => (calls.push([k, v]), query),
      order: (k: string, o: unknown) => (calls.push(["order", [k, o]]), query),
      limit: (n: number) => (calls.push(["limit", n]), Promise.resolve({ data: [{ status: "FAIL", reason: "TIMEOUT" }, { status: "PASS_DATA", reason: null }], error: null })),
    };
    const client = { from: (t: string) => (calls.push(["from", t]), query) } as unknown as SupabaseClient;
    const rows = await createSupabaseCheckStore(client).recentProbeHistory("PUBLIC", "SVC-API-001", "getRlstCltrList", 50);
    expect(rows).toEqual([{ status: "FAIL", reason: "TIMEOUT" }, { status: "PASS_DATA", reason: null }]);
    expect(calls).toEqual([["from", "probe_results"], ["select", "status, reason"], ["source", "PUBLIC"], ["api_id", "SVC-API-001"], ["operation_id", "getRlstCltrList"], ["order", ["id", { ascending: false }]], ["limit", 50]]);
  });

  it("DB 오류는 내부 문구 없이 알린다", async () => {
    const query: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order"]) query[k] = () => query;
    query.limit = () => Promise.resolve({ data: null, error: { message: "secret detail" } });
    const client = { from: () => query } as unknown as SupabaseClient;
    await expect(createSupabaseCheckStore(client).recentProbeHistory("PUBLIC", "SVC-API-001", "x", 5)).rejects.toThrow("최근 점검 판정을 읽지 못했습니다 (DB 응답 오류)");
  });
});

// 점검 엔진을 "진짜 Supabase DB"에 연결해 한 번 돌려 보는 시험 (PLAN 작업 22)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run test:engine-live`로만 실행한다 (.env의 서버 관리용 키 필요).
// 시험이 만든 점검 기록은 끝나면 모두 지운다. 다른 점검 데이터는 건드리지 않는다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCheck } from "@/lib/checks/run-check";
import { createDemoFetcher } from "@/lib/checks/demo-fetcher";
import { createSupabaseCheckStore } from "@/lib/checks/supabase-store";
import { parseSettings, type Settings } from "@/lib/settings/schema";

const live = process.env.LIVE_DB === "1" && !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!live)("점검 엔진 + 실제 DB", () => {
  let db: SupabaseClient;
  let settings: Settings;
  const createdRuns: number[] = [];

  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("settings").select("key, value");
    expect(error).toBeNull();
    settings = parseSettings(data ?? []);
    // 이미 실행 중인 점검이 있으면 시험 결과가 흔들리므로 시작하지 않는다
    const { count } = await db.from("check_runs").select("id", { count: "exact", head: true }).eq("status", "running");
    expect(count, "실행 중인 점검이 있습니다. 끝난 뒤 다시 실행해 주세요.").toBe(0);
  });

  afterAll(async () => {
    if (!db || createdRuns.length === 0) return;
    await db.from("api_checks").delete().in("run_id", createdRuns);
    await db.from("collected_items").delete().in("run_id", createdRuns);
    await db.from("run_logs").delete().in("run_id", createdRuns);
    await db.from("check_runs").delete().in("id", createdRuns);
  });

  it("점검 1회가 DB에 정상 기록된다: 실행 이력 · API 호출 2건 · 수집 318줄 · 비교 제외 메모", async () => {
    const store = createSupabaseCheckStore(db);
    const result = await runCheck({
      trigger: "manual",
      source: "DEMO",
      settings,
      store,
      fetcher: createDemoFetcher({ timeoutSeconds: settings.apiTimeoutSeconds, baseMs: Date.now() }),
    });
    createdRuns.push(result.runId);
    expect(result).toMatchObject({ status: "succeeded", apiCallCount: 2 });

    const { data: run } = await db.from("check_runs").select("status, source, api_call_count, finished_at").eq("id", result.runId).single();
    expect(run).toMatchObject({ status: "succeeded", source: "DEMO", api_call_count: 2 });
    expect(run?.finished_at).not.toBeNull();

    const { data: checks } = await db.from("api_checks").select("endpoint_name, outcome, http_status").eq("run_id", result.runId).order("id");
    expect(checks).toEqual([
      { endpoint_name: "demo-list", outcome: "success", http_status: 200 },
      { endpoint_name: "demo-detail", outcome: "success", http_status: 200 },
    ]);

    const { count } = await db.from("collected_items").select("id", { count: "exact", head: true }).eq("run_id", result.runId);
    expect(count).toBe(318);

    const { data: logs } = await db.from("run_logs").select("code").eq("run_id", result.runId);
    expect(logs?.map((l) => l.code)).toContain("COMPARE_SKIPPED");
  });

  it("실행 중일 때 또 시작하면 blocked로 기록되고 조회하지 않는다", async () => {
    const store = createSupabaseCheckStore(db);
    const first = await store.startRun("manual", "DEMO", null); // 일부러 마감하지 않고 실행 중으로 둔다
    createdRuns.push(first.runId);
    expect(first.status).toBe("running");

    const second = await runCheck({ trigger: "scheduled", source: "DEMO", settings, store, fetcher: createDemoFetcher({ timeoutSeconds: 10, baseMs: Date.now() }) });
    createdRuns.push(second.runId);
    expect(second).toMatchObject({ status: "blocked", apiCallCount: 0 });

    const { data: row } = await db.from("check_runs").select("status, finished_at").eq("id", second.runId).single();
    expect(row?.status).toBe("blocked");
    expect(row?.finished_at).not.toBeNull();

    await store.finishRun(first.runId, "failed", 0); // 다음 점검을 막지 않게 정리
  });
});

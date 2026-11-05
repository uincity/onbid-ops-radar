// 점검 실행기를 "진짜 Supabase DB"에 연결해 한 번 돌려 보는 시험 (W06)
// 보통의 `npm run test:unit`에서는 건너뛴다. 실행: LIVE_DB=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-runner-live.test.ts
// 네트워크(온비드)에는 접속하지 않는다 — 가짜 전송 계층을 쓴다. DB에는 시험용 대상 키('live-runner-test')로만 쓰고 끝나면 만든 줄을 모두 지운다.
// (웹 판정 테이블은 추가 전용이 아니라 지울 수 있다. 실제 대상 'onbid-home'의 기록은 건드리지 않는다)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { scheduledSlotAt } from "@/lib/web-monitor/slot";
import { createSupabaseWebStore } from "@/lib/web-monitor/store";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { parseWebSettings } from "@/lib/web-monitor/settings";
import { ProbeTransportError, type ProbeClock, type WebTransport } from "@/lib/web-monitor/probes/types";

const live = process.env.LIVE_DB === "1" && !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

const MAIN = "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
const GOOD_HTML = `<title>온비드</title> 조건검색 공고검색 회원가입 로그인 <script src="/js/op_main.js"></script>` + "x".repeat(310_000);
const routes: Record<string, { status?: number; body?: string; bytes?: number }> = {
  [MAIN]: { body: GOOD_HTML },
  "https://www.onbid.co.kr/js/op_main.js": { bytes: 5000 },
  "https://www.onbid.co.kr/": { body: `<script>window.location.replace("${MAIN}");</script>` },
  "https://wait.onbid.co.kr/assets/nf-setting/1/nf-setting.json": { body: '{"statusCode":200}' },
};

describe.skipIf(!live)("점검 실행기 + 실제 DB", () => {
  let db: SupabaseClient;
  const KEY = "live-runner-test";
  const target = { ...findWebTarget("onbid-home")!, key: KEY };
  const createdRuns: number[] = [];

  const world = () => {
    let t = Date.now();
    const transport: WebTransport = {
      async lookup() {},
      async tls() {
        return { notAfterMs: t + 60 * 86_400_000, hostnameMatches: true };
      },
      async get(url) {
        const r = routes[url];
        if (!r) throw new ProbeTransportError("network_error");
        t += 50;
        return { status: r.status ?? 200, location: null, bytes: r.bytes ?? new TextEncoder().encode(r.body ?? "").length, body: r.body ?? null };
      },
    };
    const clock: ProbeClock = { now: () => t, sleep: async (ms) => { t += ms; } };
    return { transport, clock };
  };

  const cleanup = async () => {
    // 시험이 만든 실행(대상 키가 시험용)만 지운다. 판정 줄은 연결로 함께 지워진다
    await db.from("web_retry_queue").delete().eq("target_key", KEY);
    await db.from("web_check_runs").delete().eq("target_key", KEY);
  };

  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanup();
  });
  afterAll(async () => {
    if (db) await cleanup();
  });

  it("웹 설정을 읽어 정시 점검을 끝까지 돌리고 DB에 기록한다", async () => {
    const { data, error } = await db.from("web_settings").select("key, value");
    expect(error).toBeNull();
    const settings = { ...parseWebSettings(data ?? []), requestGapMs: 0 };
    const store = createSupabaseWebStore(db);
    const w = world();
    const slot = scheduledSlotAt(Date.UTC(2020, 0, 1, 3, 7)); // 과거 칸: 실제 정시 기록과 겹치지 않는다
    const report = await runWebCheck({ trigger: "scheduled", slotAt: slot, targets: [target], settings, store, transport: w.transport, clock: w.clock });
    const t = report.targets[0];
    createdRuns.push(t.runId);
    expect(t).toMatchObject({ status: "succeeded", overall: "PASS_DATA", finalized: true, storeError: false });

    const { data: run } = await db.from("web_check_runs").select("status, overall_verdict, trigger, slot_at, request_count, finished_at").eq("id", t.runId).single();
    expect(run).toMatchObject({ status: "succeeded", overall_verdict: "PASS_DATA", trigger: "scheduled", request_count: 5 });
    expect(new Date(run!.slot_at).toISOString()).toBe(slot.toISOString());
    expect(run!.finished_at).not.toBeNull();

    const { data: probes } = await db.from("web_probe_results").select("layer, verdict, reason, counts_toward_overall").eq("run_id", t.runId).order("id");
    expect(probes?.map((p) => `${p.layer}:${p.verdict}:${p.counts_toward_overall}`)).toEqual([
      "L1_CONNECT:PASS_DATA:true", "L2_HTTP:PASS_DATA:true", "L3_CONTENT:PASS_DATA:true", "AUX_STUB:PASS_DATA:false", "AUX_QUEUE:PASS_DATA:false",
    ]);
  });

  it("같은 정시 칸을 다시 부르면 DB가 차단하고 요청을 보내지 않는다", async () => {
    const { data } = await db.from("web_settings").select("key, value");
    const settings = { ...parseWebSettings(data ?? []), requestGapMs: 0 };
    const store = createSupabaseWebStore(db);
    const w = world();
    const slot = scheduledSlotAt(Date.UTC(2020, 0, 1, 3, 7));
    const report = await runWebCheck({ trigger: "scheduled", slotAt: slot, targets: [target], settings, store, transport: w.transport, clock: w.clock });
    createdRuns.push(report.targets[0].runId);
    expect(report.targets[0]).toMatchObject({ status: "blocked", requestCount: 0 });
    const { data: queue } = await db.from("web_retry_queue").select("id").eq("target_key", KEY);
    expect(queue).toHaveLength(0); // 칸 중복은 대체 실행을 예약하지 않는다
  });

  it("점검이 끝난 뒤 실행 중으로 남은 줄이 없다", async () => {
    const { data } = await db.from("web_check_runs").select("id").eq("target_key", KEY).eq("status", "running");
    expect(data).toHaveLength(0);
  });
});

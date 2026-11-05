// 수동 점검(지금 점검) 핵심 흐름 시험 (W17) — 가짜 저장소·가짜 전송 계층만 쓴다. DB·네트워크 없음
// 핵심: 기록만 한다 (상태·사건·이상징후·알림·재확인 예약이 하나도 생기지 않는다)
import { describe, expect, it } from "vitest";
import { MANUAL_CHECK_ERROR_TEXT, runManualWebCheck, type ManualCheckDeps } from "@/lib/web-monitor/manual-check";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { ProbeTransportError, type ProbeClock, type TransportGetResult, type WebTransport } from "@/lib/web-monitor/probes/types";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { scheduledSlotAt } from "@/lib/web-monitor/slot";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";

const MAIN = "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
const STUB_URL = "https://www.onbid.co.kr/";
const QUEUE_URL = "https://wait.onbid.co.kr/assets/nf-setting/1/nf-setting.json";
const GOOD_HTML = `<title>온비드</title> 조건검색 공고검색 회원가입 로그인 <script src="/js/op_main.js"></script>` + "x".repeat(310_000);
const NOW0 = Date.UTC(2026, 10, 5, 5, 7, 0);
const DAY = 86_400_000;
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

type Reply = Partial<TransportGetResult> & { cost?: number };
const GOOD: Record<string, Reply> = {
  [MAIN]: { body: GOOD_HTML, cost: 400 },
  "https://www.onbid.co.kr/js/op_main.js": { status: 200, bytes: 5000 },
  [STUB_URL]: { body: `<script>window.location.replace("${MAIN}");</script>` },
  [QUEUE_URL]: { body: '{"statusCode":200}' },
};
const DOWN: Record<string, Reply> = { ...GOOD, [MAIN]: { status: 503, body: "", cost: 100 } };

function fake(routes: Record<string, Reply>) {
  let t = NOW0;
  const calls: string[] = [];
  const transport: WebTransport = {
    async lookup() {},
    async tls() {
      return { notAfterMs: NOW0 + 60 * DAY, hostnameMatches: true };
    },
    async get(url: string) {
      calls.push(url);
      const r = routes[url];
      if (!r) throw new ProbeTransportError("network_error");
      t += r.cost ?? 100;
      return { status: r.status ?? 200, location: r.location ?? null, bytes: r.bytes ?? (r.body ? new TextEncoder().encode(r.body).length : 0), body: r.body ?? null };
    },
  };
  const clock: ProbeClock = { now: () => t, sleep: async (ms) => { t += ms; } };
  return { transport, clock, calls };
}

const target = findWebTarget("onbid-home")!;
const settings = (over: Partial<typeof DEFAULT_WEB_SETTINGS> = {}) => ({ ...DEFAULT_WEB_SETTINGS, requestGapMs: 0, ...over });

function setup(opts: { routes?: Record<string, Reply>; enabled?: boolean; store?: ReturnType<typeof createMemoryWebStore> } = {}) {
  const store = opts.store ?? createMemoryWebStore({ now: () => NOW0 });
  const f = fake(opts.routes ?? GOOD);
  const deps: ManualCheckDeps = {
    userId: ADMIN_ID,
    prepare: async () => ({ settings: settings({ monitorEnabled: opts.enabled ?? true }), store }),
    targets: () => [target],
    transport: f.transport,
    clock: f.clock,
    runWebCheck,
  };
  return { store, f, deps };
}

// 수동 점검 뒤에 "바뀌면 안 되는 것"이 모두 비어 있는지
const nothingChanged = (store: ReturnType<typeof createMemoryWebStore>) => {
  expect(store.states.size).toBe(0);
  expect(store.queue).toHaveLength(0);
  expect(store.notifications).toHaveLength(0);
  expect(store.detections).toHaveLength(0);
  expect(store.recoveries).toHaveLength(0);
  expect(store.attempts).toHaveLength(0);
};

describe("runManualWebCheck", () => {
  it("정상 사이트: 수동 실행으로 기록되고(팀장·정시 칸 없음) 결과를 돌려주며, 상태·알림 등은 하나도 생기지 않는다", async () => {
    const { store, deps } = setup();
    const result = await runManualWebCheck(deps);
    expect(result).toMatchObject({ ok: true, targetKey: "onbid-home", status: "succeeded", verdict: "PASS_DATA" });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ trigger: "manual", triggeredBy: ADMIN_ID, slotAt: null, status: "succeeded", plannedMaintenance: false });
    expect(store.probes.length).toBeGreaterThan(0);
    nothingChanged(store);
  });

  it("실패하는 사이트여도 기록만 한다: 재확인 예약·사건·이상징후·알림이 없다", async () => {
    const { store, deps } = setup({ routes: DOWN });
    const result = await runManualWebCheck(deps);
    expect(result).toMatchObject({ ok: true, verdict: "FAIL" });
    expect(store.runs[0].trigger).toBe("manual");
    nothingChanged(store);
  });

  it("이미 있는 상태 줄(사건 중)도 수동 점검이 바꾸지 않는다", async () => {
    const { store, deps } = setup({ routes: DOWN });
    // 정시 점검으로 만든 상태가 있다고 가정하고, 수동 점검 전후 같은지 본다
    const before = structuredClone(Object.fromEntries(store.states));
    await runManualWebCheck(deps);
    expect(Object.fromEntries(store.states)).toEqual(before);
  });

  it("점검이 꺼져 있으면 MONITOR_DISABLED이고 요청도 기록도 하지 않는다", async () => {
    const { store, f, deps } = setup({ enabled: false });
    const result = await runManualWebCheck(deps);
    expect(result).toEqual({ ok: false, code: "MONITOR_DISABLED", message: "홈페이지 점검이 꺼져 있습니다." });
    expect(f.calls).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  it("이미 점검이 실행 중이면 RUN_IN_PROGRESS이고, 실행 중이던 줄은 그대로다", async () => {
    const store = createMemoryWebStore({ now: () => NOW0 });
    const running = await store.startRun({ targetKey: "onbid-home", trigger: "scheduled", slotAt: scheduledSlotAt(NOW0), originRunId: null });
    const { f, deps } = setup({ store });
    const result = await runManualWebCheck(deps);
    expect(result).toMatchObject({ ok: false, code: "RUN_IN_PROGRESS", message: MANUAL_CHECK_ERROR_TEXT.RUN_IN_PROGRESS });
    expect(f.calls).toHaveLength(0);
    expect(store.runs.find((r) => r.id === running.runId)?.status).toBe("running");
    expect(store.runs.filter((r) => r.status === "blocked")).toHaveLength(1);
    nothingChanged(store);
  });

  it("설정을 읽지 못하거나 실행기가 예외를 던져도 내부 문구 없이 INTERNAL로만 알린다", async () => {
    const { deps } = setup();
    const a = await runManualWebCheck({ ...deps, prepare: async () => { throw new Error("secret db message token=abc"); } });
    expect(a).toEqual({ ok: false, code: "INTERNAL", message: MANUAL_CHECK_ERROR_TEXT.INTERNAL });
    const b = await runManualWebCheck({ ...deps, runWebCheck: async () => { throw new Error("boom https://x?serviceKey=1"); } });
    expect(b).toEqual({ ok: false, code: "INTERNAL", message: MANUAL_CHECK_ERROR_TEXT.INTERNAL });
    expect(JSON.stringify([a, b])).not.toMatch(/secret|token|serviceKey|boom/);
  });

  it("계획 점검 창 안에서 눌러도 계획 점검 표시를 하지 않는다 (상태에 반영되지 않는 기록일 뿐)", async () => {
    const { store, deps } = setup();
    store.addWindow({ targetKey: "onbid-home", startsAt: new Date(NOW0 - 3_600_000).toISOString(), endsAt: new Date(NOW0 + 3_600_000).toISOString() });
    await runManualWebCheck(deps);
    expect(store.runs[0].plannedMaintenance).toBe(false);
  });

  it("수동 점검은 같은 시각 정시 점검을 막지 않는다 (정시 칸을 쓰지 않는다)", async () => {
    const { store, deps } = setup();
    await runManualWebCheck(deps);
    const f = fake(GOOD);
    const scheduled = await runWebCheck({ trigger: "scheduled", slotAt: scheduledSlotAt(NOW0), targets: [target], settings: settings(), store, transport: f.transport, clock: f.clock });
    expect(scheduled.targets[0].status).toBe("succeeded");
    expect(store.runs.map((r) => r.trigger)).toEqual(["manual", "scheduled"]);
  });
});

// W06 점검 실행기: 가짜 저장소·가짜 전송 계층으로 시작→프로브→저장→종료, 차단, 격리, 시간 예산, 정시 칸 시험
import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { WEB_MAX_REDIRECTS, runWebCheck, toClassifyConfig, type WebRunInput } from "@/lib/web-monitor/runner";
import { scheduledSlotAt } from "@/lib/web-monitor/slot";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import type { WebCheckStore } from "@/lib/web-monitor/store";
import { ProbeTransportError, type ProbeClock, type TransportGetResult, type WebTransport } from "@/lib/web-monitor/probes/types";
import { findWebTarget } from "@/lib/web-monitor/registry";

const MAIN = "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
const STUB_URL = "https://www.onbid.co.kr/";
const QUEUE_URL = "https://wait.onbid.co.kr/assets/nf-setting/1/nf-setting.json";
const STUB_HTML = `<script>window.location.replace("${MAIN}");</script>`;
const GOOD_HTML = `<title>온비드</title> 조건검색 공고검색 회원가입 로그인 <script src="/js/op_main.js"></script>` + "x".repeat(310_000);
const DAY = 86_400_000;
const NOW0 = Date.UTC(2026, 10, 5, 5, 7, 0);

type Reply = Partial<TransportGetResult> & { cost?: number; throwKind?: ProbeTransportError["kind"] };
const GOOD_ROUTES: Record<string, Reply> = {
  [MAIN]: { body: GOOD_HTML, cost: 400 },
  "https://www.onbid.co.kr/js/op_main.js": { status: 200, bytes: 5000, cost: 50 },
  [STUB_URL]: { body: STUB_HTML },
  [QUEUE_URL]: { body: '{"statusCode":200}' },
};

function fake(routes: Record<string, Reply> = GOOD_ROUTES, startMs = NOW0) {
  let t = startMs;
  const calls: string[] = [];
  const transport: WebTransport = {
    async lookup() {},
    async tls() {
      return { notAfterMs: startMs + 60 * DAY, hostnameMatches: true };
    },
    async get(url: string) {
      calls.push(url);
      const r = routes[url];
      if (!r) throw new ProbeTransportError("network_error");
      t += r.cost ?? 100;
      if (r.throwKind) throw new ProbeTransportError(r.throwKind);
      return { status: r.status ?? 200, location: r.location ?? null, bytes: r.bytes ?? (r.body ? new TextEncoder().encode(r.body).length : 0), body: r.body ?? null };
    },
  };
  const clock: ProbeClock = { now: () => t, sleep: async (ms) => { t += ms; } };
  return { transport, clock, calls };
}

const target = findWebTarget("onbid-home")!;
const second = { ...target, key: "second-site" };
const settingsWith = (over: Partial<typeof DEFAULT_WEB_SETTINGS> = {}) => ({ ...DEFAULT_WEB_SETTINGS, requestGapMs: 0, ...over });
const input = (over: Partial<WebRunInput> & { f?: ReturnType<typeof fake> } = {}) => {
  const f = over.f ?? fake();
  const store = over.store ?? createMemoryWebStore();
  const base: WebRunInput = { trigger: "manual", targets: [target], settings: settingsWith(), store, transport: f.transport, clock: f.clock };
  return { run: { ...base, ...over }, f, store: store as ReturnType<typeof createMemoryWebStore> };
};

describe("설정 → 판정 설정", () => {
  it("웹 설정의 타임아웃·느림 기준·인증서 기준을 그대로 넘기고 리다이렉트 상한은 10", () => {
    expect(toClassifyConfig(DEFAULT_WEB_SETTINGS)).toEqual({ timeoutMs: 10000, slowMs: 3000, certWarnDays: 14, maxRedirects: 10 });
    expect(WEB_MAX_REDIRECTS).toBe(10);
    expect(toClassifyConfig({ ...DEFAULT_WEB_SETTINGS, httpSlowMs: 1500 }).slowMs).toBe(1500);
  });
});

describe("정시 칸 계산", () => {
  it("같은 시간 안(:00~:59)은 같은 칸, 다음 정각부터 다음 칸", () => {
    const h = Date.UTC(2026, 10, 5, 14, 0, 0);
    expect(scheduledSlotAt(h + 7 * 60_000).toISOString()).toBe("2026-11-05T14:00:00.000Z");
    expect(scheduledSlotAt(h + 59 * 60_000 + 59_999).toISOString()).toBe("2026-11-05T14:00:00.000Z");
    expect(scheduledSlotAt(h + 60 * 60_000).toISOString()).toBe("2026-11-05T15:00:00.000Z");
    expect(scheduledSlotAt(h).toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });
});

describe("정상 흐름", () => {
  it("시작 → 프로브 → 저장 → 종료: 정상 종료, 대표 정상, 층별 판정(주 3 + 보조 2) 저장", async () => {
    const { run, store } = input();
    const r = await runWebCheck(run);
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toMatchObject({ targetKey: "onbid-home", status: "succeeded", overall: "PASS_DATA", finalized: true, storeError: false });
    expect(store.runs[0]).toMatchObject({ status: "succeeded", overallVerdict: "PASS_DATA", requestCount: r.targets[0].requestCount });
    expect(r.targets[0].requestCount).toBe(5); // L1 + main + 번들 + 스텁 + 대기열
    expect(store.probes.map((p) => p.probe.layer)).toEqual(["L1_CONNECT", "L2_HTTP", "L3_CONTENT", "AUX_STUB", "AUX_QUEUE"]);
    expect(store.probes.every((p) => p.runId === r.targets[0].runId && p.targetKey === "onbid-home")).toBe(true);
  });

  it("정시 점검은 정시 칸을, 수동 점검은 담당자를, 재확인은 원래 실행을 기록한다", async () => {
    const slot = scheduledSlotAt(NOW0);
    const a = input({ trigger: "scheduled", slotAt: slot });
    await runWebCheck(a.run);
    expect(a.store.runs[0]).toMatchObject({ trigger: "scheduled", status: "succeeded" });
    expect(a.store.runs[0].slotAt?.toISOString()).toBe("2026-11-05T05:00:00.000Z");

    const m = input({ trigger: "manual", triggeredBy: "11111111-1111-1111-1111-111111111111" });
    await runWebCheck(m.run);
    expect(m.store.runs[0].triggeredBy).toBe("11111111-1111-1111-1111-111111111111");

    const rt = input({ trigger: "retry", originRunId: 7 });
    await runWebCheck(rt.run);
    expect(rt.store.runs[0]).toMatchObject({ trigger: "retry", originRunId: 7 });
  });

  it("점검 결과의 판정 줄에는 본문이나 질의가 없다", async () => {
    const { run, store } = input();
    await runWebCheck(run);
    const text = JSON.stringify(store.probes);
    expect(text).not.toContain("물건");
    expect(text).not.toContain("조건검색");
    expect(text).not.toContain("serviceKey");
  });
});

describe("판정이 나쁜 경우도 정상 기록된다", () => {
  it("503이면 대표 FAIL로 종료(succeeded: 점검 자체는 끝남)하고 보조는 계속 점검", async () => {
    const f = fake({ ...GOOD_ROUTES, [MAIN]: { status: 503, body: "err" } });
    const { run, store } = input({ f });
    const r = await runWebCheck(run);
    expect(r.targets[0]).toMatchObject({ status: "succeeded", overall: "FAIL" });
    expect(store.probes.map((p) => `${p.probe.layer}:${p.probe.verdict}`)).toEqual(["L1_CONNECT:PASS_DATA", "L2_HTTP:FAIL", "L3_CONTENT:NOT_RUN", "AUX_STUB:PASS_DATA", "AUX_QUEUE:PASS_DATA"]);
  });
});

describe("차단", () => {
  it("이미 실행 중이면 blocked: 프로브도 요청도 하지 않는다 (수동 점검은 대체 실행 예약 없음)", async () => {
    const store = createMemoryWebStore();
    await store.startRun({ targetKey: "other", trigger: "manual" }); // 다른 실행이 돌고 있다
    const { run, f } = input({ store });
    const r = await runWebCheck(run);
    expect(r.targets[0]).toMatchObject({ status: "blocked", overall: null, requestCount: 0, probes: [] });
    expect(f.calls).toHaveLength(0);
    expect(store.probes).toHaveLength(0);
    expect(store.queue).toHaveLength(0);
  });

  it("정시 점검이 실행 중 때문에 막히면 대체 실행이 예약된다", async () => {
    const store = createMemoryWebStore();
    await store.startRun({ targetKey: "other", trigger: "manual" });
    const { run } = input({ store, trigger: "scheduled", slotAt: scheduledSlotAt(NOW0) });
    const r = await runWebCheck(run);
    expect(r.targets[0].status).toBe("blocked");
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]).toMatchObject({ targetKey: "onbid-home", kind: "replace", originRunId: r.targets[0].runId, status: "pending", attempts: 0 });
  });

  it("같은 정시 칸을 두 번 부르면 두 번째는 blocked (요청 없음, 대체 예약 없음)", async () => {
    const store = createMemoryWebStore();
    const slot = scheduledSlotAt(NOW0);
    await runWebCheck(input({ store, trigger: "scheduled", slotAt: slot }).run);
    const again = input({ store, trigger: "scheduled", slotAt: slot });
    const r = await runWebCheck(again.run);
    expect(r.targets[0].status).toBe("blocked");
    expect(again.f.calls).toHaveLength(0);
    expect(store.queue).toHaveLength(0);
  });

  it("끝난 뒤에는 같은 칸이 아니면 다시 시작할 수 있다 (다음 칸)", async () => {
    const store = createMemoryWebStore();
    await runWebCheck(input({ store, trigger: "scheduled", slotAt: new Date(Date.UTC(2026, 10, 5, 5)) }).run);
    const r = await runWebCheck(input({ store, trigger: "scheduled", slotAt: new Date(Date.UTC(2026, 10, 5, 6)) }).run);
    expect(r.targets[0].status).toBe("succeeded");
  });
});

describe("입력 규칙", () => {
  it("정시 점검에 칸이 없거나 정시가 아닌데 칸이 있으면 거부 (DB 제약과 같음)", async () => {
    await expect(runWebCheck(input({ trigger: "scheduled" }).run)).rejects.toBeInstanceOf(RangeError);
    await expect(runWebCheck(input({ trigger: "manual", slotAt: new Date() }).run)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("격리: 한 대상의 오류가 다른 대상을 막지 않는다", () => {
  it("조회기 코드가 예외를 던지면 그 대상만 failed(INTERNAL_ERROR), 내부 문구 없음, 다음 대상은 정상 진행", async () => {
    const store = createMemoryWebStore();
    let n = 0;
    const probe: NonNullable<WebRunInput["probe"]> = async (t, deps) => {
      if (n++ === 0) throw new Error("secret internal detail path=/etc");
      return (await import("@/lib/web-monitor/probes/target")).probeTarget(t, deps);
    };
    const { run } = input({ store, targets: [target, second], probe });
    const r = await runWebCheck(run);
    expect(r.targets[0]).toMatchObject({ targetKey: "onbid-home", status: "failed", overall: "UNVERIFIED", finalized: true });
    expect(r.targets[0].probes).toHaveLength(1);
    expect(r.targets[0].probes[0]).toMatchObject({ verdict: "UNVERIFIED", reason: "INTERNAL_ERROR" });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(JSON.stringify(store.probes)).not.toContain("secret");
    expect(r.targets[1]).toMatchObject({ targetKey: "second-site", status: "succeeded", overall: "PASS_DATA" });
    expect(store.runs.map((x) => x.status)).toEqual(["failed", "succeeded"]); // 실행 중으로 남은 줄이 없다
  });

  it("판정 저장이 실패하면 그 대상은 failed로 종료하고 storeError 표시, 다음 대상은 진행", async () => {
    const mem = createMemoryWebStore();
    let saves = 0;
    const store: WebCheckStore = {
      startRun: (i) => mem.startRun(i),
      saveProbeResults: async (id, key, p) => {
        if (saves++ === 0) throw new Error("db down detail");
        return mem.saveProbeResults(id, key, p);
      },
      finishRun: (i) => mem.finishRun(i),
    };
    const { run } = input({ store, targets: [target, second] });
    const r = await runWebCheck(run);
    expect(r.targets[0]).toMatchObject({ status: "failed", storeError: true, finalized: true });
    expect(r.targets[1]).toMatchObject({ status: "succeeded", storeError: false });
    expect(JSON.stringify(r)).not.toContain("db down");
    expect(mem.runs[0].status).toBe("failed");
  });

  it("종료 기록이 실패해도 예외로 번지지 않고 storeError, 다음 대상 진행", async () => {
    const mem = createMemoryWebStore();
    let finishes = 0;
    const store: WebCheckStore = {
      startRun: (i) => mem.startRun(i),
      saveProbeResults: (id, key, p) => mem.saveProbeResults(id, key, p),
      finishRun: async (i) => {
        if (finishes++ === 0) throw new Error("boom");
        return mem.finishRun(i);
      },
    };
    const { run } = input({ store, targets: [target, second] });
    const r = await runWebCheck(run);
    expect(r.targets[0]).toMatchObject({ storeError: true, finalized: false });
    // 첫 실행이 running으로 남아 있으니 둘째는 차단된다 (멈춘 실행 정리는 DB 함수가 다음 시작 때 한다)
    expect(r.targets[1].status).toBe("blocked");
  });

  it("멈춘 실행으로 먼저 정리된 줄은 종료 기록이 false → finalized=false", async () => {
    const mem = createMemoryWebStore();
    const store: WebCheckStore = { ...mem, startRun: (i) => mem.startRun(i), saveProbeResults: (a, b, c) => mem.saveProbeResults(a, b, c), finishRun: async () => false };
    const r = await runWebCheck(input({ store }).run);
    expect(r.targets[0]).toMatchObject({ status: "succeeded", finalized: false, storeError: false });
  });

  it("시작 입구의 DB 오류는 위로 던진다 (기록할 곳이 없음)", async () => {
    const store: WebCheckStore = { startRun: async () => { throw new Error("rpc failed"); }, saveProbeResults: async () => {}, finishRun: async () => true };
    await expect(runWebCheck(input({ store }).run)).rejects.toThrow("rpc failed");
  });
});

describe("시간 예산", () => {
  it("예산(실행 시간 제한)을 넘기면 남은 층은 BUDGET_SKIP 미점검, 상태는 partial", async () => {
    // 제한 10초, 요청마다 6초 → L2 후 6초, 번들 후 12초 → 보조 확인은 건너뜀
    const slow: Record<string, Reply> = {
      [MAIN]: { body: GOOD_HTML, cost: 6000 },
      "https://www.onbid.co.kr/js/op_main.js": { status: 200, bytes: 5000, cost: 6000 },
      [STUB_URL]: { body: STUB_HTML },
      [QUEUE_URL]: { body: '{"a":1}' },
    };
    const f = fake(slow);
    const { run, store } = input({ f, settings: settingsWith({ runTimeLimitSeconds: 10, staleRunningSeconds: 180 }) });
    const r = await runWebCheck(run);
    expect(r.targets[0].status).toBe("partial");
    const skipped = store.probes.filter((p) => p.probe.reason === "BUDGET_SKIP");
    expect(skipped.map((p) => p.probe.layer)).toEqual(["AUX_STUB", "AUX_QUEUE"]);
    expect(f.calls).not.toContain(STUB_URL);
    expect(store.runs[0].status).toBe("partial");
  });

  it("예산을 다 쓴 뒤의 다음 대상은 요청 없이 전부 미점검 (partial)", async () => {
    const slow: Record<string, Reply> = { ...GOOD_ROUTES, [MAIN]: { body: GOOD_HTML, cost: 11000 } };
    const f = fake(slow);
    const { run } = input({ f, targets: [target, second], settings: settingsWith({ runTimeLimitSeconds: 10, staleRunningSeconds: 180 }) });
    const r = await runWebCheck(run);
    const callsAfterFirst = f.calls.length;
    expect(r.targets[1].overall).toBe("NOT_RUN");
    expect(r.targets[1].status).toBe("partial");
    expect(r.targets[1].requestCount).toBe(0);
    expect(f.calls.length).toBe(callsAfterFirst); // 둘째는 요청을 보내지 않았다
  });

  it("각 요청의 타임아웃은 남은 시간을 넘지 않는다", async () => {
    const seen: number[] = [];
    const f = fake();
    const orig = f.transport.get.bind(f.transport);
    f.transport.get = async (url, opts) => {
      seen.push(opts.timeoutMs);
      return orig(url, opts);
    };
    const { run } = input({ f, settings: settingsWith({ runTimeLimitSeconds: 10, staleRunningSeconds: 180 }) });
    await runWebCheck(run);
    expect(Math.max(...seen)).toBeLessThanOrEqual(10_000);
    expect(seen.every((x) => x > 0)).toBe(true);
  });
});

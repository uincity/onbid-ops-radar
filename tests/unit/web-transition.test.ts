// 점검 결과 → 상태 전환 연결부(transition.ts) 시험 (W11) — 가짜 저장소만 쓴다
import { describe, expect, it } from "vitest";
import { base, out, type ProbeResult, type WebVerdict } from "@/lib/web-monitor/classify";
import { applyRunDecision, observationFromProbes, MAX_TRANSITION_ATTEMPTS } from "@/lib/web-monitor/transition";
import type { WebTargetRunReport } from "@/lib/web-monitor/runner";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import type { WebTransitionStore } from "@/lib/web-monitor/transition-store";

const T0 = Date.UTC(2026, 10, 5, 5, 7, 0);

const l1 = (certDaysLeft: number | null = 40): ProbeResult => ({ ...base("L1_CONNECT", true), certDaysLeft });
const probesFor = (overall: WebVerdict, extra: ProbeResult[] = []): ProbeResult[] => [
  l1(),
  overall === "FAIL" ? out(base("L2_HTTP", true), "FAIL", "HTTP_5XX", { httpStatus: 503 }) : base("L2_HTTP", true),
  base("L3_CONTENT", true),
  base("AUX_STUB", false),
  base("AUX_QUEUE", false),
  ...extra,
];

// 점검 1회를 끝낸 것처럼 저장소에 실행을 만들고 그 보고를 돌려준다
async function finishedRun(store: ReturnType<typeof createMemoryWebStore>, overall: WebVerdict, o: { trigger?: "scheduled" | "retry"; slotAt?: Date; originRunId?: number; probes?: ProbeResult[]; status?: WebTargetRunReport["status"] } = {}): Promise<WebTargetRunReport> {
  const trigger = o.trigger ?? "scheduled";
  const started = await store.startRun({ targetKey: "onbid-home", trigger, slotAt: trigger === "scheduled" ? (o.slotAt ?? new Date(T0)) : null, originRunId: o.originRunId ?? null });
  const status = o.status ?? "succeeded";
  if (status === "succeeded" || status === "partial") await store.finishRun({ runId: started.runId, status, overallVerdict: overall, requestCount: 5 });
  return { targetKey: "onbid-home", runId: started.runId, status, overall, requestCount: 5, finalized: true, storeError: false, probes: o.probes ?? probesFor(overall) };
}

describe("observationFromProbes — 판정 줄에서 결정 입력 뽑기", () => {
  it("대표 판정을 만든 사유, 점검 문구, 인증서 임박, 보조 확인 이름을 뽑는다", () => {
    const probes: ProbeResult[] = [
      l1(10),
      out(base("L2_HTTP", true), "FAIL", "MAINTENANCE_DETECTED"),
      out({ ...base("L1_CONNECT", false), certDaysLeft: 10 }, "DEGRADED", "CERT_EXPIRING"),
      out(base("AUX_STUB", false), "FAIL", "STUB_CHANGED"),
      base("AUX_QUEUE", false),
    ];
    expect(observationFromProbes(probes)).toEqual({
      primaryReason: "MAINTENANCE_DETECTED",
      maintenanceDetected: true,
      certExpiring: true,
      certDaysLeft: 10,
      aux: [{ key: "aux-stub", verdict: "FAIL" }, { key: "aux-queue", verdict: "PASS_DATA" }],
    });
  });

  it("정상 판정이면 사유·신호가 비어 있다 (보조 확인의 사유는 대표 사유가 되지 않는다)", () => {
    const o = observationFromProbes([l1(null), base("L2_HTTP", true), base("L3_CONTENT", true), out(base("AUX_STUB", false), "FAIL", "STUB_CHANGED")]);
    expect(o).toMatchObject({ primaryReason: null, maintenanceDetected: false, certExpiring: false, certDaysLeft: null });
  });
});

describe("applyRunDecision", () => {
  const settings = DEFAULT_WEB_SETTINGS;
  const apply = (store: ReturnType<typeof createMemoryWebStore>, report: WebTargetRunReport, o: Partial<Parameters<typeof applyRunDecision>[0]> = {}) =>
    applyRunDecision({ report, trigger: "scheduled", startedAt: new Date(T0), settings, store, ...o });

  it("정상 판정은 상태 줄을 만들고 원래 실행의 확정 판정을 채운다", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const report = await finishedRun(store, "PASS_DATA");
    expect(await apply(store, report)).toMatchObject({ action: "applied", claimedKeys: [] });
    expect(store.states.get("onbid-home")).toMatchObject({ current_verdict: "PASS_DATA", incident_open: false, version: 1 });
    expect(store.runs.find((r) => r.id === report.runId)).toMatchObject({ confirmedVerdict: "PASS_DATA", flap: false });
  });

  it("정시 실패 + 사건 없음 → 상태·알림 변화 없이 확인 재시도를 예약한다", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const report = await finishedRun(store, "FAIL");
    expect(await apply(store, report)).toEqual({ action: "deferred", confirmQueued: true });
    expect(store.states.size).toBe(0);
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]).toMatchObject({ kind: "confirm", originRunId: report.runId, status: "pending", dueAtMs: T0 + 90_000 });
    expect(store.notifications).toHaveLength(0);
  });

  it("이미 대기 줄이 있으면 새로 예약하지 않는다 (confirmQueued=false)", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    await apply(store, await finishedRun(store, "FAIL"));
    // 대상에 대기 줄이 남은 채로 다른 정시 칸 실패가 와도 줄은 하나뿐
    const again = await finishedRun(store, "FAIL", { slotAt: new Date(T0 + 3_600_000) }).catch(() => null);
    expect(again).not.toBeNull();
    expect(await apply(store, again!)).toEqual({ action: "deferred", confirmQueued: false });
    expect(store.queue.filter((q) => q.status === "pending")).toHaveLength(1);
  });

  it("재확인(retry)이 실패면 확정 실패: 사건 시작·장애 알림·이상징후, 원래 실행에 확정 판정", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const first = await finishedRun(store, "FAIL");
    await apply(store, first);
    const retry = await finishedRun(store, "FAIL", { trigger: "retry", originRunId: first.runId });
    expect(await apply(store, retry, { trigger: "retry", originRunId: first.runId, startedAt: new Date(T0 + 120_000) })).toMatchObject({ action: "applied", claimedKeys: ["down:1"] });
    expect(store.notifications.map((n) => n.key)).toEqual(["down:1"]);
    expect(store.states.get("onbid-home")).toMatchObject({ incident_open: true, incident_no: 1, current_verdict: "FAIL" });
    expect(store.detections).toHaveLength(1);
    expect(store.runs.find((r) => r.id === first.runId)).toMatchObject({ confirmedVerdict: "FAIL", flap: false });
  });

  it("재확인이 정상이면 알림 0건·이상징후 없음·일시 실패(flap)", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const first = await finishedRun(store, "FAIL");
    await apply(store, first);
    const retry = await finishedRun(store, "PASS_DATA", { trigger: "retry", originRunId: first.runId });
    await apply(store, retry, { trigger: "retry", originRunId: first.runId, startedAt: new Date(T0 + 120_000) });
    expect(store.notifications).toHaveLength(0);
    expect(store.detections).toHaveLength(0);
    expect(store.runs.find((r) => r.id === first.runId)).toMatchObject({ confirmedVerdict: "PASS_DATA", flap: true });
  });

  it("사건이 열려 있으면 재확인 결과를 평가하지 않는다", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const first = await finishedRun(store, "FAIL");
    await apply(store, first);
    const retry = await finishedRun(store, "FAIL", { trigger: "retry", originRunId: first.runId });
    await apply(store, retry, { trigger: "retry", originRunId: first.runId });
    const second = await finishedRun(store, "FAIL", { trigger: "retry", originRunId: first.runId });
    expect(await apply(store, second, { trigger: "retry", originRunId: first.runId })).toEqual({ action: "skipped", reason: "incident_open" });
  });

  it("끝나지 않았거나 실패·차단된 실행, 저장 오류가 있었던 실행은 건드리지 않는다", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const blocked: WebTargetRunReport = { targetKey: "onbid-home", runId: 1, status: "blocked", overall: null, requestCount: 0, finalized: true, storeError: false, probes: [] };
    expect(await apply(store, blocked)).toEqual({ action: "skipped", reason: "not_completed" });
    expect(await apply(store, { ...blocked, status: "failed", overall: "UNVERIFIED" })).toEqual({ action: "skipped", reason: "not_completed" });
    expect(await apply(store, { ...blocked, status: "succeeded", overall: "PASS_DATA", storeError: true })).toEqual({ action: "skipped", reason: "store_error" });
    expect(store.states.size).toBe(0);
  });

  it("계획 점검 창 안의 실패는 재확인을 예약하지 않고 planned로 기록한다", async () => {
    const store = createMemoryWebStore({ now: () => T0 });
    const report = await finishedRun(store, "FAIL");
    expect(await apply(store, report, { isInWindow: async () => true })).toMatchObject({ action: "planned", claimedKeys: [] });
    expect(store.queue).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
  });

  it("버전 충돌(CONFLICT)이면 상태를 다시 읽어 판단을 다시 하고, 계속 충돌하면 포기한다", async () => {
    const mem = createMemoryWebStore({ now: () => T0 });
    const report = await finishedRun(mem, "PASS_DATA");
    let conflicts = 1;
    let loads = 0;
    const flaky: WebTransitionStore = {
      loadState: (k) => (loads++, mem.loadState(k)),
      enqueueConfirm: (i) => mem.enqueueConfirm(i),
      recordTransition: async (i) => (conflicts-- > 0 ? { result: "CONFLICT", version: 9 } : mem.recordTransition(i)),
    };
    expect(await applyRunDecision({ report, trigger: "scheduled", startedAt: new Date(T0), settings, store: flaky })).toMatchObject({ action: "applied" });
    expect(loads).toBe(2);

    const always: WebTransitionStore = { ...flaky, recordTransition: async () => ({ result: "CONFLICT", version: 9 }) };
    const report2 = await finishedRun(createMemoryWebStore({ now: () => T0 }), "PASS_DATA");
    loads = 0;
    expect(await applyRunDecision({ report: report2, trigger: "scheduled", startedAt: new Date(T0), settings, store: always })).toEqual({ action: "conflict" });
    expect(loads).toBe(MAX_TRANSITION_ATTEMPTS);
  });
});

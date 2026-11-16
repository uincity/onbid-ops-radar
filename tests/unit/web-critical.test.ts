// 핵심 시간대 촉진 점검(W26) 시험 — 시간대 경계·촉진 칸·판정 범위·입구·알림 문구·집계 분리 (DB·네트워크 없음)
import { describe, expect, it, vi } from "vitest";
import { base, out, type ProbeResult, type WebVerdict } from "@/lib/web-monitor/classify";
import { criticalNowOf, criticalSlotAt, isCriticalGridMinute, isCriticalSlot, isInCriticalHours } from "@/lib/web-monitor/critical";
import { runCriticalWebCheck } from "@/lib/web-monitor/cron-web-check-critical";
import type { WebCronDeps } from "@/lib/web-monitor/cron-web-check";
import { decide, type DecideInput, type WebStateForDecision } from "@/lib/web-monitor/decide";
import { buildMessage, CRITICAL_BANNER } from "@/lib/web-monitor/notify/messages";
import type { UnsentNotification } from "@/lib/web-monitor/notify/types";
import { findWebTarget } from "@/lib/web-monitor/registry";
import type { WebRunInput, WebRunReport, WebTargetRunReport } from "@/lib/web-monitor/runner";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import { applyRunDecision } from "@/lib/web-monitor/transition";
import { buildWebReport, type WebCriticalRow, type WebDayRow } from "@/lib/reports/web-section";
import { kstClock } from "@/lib/time";
import type { WebTransport } from "@/lib/web-monitor/probes/types";

// KST 시각을 UTC 밀리초로 (KST = UTC+9). 2026-11-11은 수요일, 11-14는 토요일, 11-15는 일요일
const kst = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s);
const ON: WebSettings = { ...DEFAULT_WEB_SETTINGS, criticalEnabled: true };

describe("KST 요일·시·분 (lib/time.ts kstClock)", () => {
  it("UTC 15:00은 KST 다음날 00:00이고, 일요일은 7이다", () => {
    expect(kstClock(new Date(Date.UTC(2026, 10, 10, 15, 0)))).toEqual({ isoDow: 3, hour: 0, minute: 0 }); // 화 24시 = 수 00시
    expect(kstClock(new Date(kst(2026, 11, 15, 12, 34)))).toEqual({ isoDow: 7, hour: 12, minute: 34 });
    expect(kstClock(new Date(kst(2026, 11, 9, 9, 0)))).toEqual({ isoDow: 1, hour: 9, minute: 0 });
  });
});

describe("핵심 시간대 구간 (평일 09~11·14~18, 끝 미포함) 경계", () => {
  const ranges = DEFAULT_WEB_SETTINGS.criticalRanges;
  const at = (h: number, mi: number, day = 11) => new Date(kst(2026, 11, day, h, mi));
  it("08:59 밖 / 09:00 안 / 10:59 안 / 11:00 밖", () => {
    expect(isInCriticalHours(at(8, 59), ranges)).toBe(false);
    expect(isInCriticalHours(at(9, 0), ranges)).toBe(true);
    expect(isInCriticalHours(at(10, 59), ranges)).toBe(true);
    expect(isInCriticalHours(at(11, 0), ranges)).toBe(false);
  });
  it("13:59 밖 / 14:00 안 / 17:59 안 / 18:00 밖", () => {
    expect(isInCriticalHours(at(13, 59), ranges)).toBe(false);
    expect(isInCriticalHours(at(14, 0), ranges)).toBe(true);
    expect(isInCriticalHours(at(17, 59), ranges)).toBe(true);
    expect(isInCriticalHours(at(18, 0), ranges)).toBe(false);
  });
  it("주말(토·일)에는 구간 안 시각이어도 아니다. 금요일 17시는 맞다", () => {
    expect(isInCriticalHours(at(10, 0, 14), ranges)).toBe(false); // 토
    expect(isInCriticalHours(at(10, 0, 15), ranges)).toBe(false); // 일
    expect(isInCriticalHours(at(17, 0, 13), ranges)).toBe(true); // 금
  });
  it("UTC 날짜와 KST 날짜가 달라지는 시각을 올바로 본다 (KST 09:00 = UTC 00:00)", () => {
    expect(isInCriticalHours(new Date(Date.UTC(2026, 10, 11, 0, 0)), ranges)).toBe(true); // 수 09:00 KST
    expect(isInCriticalHours(new Date(Date.UTC(2026, 10, 10, 23, 59)), ranges)).toBe(false); // 수 08:59 KST
    expect(isInCriticalHours(new Date(Date.UTC(2026, 10, 13, 15, 0)), ranges)).toBe(false); // 금 24시 = 토 00시
  });
});

describe("촉진 칸 (매시 :07 기준, :07 자체는 제외)", () => {
  it("간격 10분: :17·:27·:37·:47·:57만, :07과 그 밖의 분은 아님", () => {
    const hits = Array.from({ length: 60 }, (_, m) => m).filter((m) => isCriticalGridMinute(m, 10));
    expect(hits).toEqual([17, 27, 37, 47, 57]);
  });
  it("간격 5·15·20·30분", () => {
    const hitsOf = (i: number) => Array.from({ length: 60 }, (_, m) => m).filter((m) => isCriticalGridMinute(m, i));
    expect(hitsOf(5)).toEqual([2, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
    expect(hitsOf(15)).toEqual([22, 37, 52]);
    expect(hitsOf(20)).toEqual([27, 47]);
    expect(hitsOf(30)).toEqual([37]);
  });
  it("isCriticalSlot: 켜짐 + 구간 안 + 촉진 칸일 때만 true", () => {
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 14, 17)), ON)).toBe(true);
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 14, 17)), DEFAULT_WEB_SETTINGS), "꺼짐").toBe(false);
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 14, 7)), ON), ":07은 정시 점검").toBe(false);
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 14, 20)), ON), "칸이 아님").toBe(false);
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 18, 17)), ON), "구간 밖(18시)").toBe(false);
    expect(isCriticalSlot(new Date(kst(2026, 11, 11, 17, 57)), ON), "구간 마지막 칸").toBe(true);
    expect(isCriticalSlot(new Date(kst(2026, 11, 14, 14, 17)), ON), "토요일").toBe(false);
  });
  it("criticalSlotAt은 분 단위로 자른다 (같은 분의 중복 호출은 같은 칸)", () => {
    expect(criticalSlotAt(kst(2026, 11, 11, 14, 17, 42)).getTime()).toBe(kst(2026, 11, 11, 14, 17, 0));
    expect(criticalSlotAt(kst(2026, 11, 11, 14, 17, 0)).getTime()).toBe(kst(2026, 11, 11, 14, 17, 0));
  });
  it("criticalNowOf: 켜짐 설정이 꺼져 있으면 구간 안이어도 false (알림 강조는 켠 뒤에만)", () => {
    const t = new Date(kst(2026, 11, 11, 15, 0));
    expect(criticalNowOf(DEFAULT_WEB_SETTINGS, t)).toBe(false);
    expect(criticalNowOf(ON, t)).toBe(true);
  });
});

// ---- decide ----
const T0 = kst(2026, 11, 11, 14, 17);
const mk = (o: Partial<DecideInput> & Pick<DecideInput, "trigger" | "verdict">): DecideInput => ({
  targetKey: "onbid-home",
  runId: 1,
  now: new Date(T0),
  certExpiring: false,
  certDaysLeft: null,
  aux: [],
  inWindow: false,
  state: null,
  settings: ON,
  ...o,
});
function openState(): WebStateForDecision {
  // 정시 실패 → 재확인 실패로 사건을 연다
  const first = decide(mk({ trigger: "scheduled", verdict: "FAIL", runId: 1, now: new Date(kst(2026, 11, 11, 14, 7)) }));
  expect(first.kind).toBe("defer");
  const second = decide(mk({ trigger: "retry", verdict: "FAIL", runId: 2, originRunId: 1, now: new Date(kst(2026, 11, 11, 14, 9)) }));
  if (second.kind === "defer" || second.kind === "ignore") throw new Error("사건이 열려야 한다");
  expect(second.decision.state.incident_open).toBe(true);
  return { ...second.decision.state, version: 1 };
}

describe("decide — 촉진(critical) 실행은 실패→재확인→장애, 정상→복구에만 쓴다", () => {
  it("실패 + 열린 사건 없음 → 재확인 요구(defer), 상태·알림 변화 없음", () => {
    expect(decide(mk({ trigger: "critical", verdict: "FAIL" })).kind).toBe("defer");
  });

  it("정상 + 사건 없음 → 무시(기록만)", () => {
    expect(decide(mk({ trigger: "critical", verdict: "PASS_DATA" })).kind).toBe("ignore");
    expect(decide(mk({ trigger: "critical", verdict: "PASS_NO_DATA", state: openStateClosed() })).kind).toBe("ignore");
  });

  it("저하·확인 불가·미점검은 사건이 있든 없든 무시한다 (연속 횟수 규칙은 정시 1시간 간격 기준)", () => {
    const open = openState();
    for (const verdict of ["DEGRADED", "UNVERIFIED", "NOT_RUN"] as WebVerdict[]) {
      expect(decide(mk({ trigger: "critical", verdict, state: null })).kind, `${verdict} 사건 없음`).toBe("ignore");
      expect(decide(mk({ trigger: "critical", verdict, state: open })).kind, `${verdict} 사건 있음`).toBe("ignore");
    }
  });

  it("점검 문구 감지·계획 점검 창 안은 무시한다 (미등록 점검 알림·창 처리는 정시 점검만)", () => {
    expect(decide(mk({ trigger: "critical", verdict: "FAIL", maintenanceDetected: true })).kind).toBe("ignore");
    expect(decide(mk({ trigger: "critical", verdict: "FAIL", inWindow: true })).kind).toBe("ignore");
    expect(decide(mk({ trigger: "critical", verdict: "PASS_DATA", inWindow: true, state: openState() })).kind, "창 안 복구도 촉진은 하지 않는다").toBe("ignore");
  });

  it("정상 + 열린 사건 → 복구 알림(핵심 시간대 표시 포함), 사건 종료", () => {
    const res = decide(mk({ trigger: "critical", verdict: "PASS_DATA", state: openState(), now: new Date(kst(2026, 11, 11, 14, 27)), criticalNow: true }));
    if (res.kind === "defer" || res.kind === "ignore") throw new Error("복구여야 한다");
    expect(res.decision.state.incident_open).toBe(false);
    expect(res.decision.recovery).not.toBeNull();
    const n = res.decision.notifications.find((x) => x.kind === "recovered");
    expect(n?.payload).toMatchObject({ critical: true });
  });

  it("인증서 임박·보조 이상은 촉진 실행에서는 세지 않는다 (정시 규칙의 횟수·하루 1회 표시가 10분마다 움직이지 않게)", () => {
    const open = openState();
    const res = decide(mk({ trigger: "critical", verdict: "PASS_DATA", state: open, certExpiring: true, certDaysLeft: 3, aux: [{ key: "aux-queue", verdict: "FAIL" }] }));
    if (res.kind === "defer" || res.kind === "ignore") throw new Error("복구여야 한다");
    expect(res.decision.notifications.map((x) => x.kind)).toEqual(["recovered"]);
    expect(res.decision.state.aux_state).not.toHaveProperty("aux-queue");
  });

  it("사건 중 실패 → 지속 알림 간격: 핵심 시간대 안에서는 min(3시간, 60분), 밖에서는 3시간", () => {
    const open = openState(); // incident_last_alert_at = 14:09
    const at = (mi: number) => new Date(kst(2026, 11, 11, 15, mi)); // 15:09 = 60분 경과
    const hot = decide(mk({ trigger: "critical", verdict: "FAIL", state: open, now: at(9), criticalNow: true }));
    if (hot.kind === "defer" || hot.kind === "ignore") throw new Error("전환이어야 한다");
    expect(hot.decision.notifications.map((n) => n.kind)).toEqual(["ongoing"]);
    expect(hot.decision.notifications[0].payload).toMatchObject({ critical: true });
    const justBefore = decide(mk({ trigger: "critical", verdict: "FAIL", state: open, now: new Date(kst(2026, 11, 11, 15, 8)), criticalNow: true }));
    if (justBefore.kind === "defer" || justBefore.kind === "ignore") throw new Error("전환이어야 한다");
    expect(justBefore.decision.notifications, "59분 경과는 아직").toEqual([]);
    const cold = decide(mk({ trigger: "scheduled", verdict: "FAIL", state: open, now: at(9), criticalNow: false }));
    if (cold.kind === "defer" || cold.kind === "ignore") throw new Error("전환이어야 한다");
    expect(cold.decision.notifications, "핵심 시간대 밖(또는 꺼짐)은 3시간 간격").toEqual([]);
    expect(cold.decision.notifications.some((n) => "critical" in n.payload)).toBe(false);
  });

  it("지속 알림 간격이 평소(1시간)보다 짧은 설정이어도 평소 간격보다 길어지지 않는다", () => {
    const s: WebSettings = { ...ON, realertAfterHours: 1, criticalOngoingMin: 60 };
    const open = openState();
    const res = decide(mk({ trigger: "critical", verdict: "FAIL", state: open, now: new Date(kst(2026, 11, 11, 15, 9)), criticalNow: true, settings: s }));
    if (res.kind === "defer" || res.kind === "ignore") throw new Error("전환이어야 한다");
    expect(res.decision.notifications.map((n) => n.kind)).toEqual(["ongoing"]);
  });

  it("핵심 시간대 표시는 정시 실행에서도 장애 감지 알림에 붙는다", () => {
    const res = decide(mk({ trigger: "retry", verdict: "FAIL", runId: 2, originRunId: 1, criticalNow: true }));
    if (res.kind === "defer" || res.kind === "ignore") throw new Error("전환이어야 한다");
    expect(res.decision.notifications.find((n) => n.kind === "down")?.payload).toMatchObject({ critical: true });
  });
});

function openStateClosed(): WebStateForDecision {
  const s = openState();
  return { ...s, incident_open: false, first_failure_at: null, incident_last_alert_at: null };
}

// ---- 알림 문구 ----
describe("알림 문구 — 핵심 시간대 강조", () => {
  const item = (kind: string, payload: Record<string, unknown>): UnsentNotification => ({ key: `${kind}:1`, kind, targetKey: "onbid-home", attempt: 0, payload, createdAt: new Date(kst(2026, 11, 11, 15, 0)), incidentNo: 1 }) as unknown as UnsentNotification;
  const ctx = { targetLabel: "온비드 홈페이지" };
  it("critical 표시가 있는 장애·저하·복구·지속 알림은 맨 앞 줄이 강조 문구다", () => {
    for (const kind of ["down", "degraded", "recovered", "ongoing"]) {
      const text = buildMessage(item(kind, { critical: true, verdict: "FAIL", minutes: 12 }), ctx);
      expect(text.split("\n")[0], kind).toBe(CRITICAL_BANNER);
    }
    expect(CRITICAL_BANNER).toContain("핵심 시간대");
  });
  it("표시가 없거나 다른 종류(인증서·보조·점검 불가·억제)에는 붙지 않는다", () => {
    expect(buildMessage(item("down", { verdict: "FAIL" }), ctx)).not.toContain("핵심 시간대");
    expect(buildMessage(item("down", { critical: false, verdict: "FAIL" }), ctx)).not.toContain("핵심 시간대");
    for (const kind of ["cert", "aux", "unverifiable", "suppressed", "unplanned"]) expect(buildMessage(item(kind, { critical: true }), ctx), kind).not.toContain("핵심 시간대");
  });
});

// ---- 입구 ----
const transport: WebTransport = { lookup: async () => {}, tls: async () => ({ notAfterMs: 0, hostnameMatches: true }), get: async () => { throw new Error("호출되면 안 됩니다"); } };
const okReport = (): WebRunReport => ({ targets: [{ targetKey: "onbid-home", runId: 5, status: "succeeded", overall: "PASS_DATA", requestCount: 5, finalized: true, storeError: false, probes: [] }] });

function setupCron(over: { now?: number; settings?: WebSettings; secret?: string | undefined } = {}) {
  const calls: WebRunInput[] = [];
  const now = over.now ?? kst(2026, 11, 11, 14, 17, 30);
  const deps: WebCronDeps = {
    secret: () => ("secret" in over ? over.secret : "s3cret"),
    prepare: async () => ({ settings: over.settings ?? ON, store: createMemoryWebStore() }),
    targets: () => [findWebTarget("onbid-home")!],
    transport,
    clock: { now: () => now, sleep: async () => {} },
    runWebCheck: vi.fn(async (input: WebRunInput) => {
      calls.push(input);
      return okReport();
    }),
  };
  return { deps, calls };
}

describe("촉진 점검 입구 (POST /api/cron/web-check-critical)", () => {
  it("인증: 비밀값이 틀리거나 없으면 401·503, 점검하지 않는다", async () => {
    const a = setupCron();
    expect((await runCriticalWebCheck("Bearer wrong", a.deps)).httpStatus).toBe(401);
    expect((await runCriticalWebCheck(null, a.deps)).httpStatus).toBe(401);
    const b = setupCron({ secret: undefined });
    expect((await runCriticalWebCheck("Bearer s3cret", b.deps)).httpStatus).toBe(503);
    expect(a.calls.length + b.calls.length).toBe(0);
  });

  it("촉진 점검이 꺼져 있으면(기본) 200으로 건너뛴다", async () => {
    const { deps, calls } = setupCron({ settings: DEFAULT_WEB_SETTINGS });
    const res = await runCriticalWebCheck("Bearer s3cret", deps);
    expect(res).toMatchObject({ httpStatus: 200, body: { ok: true, skipped: "disabled" } });
    expect(calls).toHaveLength(0);
  });

  it("전체 점검(web_monitor_enabled)이 꺼져 있으면 촉진 점검도 건너뛴다", async () => {
    const { deps, calls } = setupCron({ settings: { ...ON, monitorEnabled: false } });
    expect((await runCriticalWebCheck("Bearer s3cret", deps)).body.skipped).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("촉진 칸이 아니면(:07·구간 밖·주말) 건너뛴다 — DB가 부르더라도 앱이 한 번 더 확인", async () => {
    for (const now of [kst(2026, 11, 11, 14, 7, 30), kst(2026, 11, 11, 18, 17, 0), kst(2026, 11, 14, 14, 17, 0), kst(2026, 11, 11, 14, 20, 0)]) {
      const { deps, calls } = setupCron({ now });
      const res = await runCriticalWebCheck("Bearer s3cret", deps);
      expect(res.body.skipped, new Date(now).toISOString()).toBe("not-slot");
      expect(calls).toHaveLength(0);
    }
  });

  it("촉진 칸이면 trigger='critical', 칸 시각(분 단위)으로 실행한다", async () => {
    const { deps, calls } = setupCron();
    const res = await runCriticalWebCheck("Bearer s3cret", deps);
    expect(res.httpStatus).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].trigger).toBe("critical");
    expect(calls[0].slotAt?.getTime()).toBe(kst(2026, 11, 11, 14, 17, 0));
    expect(calls[0].triggeredBy ?? null).toBeNull();
  });

  it("실행기가 예외를 던져도 내부 문구 없이 500", async () => {
    const { deps } = setupCron();
    deps.runWebCheck = async () => {
      throw new Error("비밀 내부 문구 secret-host.internal");
    };
    const res = await runCriticalWebCheck("Bearer s3cret", deps);
    expect(res.httpStatus).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret-host");
  });
});

// ---- 실행기·저장소·연결부 ----
const probesOf = (overall: WebVerdict): ProbeResult[] => [
  base("L1_CONNECT", true),
  overall === "FAIL" ? out(base("L2_HTTP", true), "FAIL", "HTTP_5XX", { httpStatus: 503 }) : base("L2_HTTP", true),
  base("L3_CONTENT", true),
  base("AUX_STUB", false),
  base("AUX_QUEUE", false),
];
async function criticalRun(store: ReturnType<typeof createMemoryWebStore>, overall: WebVerdict, slotMin: number): Promise<WebTargetRunReport> {
  const started = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, slotMin)) });
  if (started.status === "blocked") return { targetKey: "onbid-home", runId: started.runId, status: "blocked", overall: null, requestCount: 0, finalized: true, storeError: false, probes: [] };
  await store.finishRun({ runId: started.runId, status: "succeeded", overallVerdict: overall, requestCount: 5 });
  return { targetKey: "onbid-home", runId: started.runId, status: "succeeded", overall, requestCount: 5, finalized: true, storeError: false, probes: probesOf(overall) };
}

describe("저장소·연결부 — 촉진 실행", () => {
  it("runner: 촉진 점검은 칸 시각이 반드시 있어야 하고, 수동·재확인에는 있으면 안 된다", async () => {
    const store = createMemoryWebStore();
    const input = { targets: [findWebTarget("onbid-home")!], settings: ON, store, transport, clock: { now: () => kst(2026, 11, 11, 14, 17), sleep: async () => {} } };
    await expect(runWebCheck({ ...input, trigger: "critical" })).rejects.toThrow(RangeError);
    await expect(runWebCheck({ ...input, trigger: "manual", slotAt: new Date(0) })).rejects.toThrow(RangeError);
  });

  it("같은 칸의 촉진 실행은 하나만 인정되고, 막혀도 대체 실행 줄(replace)을 만들지 않는다", async () => {
    const store = createMemoryWebStore();
    const a = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, 17)) });
    expect(a.status).toBe("running");
    const dup = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, 17)) });
    expect(dup.status, "실행 중이거나 같은 칸이면 막힘").toBe("blocked");
    expect(store.queue, "촉진은 건너뛰기만 한다").toHaveLength(0);
    await store.finishRun({ runId: a.runId, status: "succeeded", overallVerdict: "PASS_DATA", requestCount: 5 });
    const dup2 = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, 17)) });
    expect(dup2.status, "끝난 같은 칸도 막힘").toBe("blocked");
    const next = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, 27)) });
    expect(next.status).toBe("running");
    const run = store.runs.find((r) => r.id === next.runId)!;
    expect(run.slotAt, "정시 칸(slot_at)은 비어 있다").toBeNull();
    expect(run.criticalSlotAt?.getTime()).toBe(kst(2026, 11, 11, 14, 27));
  });

  it("정시 점검과 같은 시각 칸이 겹치지 않는다 (정시 칸 유일 규칙은 촉진 실행을 세지 않는다)", async () => {
    const store = createMemoryWebStore();
    const c = await store.startRun({ targetKey: "onbid-home", trigger: "critical", slotAt: new Date(kst(2026, 11, 11, 14, 17)) });
    await store.finishRun({ runId: c.runId, status: "succeeded", overallVerdict: "PASS_DATA", requestCount: 5 });
    const s = await store.startRun({ targetKey: "onbid-home", trigger: "scheduled", slotAt: new Date(kst(2026, 11, 11, 14, 0)) });
    expect(s.status).toBe("running");
  });

  it("촉진 실패 → 재확인 예약(출처 = 촉진 실행) → 재확인도 실패면 장애 확정·알림 키 선점(핵심 시간대 표시 포함)", async () => {
    const store = createMemoryWebStore();
    const settings = ON;
    const r1 = await criticalRun(store, "FAIL", 17);
    const out1 = await applyRunDecision({ report: r1, trigger: "critical", startedAt: new Date(kst(2026, 11, 11, 14, 17)), settings, store, criticalNow: true });
    expect(out1).toMatchObject({ action: "deferred", confirmQueued: true });
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]).toMatchObject({ kind: "confirm", originRunId: r1.runId });

    const retry = await store.startRun({ targetKey: "onbid-home", trigger: "retry", originRunId: r1.runId });
    await store.finishRun({ runId: retry.runId, status: "succeeded", overallVerdict: "FAIL", requestCount: 5 });
    const out2 = await applyRunDecision({
      report: { targetKey: "onbid-home", runId: retry.runId, status: "succeeded", overall: "FAIL", requestCount: 5, finalized: true, storeError: false, probes: probesOf("FAIL") },
      trigger: "retry",
      originRunId: r1.runId,
      startedAt: new Date(kst(2026, 11, 11, 14, 19)),
      settings,
      store,
      criticalNow: true,
    });
    expect(out2.action).toBe("applied");
    expect(out2.claimedKeys?.[0]).toBe("down:1");
    const down = store.notifications.find((n) => n.key === "down:1");
    expect(down?.payload).toMatchObject({ critical: true });
  });

  it("촉진 실행의 저하·정상(사건 없음)은 무시되어 상태 줄을 만들지도 바꾸지도 않는다", async () => {
    const store = createMemoryWebStore();
    for (const [v, mi] of [["DEGRADED", 17], ["PASS_DATA", 27], ["UNVERIFIED", 37]] as const) {
      const r = await criticalRun(store, v, mi);
      const o = await applyRunDecision({ report: r, trigger: "critical", startedAt: new Date(kst(2026, 11, 11, 14, mi)), settings: ON, store, criticalNow: true });
      expect(o, v).toMatchObject({ action: "skipped", reason: "critical_ignored" });
    }
    expect(store.states.size ?? 0).toBe(0);
    expect(store.notifications).toHaveLength(0);
    expect(store.queue).toHaveLength(0);
  });
});

// ---- 보고서: 핵심 시간대 가용률 ----
describe("보고서 — 핵심 시간대 가용률은 따로 센다", () => {
  const day: WebDayRow = {
    target_key: "onbid-home", pass_data: 24, pass_no_data: 0, degraded: 0, fail: 0, unverified: 0, not_run: 0, planned_count: 0, unplanned_count: 0,
    flap_count: 0, confirmed_down_count: 0, down_seconds: 0, avg_ms: 200, max_ms: 300,
  };
  const crit: WebCriticalRow = { target_key: "onbid-home", pass_data: 29, pass_no_data: 0, degraded: 0, fail: 1, unverified: 0, not_run: 0, planned_count: 0, unplanned_count: 0, critical_runs: 30 };
  it("정시 가용률은 그대로이고 critical 칸에 정시+촉진 집계가 따로 들어간다", () => {
    const r = buildWebReport({ rows: [day], labelOf: () => "온비드 홈페이지", anomalies: [], criticalRows: [crit] });
    expect(r.targets[0].avail).toEqual({ num: 24, den: 24 });
    expect(r.targets[0].critical).toEqual({ avail: { num: 29, den: 30 }, judged: 30, criticalRuns: 30 });
  });
  it("핵심 시간대 집계가 없으면(꺼짐·주말·보존 경과·함수 오류) critical 칸이 없다 — 기존 보고서 모양 그대로", () => {
    const r = buildWebReport({ rows: [day], labelOf: () => "온비드 홈페이지", anomalies: [] });
    expect(r.targets[0]).not.toHaveProperty("critical");
    const r2 = buildWebReport({ rows: [day], labelOf: () => "온비드 홈페이지", anomalies: [], criticalRows: [] });
    expect(r2.targets[0]).not.toHaveProperty("critical");
  });
  it("확인 불가·미점검·계획·미등록은 같은 분모 규칙으로 뺀다", () => {
    const c: WebCriticalRow = { ...crit, pass_data: 20, fail: 2, unverified: 3, not_run: 1, planned_count: 2, unplanned_count: 1, critical_runs: 10 };
    const r = buildWebReport({ rows: [day], labelOf: () => "x", anomalies: [], criticalRows: [c] });
    // 판정 26 − 확인 불가 3 − 미점검 1 − 계획 2 − 미등록 1 = 19, 분자는 분모로 막는다(20 → 19)
    expect(r.targets[0].critical?.avail).toEqual({ num: 19, den: 19 });
  });
});

// 확인 재시도·정시 대체 실행 입구(POST /api/cron/web-retry)와 정시 점검 → 재확인 전체 흐름 시험 (W11) — 가짜 저장소·가짜 프로브만 쓴다
import { describe, expect, it, vi } from "vitest";
import { base, out, type ProbeResult, type WebVerdict } from "@/lib/web-monitor/classify";
import { runScheduledWebCheck, type WebCronDeps } from "@/lib/web-monitor/cron-web-check";
import { MAX_RETRIES_PER_CALL, runWebRetries, type WebRetryCronDeps } from "@/lib/web-monitor/cron-web-retry";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { runWebCheck, type WebRunInput } from "@/lib/web-monitor/runner";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import type { TargetProbeOutcome } from "@/lib/web-monitor/probes/target";
import type { WebTransport } from "@/lib/web-monitor/probes/types";

const AUTH = "Bearer s3cret-value";
const T0 = Date.UTC(2026, 10, 5, 5, 7, 0); // 05:07 UTC
const MIN = 60_000;
const transport: WebTransport = { lookup: async () => {}, tls: async () => ({ notAfterMs: 0, hostnameMatches: true }), get: async () => { throw new Error("실제 요청은 하지 않는다"); } };

// 시각·프로브 결과를 시험이 정하는 환경
function world(settings: WebSettings = DEFAULT_WEB_SETTINGS) {
  let t = T0;
  const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
  const store = createMemoryWebStore({ now: () => t });
  const verdicts: WebVerdict[] = []; // 앞에서부터 하나씩 꺼내 쓰는 프로브 결과
  let probeCalls = 0;
  let probeError = false;
  const probe = vi.fn(async (): Promise<TargetProbeOutcome> => {
    probeCalls += 1;
    if (probeError) throw new Error("내부 예외 https://www.onbid.co.kr/?serviceKey=SECRET");
    const overall = verdicts.shift() ?? "PASS_DATA";
    const probes: ProbeResult[] = [base("L1_CONNECT", true), overall === "FAIL" ? out(base("L2_HTTP", true), "FAIL", "HTTP_5XX", { httpStatus: 503 }) : base("L2_HTTP", true), base("L3_CONTENT", true)];
    return { verdict: { overall, probes, certExpiring: false, certDaysLeft: null, maintenanceDetected: false }, aux: [], requestCount: 5 };
  });
  const run = (input: WebRunInput) => runWebCheck({ ...input, probe });
  const target = findWebTarget("onbid-home")!;
  const checkDeps: WebCronDeps = {
    secret: () => "s3cret-value",
    prepare: async () => ({ settings, store, transitionStore: store }),
    targets: () => [target],
    transport,
    clock,
    runWebCheck: run,
  };
  const retryDeps: WebRetryCronDeps = {
    secret: () => "s3cret-value",
    prepare: async () => ({ settings, store, transitionStore: store, retryStore: store }),
    findTarget: (k) => findWebTarget(k),
    transport,
    clock,
    runWebCheck: run,
  };
  return {
    store, clock, verdicts, probe, checkDeps, retryDeps,
    setTime: (ms: number) => void (t = ms),
    advance: (ms: number) => void (t += ms),
    setProbeError: (v: boolean) => void (probeError = v),
    get probeCalls() { return probeCalls; },
    check: () => runScheduledWebCheck(AUTH, checkDeps),
    retry: () => runWebRetries(AUTH, retryDeps),
  };
}

describe("입구 인증·꺼짐·설정 오류 (SEC-09 방식)", () => {
  it("헤더가 없거나 값이 틀리거나 길이가 달라도 401이고 줄을 선점하지 않는다", async () => {
    for (const header of [null, "Bearer wrong-value", "Bearer s3cret-valu", "Bearer s3cret-value-extra", "s3cret-value"]) {
      const w = world();
      const prepare = vi.fn(w.retryDeps.prepare);
      const res = await runWebRetries(header, { ...w.retryDeps, prepare });
      expect(res.httpStatus, String(header)).toBe(401);
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it("서버에 CRON_SECRET이 없으면 503", async () => {
    const w = world();
    expect((await runWebRetries("Bearer x", { ...w.retryDeps, secret: () => undefined })).httpStatus).toBe(503);
  });

  it("점검이 꺼져 있으면 줄을 선점하지도 점검하지도 않는다 (200 skipped)", async () => {
    const w = world({ ...DEFAULT_WEB_SETTINGS, monitorEnabled: false });
    await w.store.startRun({ targetKey: "onbid-home", trigger: "scheduled", slotAt: new Date(T0) });
    const res = await w.retry();
    expect(res).toMatchObject({ httpStatus: 200, body: { ok: true, skipped: "disabled" } });
    expect(w.probeCalls).toBe(0);
  });

  it("설정을 읽지 못하면 503이고 내부 문구가 없다", async () => {
    const w = world();
    const res = await runWebRetries(AUTH, { ...w.retryDeps, prepare: async () => { throw new Error("relation web_settings db.internal:5432"); } });
    expect(res.httpStatus).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/web_settings|db\.internal|5432/);
  });

  it("처리 중 예외가 나도 응답에 예외 문구·주소·비밀값이 없다", async () => {
    const w = world();
    const res = await runWebRetries(AUTH, { ...w.retryDeps, prepare: async () => ({ ...(await w.retryDeps.prepare()), retryStore: { claimDue: async () => { throw new Error("https://x?serviceKey=SECRET"); }, finish: async () => false, getRun: async () => null } }) });
    expect(res.httpStatus).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/serviceKey|SECRET|https?:/);
  });
});

describe("빈 큐", () => {
  it("예정된 줄이 없으면 점검도 하지 않고 processed=0", async () => {
    const w = world();
    const res = await w.retry();
    expect(res.body).toMatchObject({ ok: true, processed: 0 });
    expect(w.probeCalls).toBe(0);
  });
});

describe("정시 점검 → 확인 재시도 전체 흐름", () => {
  it("정시 실패 → 재확인 예약 → 90초 뒤 재확인 실패 → 장애 감지(알림 1건, 이상징후, 원래 실행 확정)", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL");
    const first = await w.check();
    expect(first.body.runs).toEqual([{ target: "onbid-home", status: "succeeded", follow: "deferred" }]);
    expect(w.store.states.size).toBe(0); // 아직 상태·알림 변화 없음
    expect(w.store.queue).toHaveLength(1);

    w.advance(60_000); // 60초: 아직 예정 시각 전
    expect((await w.retry()).body.processed).toBe(0);
    expect(w.probeCalls).toBe(1);

    w.advance(30_000); // 90초
    expect((await w.retry()).body).toMatchObject({ ok: true, processed: 1 });
    expect(w.probeCalls).toBe(2);
    expect(w.store.queue[0].status).toBe("done");
    expect(w.store.notifications.map((n) => n.key)).toEqual(["down:1"]);
    expect(w.store.states.get("onbid-home")).toMatchObject({ incident_open: true, incident_no: 1, current_verdict: "FAIL" });
    expect(w.store.detections).toHaveLength(1);
    const origin = w.store.runs[0];
    expect(origin).toMatchObject({ trigger: "scheduled", confirmedVerdict: "FAIL", flap: false });
    expect(w.store.runs[1]).toMatchObject({ trigger: "retry", originRunId: origin.id });
  });

  it("정시 실패 → 재확인 정상 → 알림 0건·이상징후 없음·일시 실패(flap) 1건", async () => {
    const w = world();
    w.verdicts.push("FAIL", "PASS_DATA");
    await w.check();
    w.advance(90_000);
    await w.retry();
    expect(w.store.notifications).toHaveLength(0);
    expect(w.store.detections).toHaveLength(0);
    expect(w.store.runs[0]).toMatchObject({ confirmedVerdict: "PASS_DATA", flap: true });
    expect(w.store.states.get("onbid-home")).toMatchObject({ current_verdict: "PASS_DATA", incident_open: false });
  });

  it("사건이 열려 있는 동안의 정시 실패는 재확인 없이 바로 평가한다 (장애 지속)", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL", "FAIL");
    await w.check();
    w.advance(90_000);
    await w.retry();
    w.setTime(T0 + 3_600_000); // 다음 정시
    const second = await w.check();
    expect(second.body.runs?.[0]).toMatchObject({ follow: "applied" });
    expect(w.store.queue.filter((q) => q.status === "pending")).toHaveLength(0);
  });

  it("예약된 뒤 사건이 열렸으면 재확인하지 않고 줄을 취소한다", async () => {
    const w = world();
    w.verdicts.push("FAIL");
    await w.check();
    // 재확인이 돌기 전에 사건이 열린 것으로 만든다 (다른 경로로 상태가 바뀐 경우)
    w.store.states.set("onbid-home", { current_verdict: "FAIL", since: new Date(T0).toISOString(), first_failure_at: new Date(T0).toISOString(), incident_no: 1, incident_open: true, incident_last_alert_at: new Date(T0).toISOString(), ongoing_count: 0, consecutive_degraded: 0, degraded_start_run_id: null, consecutive_unverifiable: 0, unverifiable_start_run_id: null, aux_state: {}, unplanned_since_run_id: null, unplanned_since: null, alerts_today: 1, alerts_today_date: "2026-11-05", version: 1 });
    w.advance(90_000);
    await w.retry();
    expect(w.probeCalls).toBe(1); // 재확인 점검은 하지 않았다
    expect(w.store.queue[0].status).toBe("cancelled");
  });
});

describe("대기 줄 수명주기", () => {
  it("동시에 두 번 불려도 한 줄은 한 번만 처리된다 (중복 처리 방지)", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL");
    await w.check();
    w.advance(90_000);
    const [a, b] = await Promise.all([w.retry(), w.retry()]);
    expect((a.body.processed ?? 0) + (b.body.processed ?? 0)).toBe(1);
    expect(w.probeCalls).toBe(2); // 정시 1 + 재확인 1
    expect(w.store.queue[0].attempts).toBe(1);
    expect(w.store.notifications.map((n) => n.key)).toEqual(["down:1"]);
  });

  it("멈춘 처리 중 줄(앱이 죽음)은 5분 뒤 되돌려져 다시 처리된다", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL");
    await w.check();
    w.advance(90_000);
    const claimed = await w.store.claimDue(); // 앱이 줄을 잡고 죽은 상황
    expect(claimed?.attempts).toBe(1);
    w.advance(4 * MIN);
    expect((await w.retry()).body.processed).toBe(0); // 4분: 아직 멈춘 것으로 보지 않음
    w.advance(2 * MIN);
    expect((await w.retry()).body.processed).toBe(1); // 6분: 되돌려져 처리됨
    expect(w.store.queue[0]).toMatchObject({ status: "done", attempts: 2 });
  });

  it("다음 정시 점검이 시작되면 오래된 확인 재시도는 만료되어 점검 없이 취소된다", async () => {
    const w = world();
    w.verdicts.push("FAIL");
    await w.check();
    w.setTime(T0 + 3_600_000);
    await w.store.startRun({ targetKey: "onbid-home", trigger: "scheduled", slotAt: new Date(T0 + 3_600_000) }); // 다음 칸 시작
    expect((await w.retry()).body.processed).toBe(0);
    expect(w.store.queue[0].status).toBe("cancelled");
    expect(w.probeCalls).toBe(1);
  });

  it("등록부에 없는 대상이나 원래 실행이 없는 줄은 점검 없이 취소한다", async () => {
    const w = world();
    w.verdicts.push("FAIL");
    await w.check();
    w.advance(90_000);
    const res = await runWebRetries(AUTH, { ...w.retryDeps, findTarget: () => undefined });
    expect(res.body.processed).toBe(1);
    expect(w.store.queue[0].status).toBe("cancelled");
    expect(w.probeCalls).toBe(1);
  });

  it("점검 중 예외가 나면 다음 분에 다시 시도하도록 되돌리고, 3번 뒤에는 취소한다", async () => {
    const w = world();
    w.verdicts.push("FAIL");
    await w.check();
    w.setProbeError(true);
    for (let i = 0; i < 3; i++) {
      w.advance(i === 0 ? 90_000 : 61_000);
      const res = await w.retry();
      expect(res.httpStatus).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/serviceKey|SECRET|onbid/);
    }
    expect(w.store.queue[0]).toMatchObject({ status: "cancelled", attempts: 3 });
  });

  it("실행기 자체가 예외를 던져도 줄을 되돌리고 응답은 정상이다", async () => {
    const w = world();
    w.verdicts.push("FAIL");
    await w.check();
    w.advance(90_000);
    const res = await runWebRetries(AUTH, { ...w.retryDeps, runWebCheck: async () => { throw new Error("DB 연결 https://x?serviceKey=SECRET"); } });
    expect(res.httpStatus).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/serviceKey|SECRET|https?:/);
    expect(w.store.queue[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("한 번에 처리하는 줄 수에는 상한이 있다", async () => {
    expect(MAX_RETRIES_PER_CALL).toBe(5);
  });
});

describe("정시 점검이 막혔을 때의 대체 실행", () => {
  it("다른 실행 때문에 막히면 대체 실행이 예약되고, 1분 뒤 같은 정시 칸으로 실행된다", async () => {
    const w = world();
    await w.store.startRun({ targetKey: "other", trigger: "manual" }); // 다른 점검이 실행 중
    const blocked = await w.check();
    expect(blocked.body.runs?.[0].status).toBe("blocked");
    expect(w.store.queue).toHaveLength(1);
    expect(w.store.queue[0]).toMatchObject({ kind: "replace", status: "pending" });
    await w.store.finishRun({ runId: w.store.runs[0].id, status: "succeeded", overallVerdict: "PASS_DATA", requestCount: 0 }); // 먼저 실행이 끝남

    w.advance(60_000);
    expect((await w.retry()).body.processed).toBe(1);
    const replaced = w.store.runs.find((r) => r.id !== w.store.runs[0].id && r.trigger === "scheduled" && r.status === "succeeded");
    expect(replaced?.slotAt?.getTime()).toBe(T0 - (T0 % 3_600_000)); // 막힌 정시 칸(05:00) 그대로
    expect(w.store.states.get("onbid-home")).toMatchObject({ current_verdict: "PASS_DATA" });
    expect(w.store.queue[0].status).toBe("done");
  });

  it("대체 실행이 또 막히면 다음 분에 다시 시도하고, 계속 막히면 3번째에 취소한다", async () => {
    const w = world();
    await w.store.startRun({ targetKey: "other", trigger: "manual" });
    await w.check();
    for (let i = 0; i < 3; i++) {
      w.advance(61_000);
      await w.retry();
    }
    expect(w.store.queue[0]).toMatchObject({ status: "cancelled", attempts: 3 });
    expect(w.probeCalls).toBe(0);
  });

  it("대체 실행이 실패 판정이면 확인 재시도가 이어서 예약된다", async () => {
    const w = world();
    await w.store.startRun({ targetKey: "other", trigger: "manual" });
    await w.check();
    await w.store.finishRun({ runId: w.store.runs[0].id, status: "succeeded", overallVerdict: "PASS_DATA", requestCount: 0 });
    w.verdicts.push("FAIL");
    w.advance(60_000);
    await w.retry();
    const confirm = w.store.queue.find((q) => q.kind === "confirm");
    expect(confirm).toMatchObject({ status: "pending" }); // replace 줄을 먼저 마감한 뒤 같은 대상에 새 줄을 예약할 수 있다
  });
});

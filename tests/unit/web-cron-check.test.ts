// 홈페이지 정시 점검 입구(POST /api/cron/web-check) 시험 (W07) — DB·네트워크 없이 의존 주입으로 돌린다
import { describe, expect, it, vi } from "vitest";
import { runScheduledWebCheck, type WebCronDeps } from "@/lib/web-monitor/cron-web-check";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import type { WebRunInput, WebRunReport } from "@/lib/web-monitor/runner";
import type { TargetProbeOutcome } from "@/lib/web-monitor/probes/target";
import type { WebTransport } from "@/lib/web-monitor/probes/types";

const AUTH = "Bearer s3cret-value";
const NOW = Date.UTC(2026, 10, 5, 3, 7, 30); // 2026-11-05 03:07:30 UTC
const transport: WebTransport = { lookup: async () => {}, tls: async () => ({ notAfterMs: 0, hostnameMatches: true }), get: async () => { throw new Error("호출되면 안 됩니다"); } };
const report = (status: WebRunReport["targets"][number]["status"] = "succeeded"): WebRunReport => ({
  targets: [{ targetKey: "onbid-home", runId: 5, status, overall: "PASS_DATA", requestCount: 5, finalized: true, storeError: false, probes: [] }],
});

function setup(over: Partial<WebCronDeps> & { settings?: WebSettings; engine?: WebRunReport | Error } = {}) {
  const calls: WebRunInput[] = [];
  const deps: WebCronDeps = {
    secret: () => "s3cret-value",
    prepare: async () => ({ settings: over.settings ?? DEFAULT_WEB_SETTINGS, store: createMemoryWebStore() }),
    targets: () => [findWebTarget("onbid-home")!],
    transport,
    clock: { now: () => NOW, sleep: async () => {} },
    runWebCheck: vi.fn(async (input: WebRunInput) => {
      calls.push(input);
      if (over.engine instanceof Error) throw over.engine;
      return over.engine ?? report();
    }),
    ...over,
  };
  return { deps, calls };
}

describe("홈페이지 정시 점검 입구 — 인증 (SEC-09 방식)", () => {
  it("헤더가 없거나 값이 틀리거나 길이가 달라도 401이고 설정도 읽지 않으며 점검하지 않는다", async () => {
    for (const header of [null, "Bearer wrong-value", "Bearer s3cret-valu", "Bearer s3cret-value-extra", "s3cret-value", "bearer s3cret-value"]) {
      const prepare = vi.fn(async () => ({ settings: DEFAULT_WEB_SETTINGS, store: createMemoryWebStore() }));
      const { deps, calls } = setup({ prepare });
      const res = await runScheduledWebCheck(header, deps);
      expect(res.httpStatus, String(header)).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    }
  });

  it("서버에 CRON_SECRET이 없으면 어떤 헤더도 통과시키지 않고 503", async () => {
    const { deps, calls } = setup({ secret: () => undefined });
    expect((await runScheduledWebCheck("Bearer ", deps)).httpStatus).toBe(503);
    expect((await runScheduledWebCheck("Bearer anything", deps)).httpStatus).toBe(503);
    expect((await runScheduledWebCheck(null, deps)).httpStatus).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("올바른 비밀값이면 정시(scheduled) 점검을 현재 시각의 정시 칸으로 실행한다", async () => {
    const { deps, calls } = setup();
    const res = await runScheduledWebCheck(AUTH, deps);
    expect(res.httpStatus).toBe(200);
    expect(res.body).toMatchObject({ ok: true, runs: [{ target: "onbid-home", status: "succeeded" }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].trigger).toBe("scheduled");
    expect(calls[0].slotAt?.toISOString()).toBe("2026-11-05T03:00:00.000Z"); // :07:30 → 그 시간의 정각
    expect(calls[0].targets.map((t) => t.key)).toEqual(["onbid-home"]);
    expect(calls[0].triggeredBy ?? null).toBeNull(); // 사람 없이 시작
  });

  it("막힌(blocked) 실행이어도 요청은 처리된 것이라 200으로 답한다", async () => {
    const res = await runScheduledWebCheck(AUTH, setup({ engine: report("blocked") }).deps);
    expect(res.httpStatus).toBe(200);
    expect(res.body.runs).toEqual([{ target: "onbid-home", status: "blocked" }]);
  });
});

describe("홈페이지 정시 점검 입구 — 꺼짐·설정 오류", () => {
  it("web_monitor_enabled가 꺼져 있으면 실행기를 부르지 않고 200으로 '꺼짐'만 알린다", async () => {
    const { deps, calls } = setup({ settings: { ...DEFAULT_WEB_SETTINGS, monitorEnabled: false } });
    const res = await runScheduledWebCheck(AUTH, deps);
    expect(res.httpStatus).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: "disabled" });
    expect(res.body.runs).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("꺼져 있어도 인증은 먼저 확인한다(틀린 비밀값에는 꺼짐 여부도 알리지 않는다)", async () => {
    const res = await runScheduledWebCheck("Bearer wrong", setup({ settings: { ...DEFAULT_WEB_SETTINGS, monitorEnabled: false } }).deps);
    expect(res.httpStatus).toBe(401);
    expect(res.body.skipped).toBeUndefined();
  });

  it("설정을 읽지 못하면(없음·규칙 위반) 기본값으로 대신하지 않고 점검하지 않으며 503, 오류 원문은 담지 않는다", async () => {
    const { deps, calls } = setup({ prepare: async () => { throw new Error("relation \"web_settings\" does not exist at db.internal:5432"); } });
    const res = await runScheduledWebCheck(AUTH, deps);
    expect(res.httpStatus).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/web_settings|db\.internal|5432/);
    expect(calls).toHaveLength(0);
  });
});

describe("홈페이지 정시 점검 입구 — 응답에 내부 정보 없음 (SEC-11 방식)", () => {
  it("실행기에서 예외가 나면 500이고 예외 문구·주소·비밀값이 응답에 없다", async () => {
    const secretLike = "https://www.onbid.co.kr/op/x?serviceKey=ABC123 token=s3cret-value";
    const res = await runScheduledWebCheck(AUTH, setup({ engine: new Error(secretLike) }).deps);
    expect(res.httpStatus).toBe(500);
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/onbid\.co\.kr|serviceKey|ABC123|s3cret-value/);
  });

  it("정상 응답에도 주소·실행 번호·설정값이 없다(대상 이름과 상태만)", async () => {
    const res = await runScheduledWebCheck(AUTH, setup().deps);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/https?:|runId|"id"|Timeout|Ms"/);
    expect(Object.keys(res.body).sort()).toEqual(["message", "ok", "runs"]);
  });
});

describe("홈페이지 정시 점검 입구 — 실제 실행기와 가짜 저장소 연결", () => {
  it("실행기를 그대로 써도 같은 정시 칸을 두 번 부르면 두 번째는 blocked이고 요청을 보내지 않는다", async () => {
    const { runWebCheck } = await import("@/lib/web-monitor/runner");
    const store = createMemoryWebStore();
    const probe = vi.fn(async (): Promise<TargetProbeOutcome> => ({
      verdict: { overall: "PASS_DATA", probes: [], certExpiring: false, certDaysLeft: null, maintenanceDetected: false },
      aux: [],
      requestCount: 5,
    }));
    // 입구가 쓰는 실행기에 시험용 프로브를 끼워 넣는다
    const deps = setup({
      prepare: async () => ({ settings: DEFAULT_WEB_SETTINGS, store }),
      runWebCheck: (input) => runWebCheck({ ...input, probe }),
    }).deps;
    const first = await runScheduledWebCheck(AUTH, deps);
    const second = await runScheduledWebCheck(AUTH, deps);
    expect(first.body.runs).toEqual([{ target: "onbid-home", status: "succeeded" }]);
    expect(second.body.runs).toEqual([{ target: "onbid-home", status: "blocked" }]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(store.queue).toHaveLength(0); // 칸 중복은 대체 실행을 예약하지 않는다
  });
});

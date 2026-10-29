// 점검 실행 엔진 시험 (PLAN 작업 22) — DB 없이 메모리 가짜 저장소로 돌린다.
// 확인하는 것: 정상 점검 160건 채점 · 동시 실행 차단 · 호출 상한 20/100 · 60초 제한 경계 · 오류/타임아웃/0건 ·
//              서비스키·한도 문제 때 탐지 생략 · 중간에 예외가 나도 running으로 남지 않음
import { describe, expect, it } from "vitest";
import { runCheck, type RunCheckInput } from "@/lib/checks/run-check";
import { createDemoFetcher } from "@/lib/checks/demo-fetcher";
import type { ApiFetchResult, CheckStore, Fetcher, FetchedRecord, LogLevel, RunStatus } from "@/lib/checks/types";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { DEFAULT_SETTING_VALUES, parseSettings, type Settings } from "@/lib/settings/schema";

const settings: Settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const BASE = Date.parse("2026-03-01T00:00:00Z");

// 메모리 가짜 저장소: 엔진이 무엇을 기록했는지 그대로 모아 둔다
function fakeStore(over: Partial<CheckStore> & { blocked?: boolean } = {}) {
  const rec = {
    started: 0,
    apiChecks: [] as ApiFetchResult[],
    collected: [] as { kind: string; records: FetchedRecord[] }[],
    logs: [] as { level: LogLevel; code: string; message: string }[],
    finished: [] as { status: RunStatus; calls: number }[],
  };
  const store: CheckStore = {
    async startRun() {
      rec.started += 1;
      return { runId: 7, status: over.blocked ? "blocked" : "running" };
    },
    async recordApiCheck(_id, r) {
      rec.apiChecks.push(r);
    },
    async saveCollected(_id, _source, kind, records) {
      rec.collected.push({ kind, records });
    },
    async log(_id, level, code, message) {
      rec.logs.push({ level, code, message });
    },
    async finishRun(_id, status, calls) {
      rec.finished.push({ status, calls });
    },
    ...over,
  };
  return { store, rec };
}

const demoFetcher = (mode?: "normal" | "http_error" | "timeout" | "empty"): Fetcher =>
  createDemoFetcher({ timeoutSeconds: settings.apiTimeoutSeconds, baseMs: BASE, mode });

const run = (over: Partial<RunCheckInput> & { store: CheckStore }) =>
  runCheck({ trigger: "manual", source: "DEMO", settings, fetcher: demoFetcher(), ...over });

const codes = (rec: { logs: { code: string }[] }) => rec.logs.map((l) => l.code);

describe("정상 점검 (DEMO 160건)", () => {
  it("2번 호출하고 succeeded로 마감한다: 호출 기록 2개 · 수집 저장 2번", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store });
    expect(result).toMatchObject({ runId: 7, status: "succeeded", apiCallCount: 2 });
    expect(rec.apiChecks.map((a) => [a.endpointName, a.outcome])).toEqual([["demo-list", "success"], ["demo-detail", "success"]]);
    expect(rec.collected.map((c) => [c.kind, c.records.length])).toEqual([["list", 159], ["detail", 159]]);
    expect(rec.finished).toEqual([{ status: "succeeded", calls: 2 }]);
  });

  it("탐지 결과가 160건의 정답표와 한 건도 어긋나지 않는다", async () => {
    const { store } = fakeStore();
    const { detections } = await run({ store });
    const got = new Map<string, string[]>();
    for (const d of detections) got.set(d.itemKey, [...(got.get(d.itemKey) ?? []), d.ruleId].sort());
    for (const s of DEMO_SCENARIOS) {
      expect(got.get(s.id) ?? [], s.id).toEqual([...s.expected.rules].sort());
    }
    expect(detections.every((d) => d.source === "DEMO")).toBe(true);
  });

  it("비교 제외 사유를 사유별로 묶어 남긴다 (상세 없음 · 목록 없음 · 10분 초과)", async () => {
    const { store, rec } = fakeStore();
    await run({ store });
    const skipped = rec.logs.filter((l) => l.code === "COMPARE_SKIPPED").map((l) => l.message);
    expect(skipped.some((m) => m.includes("NO_COUNTERPART") && m.includes("2건"))).toBe(true);
    expect(skipped.some((m) => m.includes("WINDOW_EXCEEDED"))).toBe(true);
  });
});

describe("동시 실행 차단", () => {
  it("이미 실행 중이면 blocked로 끝내고 조회·탐지는 하지 않는다", async () => {
    const { store, rec } = fakeStore({ blocked: true });
    const result = await run({ store });
    expect(result).toEqual({ runId: 7, status: "blocked", apiCallCount: 0, detections: [] });
    expect(rec.apiChecks).toHaveLength(0);
    expect(rec.finished).toHaveLength(0); // 마감은 DB 함수가 이미 해 두었다
  });
});

describe("호출 상한 (기본 20 · 최대 100)", () => {
  it("상한 1회면 목록만 부르고 CALL_LIMIT_REACHED를 남기며 partial", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store, callLimit: 1 });
    expect(result).toMatchObject({ status: "partial", apiCallCount: 1 });
    expect(codes(rec)).toContain("CALL_LIMIT_REACHED");
  });

  it("상한 2회면 2번 모두 부르고 succeeded (경계: 한 칸 안)", async () => {
    const { store, rec } = fakeStore();
    expect(await run({ store, callLimit: 2 })).toMatchObject({ status: "succeeded", apiCallCount: 2 });
    expect(codes(rec)).not.toContain("CALL_LIMIT_REACHED");
  });

  it.each([0, -1, 1.5, 101])("잘못된 상한 %s는 실행 기록을 만들기 전에 거부", async (limit) => {
    const { store, rec } = fakeStore();
    await expect(run({ store, callLimit: limit })).rejects.toThrow();
    expect(rec.started).toBe(0);
  });

  it("최대 상한 100은 허용한다", async () => {
    const { store } = fakeStore();
    expect((await run({ store, callLimit: 100 })).status).toBe("succeeded");
  });
});

describe("실행시간 60초 제한", () => {
  // 가상 시계: 첫 호출이 끝났을 때 시계를 advance만큼 앞으로 보낸다
  const withClock = (advanceMs: number) => {
    let now = 0;
    const inner = demoFetcher();
    const fetcher: Fetcher = (endpoint) => {
      const r = inner(endpoint);
      now += advanceMs;
      return r;
    };
    return { clock: () => now, fetcher };
  };

  it("59.999초 지나도 다음 작업을 계속한다 (한 칸 안)", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store, ...withClock(59_999) });
    // 목록 뒤 59.999초 → 상세 호출 가능, 상세 뒤에는 남은 작업이 없으므로 succeeded
    expect(result).toMatchObject({ status: "succeeded", apiCallCount: 2 });
    expect(codes(rec)).not.toContain("RUN_TIME_LIMIT");
  });

  it("정확히 60초가 되면 남은 작업을 하지 않고 RUN_TIME_LIMIT을 남긴다 (한 칸 밖)", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store, ...withClock(60_000) });
    expect(result).toMatchObject({ status: "partial", apiCallCount: 1 });
    expect(codes(rec)).toContain("RUN_TIME_LIMIT");
  });
});

describe("오류 · 타임아웃 · 0건", () => {
  it("한쪽만 HTTP 오류면 partial, API_HTTP_ERROR 메모", async () => {
    let n = 0;
    const normal = demoFetcher();
    const failing = demoFetcher("http_error");
    const { store, rec } = fakeStore();
    const result = await run({ store, fetcher: (e) => (n++ === 0 ? normal(e) : failing(e)) });
    expect(result.status).toBe("partial");
    expect(codes(rec)).toContain("API_HTTP_ERROR");
    expect(rec.apiChecks.map((a) => a.outcome)).toEqual(["success", "http_error"]);
  });

  it("모두 타임아웃이면 failed, 수집·탐지 없음, 응답시간은 10000ms로 기록", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store, fetcher: demoFetcher("timeout") });
    expect(result).toMatchObject({ status: "failed", apiCallCount: 2, detections: [] });
    expect(rec.collected).toHaveLength(0);
    expect(rec.apiChecks.every((a) => a.outcome === "timeout" && a.durationMs === 10_000 && a.httpStatus === null)).toBe(true);
    expect(codes(rec)).toContain("API_TIMEOUT");
  });

  it("빈 결과를 허용하지 않는 API의 0건은 EMPTY_RESULT 이상징후 (식별값은 API 이름)", async () => {
    const { store } = fakeStore();
    const result = await run({ store, fetcher: demoFetcher("empty") });
    expect(result.status).toBe("succeeded"); // 응답은 정상으로 왔다
    expect(result.detections.map((d) => [d.ruleId, d.itemKey, d.source])).toEqual([
      ["EMPTY_RESULT", "demo-list", "DEMO"],
      ["EMPTY_RESULT", "demo-detail", "DEMO"],
    ]);
  });

  it("빈 결과를 허용하는 API의 0건은 정상으로 기록한다", async () => {
    const allowing: Settings = { ...settings, emptyAllowedByEndpoint: { "demo-list": true, "demo-detail": true } };
    const { store } = fakeStore();
    const result = await run({ store, settings: allowing, fetcher: demoFetcher("empty") });
    expect(result).toMatchObject({ status: "succeeded", detections: [] });
  });

  it("빈 결과 허용 여부가 설정값에 없으면 멋대로 정하지 않고 실패로 마감한다", async () => {
    const missing: Settings = { ...settings, emptyAllowedByEndpoint: {} };
    const { store, rec } = fakeStore();
    const result = await run({ store, settings: missing, fetcher: demoFetcher("empty") });
    expect(result.status).toBe("failed");
    expect(codes(rec)).toContain("ENGINE_ERROR");
  });
});

describe("서비스키·한도 문제", () => {
  it("실패로 마감하고 데이터 이상징후를 만들지 않는다 (DETECTION_SKIPPED)", async () => {
    const normal = demoFetcher();
    const quota: Fetcher = (endpoint) => (endpoint === "demo-detail" ? { endpointName: endpoint, httpStatus: 429, durationMs: 50, outcome: "auth_or_quota", recordCount: null, dataValid: null, records: [] } : normal(endpoint));
    const { store, rec } = fakeStore();
    const result = await run({ store, fetcher: quota });
    expect(result).toMatchObject({ status: "failed", detections: [] });
    expect(codes(rec)).toEqual(expect.arrayContaining(["AUTH_OR_QUOTA", "DETECTION_SKIPPED"]));
  });
});

describe("예상 못 한 오류", () => {
  it("저장 중 예외가 나도 running으로 남기지 않고 failed로 마감하며, 내부 오류 문구는 기록하지 않는다", async () => {
    const { store, rec } = fakeStore({
      async saveCollected() {
        throw new Error("password=secret internal detail");
      },
    });
    const result = await run({ store });
    expect(result.status).toBe("failed");
    expect(rec.finished).toEqual([{ status: "failed", calls: 1 }]);
    expect(rec.logs.some((l) => l.code === "ENGINE_ERROR")).toBe(true);
    expect(JSON.stringify(rec.logs)).not.toContain("secret");
  });
});

describe("지원하지 않는 요청", () => {
  it("PUBLIC은 아직 조회기가 없어 실행 기록을 만들기 전에 거부한다", async () => {
    const { store, rec } = fakeStore();
    await expect(run({ store, source: "PUBLIC" })).rejects.toThrow();
    expect(rec.started).toBe(0);
  });
});

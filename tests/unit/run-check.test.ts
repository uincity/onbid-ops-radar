// 점검 실행 엔진 시험 (PLAN 작업 22) — DB 없이 메모리 가짜 저장소로 돌린다.
// 확인하는 것: 정상 점검 160건 채점 · 동시 실행 차단 · 호출 상한 20/100 · 60초 제한 경계 · 오류/타임아웃/0건 ·
//              서비스키·한도 문제 때 탐지 생략 · 중간에 예외가 나도 running으로 남지 않음
import { describe, expect, it } from "vitest";
import { runCheck, type RunCheckInput } from "@/lib/checks/run-check";
import { createDemoFetcher } from "@/lib/checks/demo-fetcher";
import { createPublicFetcher } from "@/lib/checks/public-fetcher";
import type { ProbeStatus } from "@/lib/checks/probe/status";
import type { ApiCheckRecord, CheckStore, DetectionRecord, ProbeRecord, Fetcher, FetchedRecord, LogLevel, RecordAction, RunStatus } from "@/lib/checks/types";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { DEFAULT_SETTING_VALUES, parseSettings, type Settings } from "@/lib/settings/schema";

const settings: Settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const BASE = Date.parse("2026-03-01T00:00:00Z");
const CTX = { remainingCalls: 20, remainingMs: 60_000 };

// 메모리 가짜 저장소: 엔진이 무엇을 기록했는지 그대로 모아 둔다
type PriorProbe = { status: ProbeStatus; reason: string | null };
function fakeStore(over: Partial<CheckStore> & { blocked?: boolean; prior?: Record<string, PriorProbe[]> } = {}) {
  const rec = {
    started: 0,
    apiChecks: [] as ApiCheckRecord[],
    collected: [] as { kind: string; records: FetchedRecord[] }[],
    logs: [] as { level: LogLevel; code: string; message: string }[],
    finished: [] as { status: RunStatus; calls: number }[],
    recorded: [] as DetectionRecord[],
    probeRows: [] as ProbeRecord[],
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
    async countPublicCallsToday() {
      return 0;
    },
    async countPublicCallsTodayByService() {
      return {};
    },
    // 이번 실행에서 저장한 판정(가장 최근이 먼저) 뒤에 시험이 심어 둔 과거 판정(prior, 가장 최근이 먼저)을 붙여 돌려준다
    async recentProbeHistory(_source, apiId, operationId) {
      const row = (p: ProbeRecord): PriorProbe => ({ status: p.result.status, reason: "code" in p.result ? p.result.code : "reason" in p.result ? p.result.reason : null });
      const current = rec.probeRows.filter((p) => p.apiId === apiId && p.operationId === operationId).map(row).reverse();
      return [...current, ...(over.prior?.[`${apiId}/${operationId}`] ?? [])];
    },
    async recordProbe(_id, _source, probe) {
      rec.probeRows.push(probe);
    },
    async recordDetection(detection) {
      rec.recorded.push(detection);
      return { anomalyId: rec.recorded.length, action: "created" as RecordAction };
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

describe("이상징후 등록 (PLAN 23)", () => {
  it("탐지 결과를 하나도 빠짐없이 등록하고 집계·메모를 남긴다", async () => {
    const { store, rec } = fakeStore();
    const result = await run({ store });
    expect(result.detections.length).toBeGreaterThan(0);
    expect(rec.recorded).toHaveLength(result.detections.length);
    expect(result.registered).toEqual({ created: result.detections.length, recurred: 0, detected_again: 0, suppressed: 0 });
    const note = rec.logs.find((l) => l.code === "DETECTIONS_RECORDED");
    expect(note?.message).toContain(`이상징후 등록 ${result.detections.length}건`);
  });

  it("등록 내용: 출처 · 물건 · 규칙 · 근거 · 64자리 지문", async () => {
    const { store, rec } = fakeStore();
    await run({ store });
    for (const d of rec.recorded) {
      expect(d.source).toBe("DEMO");
      expect(d.itemKey).toMatch(/^DEMO-\d{4}$/);
      expect(d.valueHash).toMatch(/^[0-9a-f]{64}$/);
      expect(d.evidence.rule).toBe(d.ruleId);
    }
  });

  it("같은 입력으로 두 번 점검하면 지문이 똑같다 (정상 판정 건과 값 비교의 바탕)", async () => {
    const a = fakeStore();
    const b = fakeStore();
    await run({ store: a.store });
    await run({ store: b.store });
    const key = (d: DetectionRecord) => [d.itemKey, d.ruleId, d.valueHash];
    expect(a.rec.recorded.map(key)).toEqual(b.rec.recorded.map(key));
  });

  it("빈 결과 이상징후도 API 이름으로 등록한다", async () => {
    const { store, rec } = fakeStore();
    await run({ store, fetcher: demoFetcher("empty") });
    expect(rec.recorded.map((d) => [d.ruleId, d.itemKey])).toEqual([["EMPTY_RESULT", "demo-list"], ["EMPTY_RESULT", "demo-detail"]]);
  });

  it("서비스키·한도 문제가 있었던 실행은 아무것도 등록하지 않는다", async () => {
    const normal = demoFetcher();
    const quota: Fetcher = (e) => (e === "demo-detail" ? { endpointName: e, httpStatus: 429, durationMs: 1, outcome: "auth_or_quota", recordCount: null, dataValid: null, records: [] } : normal(e, CTX));
    const { store, rec } = fakeStore();
    await run({ store, fetcher: quota });
    expect(rec.recorded).toHaveLength(0);
  });

  it("DB 함수가 돌려준 결과(재발·억제 등)를 종류별로 센다", async () => {
    const actions: RecordAction[] = ["created", "recurred", "detected_again", "suppressed"];
    let n = 0;
    const { store } = fakeStore({
      async recordDetection() {
        return { anomalyId: 1, action: actions[n++ % 4] };
      },
    });
    const result = await run({ store });
    expect(Object.values(result.registered).reduce((a, b) => a + b, 0)).toBe(result.detections.length);
    expect(result.registered.recurred).toBeGreaterThan(0);
    expect(result.registered.suppressed).toBeGreaterThan(0);
  });

  it("등록 중 60초가 되면 남은 것은 등록하지 않고 RUN_TIME_LIMIT 메모와 함께 partial로 마감한다", async () => {
    let now = 0;
    const { store, rec } = fakeStore({
      async recordDetection() {
        now += 20_000; // 한 건 등록할 때마다 20초가 흐른다고 가정
        return { anomalyId: 1, action: "created" as RecordAction };
      },
    });
    const result = await run({ store, clock: () => now });
    expect(result.status).toBe("partial");
    expect(result.registered.created).toBe(3); // 0·20·40초에 3건 등록, 60초에 멈춤
    expect(rec.logs.some((l) => l.code === "RUN_TIME_LIMIT" && l.message.includes("등록하지 못했습니다"))).toBe(true);
  });
});

describe("동시 실행 차단", () => {
  it("이미 실행 중이면 blocked로 끝내고 조회·탐지는 하지 않는다", async () => {
    const { store, rec } = fakeStore({ blocked: true });
    const result = await run({ store });
    expect(result).toMatchObject({ runId: 7, status: "blocked", apiCallCount: 0, detections: [] });
    expect(rec.recorded).toHaveLength(0);
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
    let first = true;
    const inner = demoFetcher();
    const fetcher: Fetcher = (endpoint) => {
      const r = inner(endpoint, CTX);
      if (first) now += advanceMs; // 첫 호출(목록)에서만 시간이 흐른다
      first = false;
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
    const result = await run({ store, fetcher: (e) => (n++ === 0 ? normal(e, CTX) : failing(e, CTX)) });
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
    const quota: Fetcher = (endpoint) => (endpoint === "demo-detail" ? { endpointName: endpoint, httpStatus: 429, durationMs: 50, outcome: "auth_or_quota", recordCount: null, dataValid: null, records: [] } : normal(endpoint, CTX));
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

// ---------------------------------------------------------------- PUBLIC 출처 (PLAN 33) — 가짜 fetch로 온비드 응답을 흉내 낸다
describe("PUBLIC 점검", () => {
  const KEY = "abc%2Fdef%3D%3D";
  const body = (item: unknown) => new Response(JSON.stringify({ header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: { item }, totalCount: 1 } }));
  const nodata = () => new Response(JSON.stringify({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }));
  const item = (n: number, over: Record<string, unknown> = {}) => ({
    cltrMngNo: `2026-1100-00000${n}`,
    pbctCdtnNo: 100 + n,
    // 등록부(명세)가 필수로 적은 나머지 응답 항목 (pbctsn은 명세상 2026.1.1 이후 공고에는 표시되지 않아 예외)
    onbidCltrno: 1000 + n,
    onbidPbancNo: 2000 + n,
    pbctNo: 3000 + n,
    pbctNsq: "1",
    onbidCltrNm: `물건 ${n}`,
    orgNm: "한국자산관리공사",
    cltrBidBgngDt: "202605180900",
    cltrBidEndDt: "202605201700",
    pbctStatCd: "0002",
    ...over,
  });

  // 목록 물건 5개: 1 정상 / 2 날짜 역전 / 3 상세의 물건명이 다름 / 4 공고기관 없음 / 5 상세가 데이터없음
  const listItems = [item(1), item(2, { cltrBidEndDt: "202605180859" }), item(3), item(4, { orgNm: undefined }), item(5)];
  const detailOf = (id: string) => {
    const n = Number(id.slice(-1));
    if (n === 5) return nodata();
    if (n === 3) return body(item(3, { onbidCltrNm: "다른 이름" }));
    return body(listItems[n - 1]);
  };
  const publicFetcher = (over: { list?: () => Response; detail?: (id: string) => Response } = {}) => {
    const urls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("getRlstCltrList2")) return (over.list ?? (() => body(listItems)))();
      return (over.detail ?? detailOf)(new URL(url).searchParams.get("cltrMngNo")!);
    }) as typeof fetch;
    return { fetcher: createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: impl }), urls };
  };
  const runPublic = (over: Partial<RunCheckInput> & { store: CheckStore }) => runCheck({ trigger: "manual", source: "PUBLIC", settings, ...over, fetcher: over.fetcher ?? publicFetcher().fetcher });

  it("목록 1번 + 상세 5번(0건 물건은 재조회 1번 더) = 7번 호출하고, 호출마다 api_checks 한 줄이 남는다", async () => {
    const { store, rec } = fakeStore();
    const { fetcher, urls } = publicFetcher();
    const result = await runPublic({ store, fetcher });
    expect(result).toMatchObject({ status: "succeeded", apiCallCount: 7 });
    expect(urls).toHaveLength(7);
    expect(rec.apiChecks.map((c) => [c.endpointName, c.outcome])).toEqual([
      ["public-list", "success"],
      ["public-detail", "success"],
      ["public-detail", "success"],
      ["public-detail", "success"],
      ["public-detail", "success"],
      ["public-detail", "empty_result"],
      ["public-detail", "empty_result"], // 상세가 0건이면 한 번 더 조회한다
    ]);
  });

  it("수집한 줄은 허용된 필드만 담아 저장 요청된다", async () => {
    const { store, rec } = fakeStore();
    await runPublic({ store });
    expect(rec.collected.map((c) => [c.kind, c.records.length])).toEqual([["list", 5], ["detail", 4]]);
    const allowed = ["cltrMngNo", "pbctCdtnNo", "onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt", "pbctStatCd"];
    for (const c of rec.collected) for (const r of c.records) expect(Object.keys(r.fields).every((k) => allowed.includes(k))).toBe(true);
  });

  it("탐지(PUBLIC): 물건명 불일치와 필수정보 누락(DQ_REQUIRED)을 잡고, 날짜 역전은 PUBLIC 핵심 지표에서 제외해 등록하지 않으며, 정상 물건과 상세가 없는 물건은 잡지 않는다", async () => {
    const { store, rec } = fakeStore();
    const result = await runPublic({ store });
    expect(result.detections.map((d) => [d.itemKey, d.ruleId, d.source])).toEqual([
      ["2026-1100-000003", "LIST_DETAIL_MISMATCH", "PUBLIC"],
      ["2026-1100-000004", "DQ_REQUIRED", "PUBLIC"],
    ]);
    expect(rec.recorded.map((d) => d.ruleId)).toEqual(["LIST_DETAIL_MISMATCH", "DQ_REQUIRED"]);
    expect(rec.recorded[1].evidence).toMatchObject({ rule: "DQ_REQUIRED" }); // 근거에도 새 규칙 이름이 적힌다
    // 근거에는 PUBLIC 필드의 실제 값이 담긴다
    const mismatch = rec.recorded.find((d) => d.ruleId === "LIST_DETAIL_MISMATCH")!;
    expect(mismatch.evidence).toMatchObject({ diffs: [{ field: "onbidCltrNm", list: "물건 3", detail: "다른 이름" }] });
    // 상세가 없는 물건은 비교하지 않고 사유를 남긴다
    expect(rec.logs.some((l) => l.code === "COMPARE_SKIPPED" && l.message.includes("NO_COUNTERPART") && l.message.includes("2026-1100-000005"))).toBe(true);
  });

  it("PUBLIC 목록이 0건이어도 EMPTY_RESULT 이상징후를 새로 만들지 않는다 (PRD v2.0 빈 결과 정책). 점검 판정으로만 남는다", async () => {
    const { store, rec } = fakeStore();
    const { fetcher, urls } = publicFetcher({ list: nodata });
    const result = await runPublic({ store, fetcher });
    expect(result.status).toBe("succeeded"); // 응답은 정상으로 왔다
    expect(result.detections).toEqual([]);
    expect(rec.recorded).toHaveLength(0);
    expect(urls).toHaveLength(1); // 입력값이 없으니 상세는 부르지 않는다
    expect(result.probes.map((p) => [p.endpoint, p.result])).toEqual([
      ["public-list", { status: "UNVERIFIED", attempted: true, reason: "NO_DATA_UNCONFIRMED" }], // 정상 무데이터인지 확정할 근거가 없다
      ["public-detail", { status: "UNVERIFIED", attempted: false, reason: "NO_VALID_INPUT" }],
    ]);
  });

  it("DEMO 점검의 빈 결과는 이전 정책(EMPTY_RESULT)을 그대로 쓰고 점검 판정은 만들지 않는다", async () => {
    const { store } = fakeStore();
    const result = await run({ store, fetcher: demoFetcher("empty") });
    expect(result.detections.map((d) => d.ruleId)).toEqual(["EMPTY_RESULT", "EMPTY_RESULT"]);
    expect(result.probes).toEqual([]);
  });

  it("서비스키·한도 문제가 목록에서 나면 상세를 부르지 않고, 실패로 마감하며 탐지·등록을 하지 않는다", async () => {
    const { store, rec } = fakeStore();
    const { fetcher, urls } = publicFetcher({ list: () => new Response(JSON.stringify({ result: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } })) });
    const result = await runPublic({ store, fetcher });
    expect(result).toMatchObject({ status: "failed", apiCallCount: 1, detections: [] });
    expect(urls).toHaveLength(1);
    expect(rec.recorded).toHaveLength(0);
    expect(codes(rec)).toEqual(expect.arrayContaining(["AUTH_OR_QUOTA", "DETECTION_SKIPPED"]));
  });

  it("호출 상한 3회: 목록 1번 + 상세 2번만 부른다 (남은 호출 − 1건만 가져온다)", async () => {
    const { store } = fakeStore();
    const { fetcher, urls } = publicFetcher();
    const result = await runPublic({ store, fetcher, callLimit: 3 });
    expect(result.apiCallCount).toBe(3);
    expect(urls).toHaveLength(3);
    expect(new URL(urls[0]).searchParams.get("numOfRows")).toBe("2");
  });

  describe("점검 상태 판정 (R02)", () => {
    const probeMap = (probes: { endpoint: string; result: unknown }[]) => Object.fromEntries(probes.map((p) => [p.endpoint, p.result]));
    const code = (c: string) => () => new Response(JSON.stringify({ result: { resultCode: c, resultMsg: "x" } }));

    it("정상 점검: 목록·상세 모두 PASS_DATA이고 점검마다 PROBE_RESULT 메모가 남는다", async () => {
      const { store, rec } = fakeStore();
      const result = await runPublic({ store });
      expect(probeMap(result.probes)).toEqual({ "public-list": { status: "PASS_DATA", attempted: true }, "public-detail": { status: "PASS_DATA", attempted: true } });
      expect(result.probes.map((p) => p.operationKey)).toEqual(["SVC-API-001/getRlstCltrList", "SVC-API-004/getRlstDtlInf"]);
      expect(rec.logs.filter((l) => l.code === "PROBE_RESULT").map((l) => l.message)).toEqual(["'public-list' 점검 판정: PASS_DATA", "'public-detail' 점검 판정: PASS_DATA"]);
    });

    it("서비스키 문제(30): 목록 FAIL(AUTH_ERROR), 상세는 선행 실패라 UNVERIFIED(PRECONDITION_FAILED)이며 이상징후를 만들지 않는다", async () => {
      const { store } = fakeStore();
      const result = await runPublic({ store, fetcher: publicFetcher({ list: code("30") }).fetcher });
      expect(probeMap(result.probes)).toEqual({ "public-list": { status: "FAIL", attempted: true, code: "AUTH_ERROR" }, "public-detail": { status: "UNVERIFIED", attempted: false, reason: "PRECONDITION_FAILED" } });
      expect(result.detections).toEqual([]);
    });

    it("호출 한도 초과(22)는 AUTH_ERROR와 구분해 QUOTA_EXCEEDED로 판정한다", async () => {
      const { store } = fakeStore();
      const result = await runPublic({ store, fetcher: publicFetcher({ list: code("22") }).fetcher });
      expect(probeMap(result.probes)["public-list"]).toEqual({ status: "FAIL", attempted: true, code: "QUOTA_EXCEEDED" });
    });

    it("목록이 HTTP 500이면 FAIL(HTTP_ERROR), 업무 오류코드(02)면 FAIL(BUSINESS_ERROR), 깨진 본문이면 FAIL(SCHEMA_ERROR)", async () => {
      const outcomes = [] as unknown[];
      for (const list of [() => new Response("x", { status: 500 }), code("02"), () => new Response("not json")]) {
        const { store } = fakeStore();
        outcomes.push(probeMap((await runPublic({ store, fetcher: publicFetcher({ list }).fetcher })).probes)["public-list"]);
      }
      expect(outcomes).toEqual([
        { status: "FAIL", attempted: true, code: "HTTP_ERROR" },
        { status: "FAIL", attempted: true, code: "BUSINESS_ERROR" },
        { status: "FAIL", attempted: true, code: "SCHEMA_ERROR" },
      ]);
    });

    it("응답 구조 경고: 필수 응답 항목이 빠졌어도 식별 입력값을 얻었으면 상세 점검은 계속하고, 목록은 FAIL(SCHEMA_ERROR)로 판정한다", async () => {
      const { store } = fakeStore();
      const broken = listItems.map((it) => ({ ...it, pbctNo: undefined })); // 필수 항목 pbctNo 누락
      const { fetcher, urls } = publicFetcher({ list: () => body(broken) });
      const result = await runPublic({ store, fetcher });
      expect(probeMap(result.probes)["public-list"]).toEqual({ status: "FAIL", attempted: true, code: "SCHEMA_ERROR" });
      expect(urls.length).toBeGreaterThan(1); // 상세도 불렀다
      expect(result.status).toBe("partial"); // R04: 점검 판정(FAIL)이 실행 상태에 반영된다
    });

    it("조회기가 예외를 던져도 그 점검만 UNVERIFIED로 남기고 다음 점검은 계속한다 (격리)", async () => {
      const { store, rec } = fakeStore();
      const { fetcher: inner } = publicFetcher();
      let first = true;
      const fetcher: Fetcher = (endpoint, ctx) => {
        if (endpoint === "public-detail" && first) {
          first = false;
          throw new Error("internal secret detail");
        }
        return inner(endpoint, ctx);
      };
      const result = await runPublic({ store, fetcher });
      expect(result.status).toBe("partial");
      expect(probeMap(result.probes)["public-list"]).toEqual({ status: "PASS_DATA", attempted: true });
      expect(probeMap(result.probes)["public-detail"]).toEqual({ status: "UNVERIFIED", attempted: true, reason: "PRECONDITION_FAILED" });
      expect(codes(rec)).toContain("FETCH_ERROR");
      expect(codes(rec)).not.toContain("ENGINE_ERROR");
      expect(JSON.stringify(rec.logs)).not.toContain("secret");
    });

    it("조회기가 없는 오퍼레이션 26개는 요청 없이 UNVERIFIED로 저장하고 probes(점검 2개)에는 섞지 않는다", async () => {
      const { store, rec } = fakeStore();
      const result = await runPublic({ store });
      expect(result.probes).toHaveLength(2);
      expect(result.unprobeable).toHaveLength(26);
      const unprobed = rec.probeRows.filter((p) => !["SVC-API-001/getRlstCltrList", "SVC-API-004/getRlstDtlInf"].includes(`${p.apiId}/${p.operationId}`));
      expect(unprobed).toHaveLength(26);
      expect(unprobed.every((p) => p.result.status === "UNVERIFIED" && p.result.attempted === false && p.requestSummary === null)).toBe(true);
      expect(rec.apiChecks).toHaveLength(7); // 요청은 목록 1 + 상세 5 + 0건 상세 재조회 1뿐
    });

    describe("API 상태 이상징후 (연속 FAIL)", () => {
      const LIST = "SVC-API-001/getRlstCltrList";
      const http500 = () => publicFetcher({ list: () => new Response("x", { status: 500 }) }).fetcher;
      const fail = (reason: string): PriorProbe => ({ status: "FAIL", reason });
      const ok: PriorProbe = { status: "PASS_DATA", reason: null };

      it("이번이 3번째 연속 실패면 API_HTTP_ERROR 이상징후를 등록한다 (식별값은 서비스ID/오퍼레이션ID)", async () => {
        const { store, rec } = fakeStore({ prior: { [LIST]: [fail("HTTP_ERROR"), fail("HTTP_ERROR")] } });
        const result = await runPublic({ store, fetcher: http500() });
        expect(result.detections.map((d) => [d.itemKey, d.ruleId, d.source])).toEqual([[LIST, "API_HTTP_ERROR", "PUBLIC"]]);
        expect(rec.recorded[0].evidence).toMatchObject({ apiId: "SVC-API-001", operationId: "getRlstCltrList", issueCode: "HTTP_ERROR", consecutiveFailures: 3, threshold: 3 });
        expect(rec.recorded[0].valueHash).toMatch(/^[0-9a-f]{64}$/);
      });

      it("2번째 연속 실패(기준 한 칸 아래)면 만들지 않는다", async () => {
        const { store, rec } = fakeStore({ prior: { [LIST]: [fail("HTTP_ERROR")] } });
        const result = await runPublic({ store, fetcher: http500() });
        expect(result.detections).toEqual([]);
        expect(rec.recorded).toHaveLength(0);
      });

      it("중간에 정상이 있으면 연속이 끊긴다 / 검증 불가·미점검은 건너뛴다", async () => {
        const broken = fakeStore({ prior: { [LIST]: [ok, fail("HTTP_ERROR"), fail("HTTP_ERROR")] } });
        expect((await runPublic({ store: broken.store, fetcher: http500() })).detections).toEqual([]);
        const skipped = fakeStore({ prior: { [LIST]: [{ status: "UNVERIFIED", reason: "NO_VALID_INPUT" }, fail("HTTP_ERROR"), { status: "NOT_RUN", reason: "BUDGET_SKIP" }, fail("HTTP_ERROR")] } });
        expect((await runPublic({ store: skipped.store, fetcher: http500() })).detections.map((d) => d.ruleId)).toEqual(["API_HTTP_ERROR"]);
      });

      it("서비스키·한도 문제는 API 장애로 세지 않아 이상징후를 만들지 않는다", async () => {
        const { store } = fakeStore({ prior: { [LIST]: [fail("HTTP_ERROR"), fail("HTTP_ERROR")] } });
        const result = await runPublic({ store, fetcher: publicFetcher({ list: code("22") }).fetcher });
        expect(result.detections).toEqual([]);
      });

      it("설정값(연속 횟수)이 없으면(null) 만들지 않고, 정상 점검도 만들지 않는다", async () => {
        const off = fakeStore({ prior: { [LIST]: [fail("HTTP_ERROR"), fail("HTTP_ERROR")] } });
        expect((await runPublic({ store: off.store, fetcher: http500(), settings: { ...settings, apiFailStreakThreshold: null } })).detections).toEqual([]);
        const healthy = fakeStore({ prior: { [LIST]: [fail("HTTP_ERROR"), fail("HTTP_ERROR")] } });
        expect((await runPublic({ store: healthy.store })).detections.some((d) => d.ruleId.startsWith("API_"))).toBe(false);
      });

      it("DEMO 점검은 API 상태 이상징후를 만들지 않는다", async () => {
        const { store } = fakeStore();
        expect((await run({ store, fetcher: demoFetcher("http_error") })).detections.some((d) => d.ruleId.startsWith("API_"))).toBe(false);
      });
    });

    describe("데이터 품질 규칙 DQ_* (R06)", () => {
      const REF = "2026-1100-000001";

      it("DQ_SCHEMA: 필수 응답 항목이 빠진 응답은 오퍼레이션 단위 의심으로 등록한다 (식별값 = 서비스ID/오퍼레이션ID)", async () => {
        const { store, rec } = fakeStore();
        const broken = listItems.map((it) => ({ ...it, pbctNo: undefined }));
        const result = await runPublic({ store, fetcher: publicFetcher({ list: () => body(broken) }).fetcher });
        expect(result.detections.find((d) => d.ruleId === "DQ_SCHEMA")?.itemKey).toBe("SVC-API-001/getRlstCltrList");
        expect(rec.recorded.find((d) => d.ruleId === "DQ_SCHEMA")?.evidence).toMatchObject({ missingFields: [{ field: "pbctNo", count: 5 }] });
      });

      it("DQ_SCHEMA: 정상 응답이나 호출 실패(검사한 항목 없음)에는 만들지 않는다", async () => {
        expect((await runPublic({ store: fakeStore().store })).detections.some((d) => d.ruleId === "DQ_SCHEMA")).toBe(false);
        const failed = await runPublic({ store: fakeStore().store, fetcher: publicFetcher({ list: () => new Response("x", { status: 500 }) }).fetcher });
        expect(failed.detections.some((d) => d.ruleId === "DQ_SCHEMA")).toBe(false);
      });

      it("DQ_LIST_DETAIL_REF: 상세가 다른 물건을 돌려주면 의심으로 등록한다", async () => {
        const detail = (id: string) => (id === REF ? body(item(1, { cltrMngNo: "2026-1100-009999" })) : detailOf(id));
        const result = await runPublic({ store: fakeStore().store, fetcher: publicFetcher({ detail }).fetcher });
        const ref = result.detections.filter((d) => d.ruleId === "DQ_LIST_DETAIL_REF");
        expect(ref.map((d) => d.itemKey)).toEqual([REF]);
        expect(ref[0].evidence).toMatchObject({ mismatches: [{ field: "cltrMngNo", list: REF, detail: "2026-1100-009999" }] });
      });

      it("DQ_LIST_DETAIL_REF: 상세가 0건인 물건은 이상징후 없이 판정 보류(DQ_REF_UNVERIFIED)로만 남긴다", async () => {
        const { store, rec } = fakeStore();
        const result = await runPublic({ store });
        expect(result.detections.some((d) => d.ruleId === "DQ_LIST_DETAIL_REF")).toBe(false);
        expect(rec.logs.find((l) => l.code === "DQ_REF_UNVERIFIED")?.message).toContain("2026-1100-000005");
      });

      it("DQ_CROSS_API_REF: 연결해서 비교할 API 점검이 없어 적용 제외(NOT_APPLICABLE)로 남긴다", async () => {
        const { store, rec } = fakeStore();
        await runPublic({ store });
        expect(codes(rec)).toContain("DQ_CROSS_API_NOT_APPLICABLE");
      });

      it("DEMO 점검은 DQ_* 이상징후나 보류 메모를 만들지 않고 이전 규칙 이름을 그대로 쓴다", async () => {
        const { store, rec } = fakeStore();
        const result = await run({ store });
        expect(result.detections.some((d) => d.ruleId.startsWith("DQ_"))).toBe(false);
        expect(codes(rec).some((c) => c.startsWith("DQ_"))).toBe(false);
        expect(result.detections.some((d) => d.ruleId === "DATE_ORDER")).toBe(true); // DEMO 회귀 유지
      });
    });

    it("DEMO 점검은 등록부 오퍼레이션을 기록하지 않는다", async () => {
      const { store, rec } = fakeStore();
      const result = await run({ store });
      expect(result.unprobeable).toEqual([]);
      expect(rec.probeRows).toHaveLength(0);
    });

    it("DEMO도 조회기 예외가 나면 그 점검만 실패로 세고 다음 점검은 계속한다", async () => {
      const { store, rec } = fakeStore();
      const inner = demoFetcher();
      const fetcher: Fetcher = (endpoint, ctx) => {
        if (endpoint === "demo-list") throw new Error("boom");
        return inner(endpoint, ctx);
      };
      const result = await run({ store, fetcher });
      expect(result.status).toBe("partial");
      expect(rec.apiChecks.map((c) => c.endpointName)).toEqual(["demo-detail"]);
      expect(codes(rec)).toContain("FETCH_ERROR");
    });

    it("호출 상한 1회: 목록만 점검하고 상세는 미점검(NOT_RUN: BUDGET_SKIP)이다", async () => {
      const { store } = fakeStore();
      const result = await runPublic({ store, callLimit: 1 });
      expect(probeMap(result.probes)).toEqual({ "public-list": { status: "PASS_DATA", attempted: true }, "public-detail": { status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" } });
    });

    it("이미 실행 중이면(blocked) 두 점검 모두 NOT_RUN(RUN_BLOCKED)이다", async () => {
      const { store } = fakeStore({ blocked: true });
      const result = await runPublic({ store });
      expect(result.probes.map((p) => p.result)).toEqual([
        { status: "NOT_RUN", attempted: false, reason: "RUN_BLOCKED" },
        { status: "NOT_RUN", attempted: false, reason: "RUN_BLOCKED" },
      ]);
    });

    it("일일 예산을 모두 썼으면 두 점검 모두 NOT_RUN(BUDGET_SKIP)이다", async () => {
      const { store } = fakeStore({
        async countPublicCallsToday() {
          return 900;
        },
      });
      const result = await runPublic({ store });
      expect(result.probes.map((p) => p.result)).toEqual([
        { status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" },
        { status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" },
      ]);
    });

    it("상세가 일부만 데이터없음이어도 상세 점검은 PASS_DATA이다 (일부 성공)", async () => {
      const { store } = fakeStore();
      const result = await runPublic({ store }); // 물건 5는 상세가 데이터없음
      expect(probeMap(result.probes)["public-detail"]).toEqual({ status: "PASS_DATA", attempted: true });
    });

    it("판정은 DB에 남길 모양(probe_results 한 줄)으로 저장 요청된다: 서비스ID·오퍼레이션 ID·결과코드·응답시간·요청 요약", async () => {
      const { store, rec } = fakeStore();
      const result = await runPublic({ store });
      expect(rec.probeRows).toHaveLength(28); // 점검한 2개 + 조회기가 없어 UNVERIFIED로 남긴 26개
      const [list, detail] = rec.probeRows;
      expect(list).toMatchObject({ apiId: "SVC-API-001", operationId: "getRlstCltrList", result: { status: "PASS_DATA" }, resultCode: "00", httpStatus: 200, recordCount: 5 });
      expect(list.requestSummary).toContain("pageNo=1");
      expect(detail).toMatchObject({ apiId: "SVC-API-004", operationId: "getRlstDtlInf", result: { status: "PASS_DATA" } });
      // 메모리에 돌려준 판정(probes)과 저장 요청한 판정이 같다
      expect(rec.probeRows.slice(0, 2).map((p) => p.result)).toEqual(result.probes.map((p) => p.result));
    });

    it("호출 기록(api_checks)에도 서비스ID·오퍼레이션 ID·결과코드·요청 요약이 담기고, 서비스키는 어디에도 없다", async () => {
      const { store, rec } = fakeStore();
      await runPublic({ store });
      for (const check of rec.apiChecks) {
        expect(check.apiId, check.endpointName).toMatch(/^SVC-API-\d{3}$/);
        expect(check.operationId, check.endpointName).toMatch(/^[A-Za-z]/);
        expect(check.resultCode, check.endpointName).toMatch(/^\d{2}$/);
        expect(check.requestSummary?.length ?? 0, check.endpointName).toBeGreaterThan(0);
      }
      expect(rec.apiChecks.find((c) => c.endpointName === "public-detail")?.requestSummary).toContain("cltrMngNo=");
      expect(JSON.stringify([rec.apiChecks, rec.probeRows])).not.toMatch(/servicekey|abc%2Fdef/i);
    });

    it("요청을 보내지 못한 점검(blocked·예산 소진·호출 상한)의 판정도 저장 요청된다", async () => {
      const blocked = fakeStore({ blocked: true });
      await runPublic({ store: blocked.store });
      expect(blocked.rec.probeRows.slice(0, 2).map((p) => [p.operationId, p.result.status, p.httpStatus])).toEqual([["getRlstCltrList", "NOT_RUN", null], ["getRlstDtlInf", "NOT_RUN", null]]);

      const budget = fakeStore({
        async countPublicCallsToday() {
          return 900;
        },
      });
      await runPublic({ store: budget.store });
      expect(budget.rec.probeRows).toHaveLength(28);

      const limited = fakeStore();
      await runPublic({ store: limited.store, callLimit: 1 });
      expect(limited.rec.probeRows.slice(0, 2).map((p) => p.result.status)).toEqual(["PASS_DATA", "NOT_RUN"]);
    });

    it("서비스키 문제로 실패한 점검의 판정(FAIL·UNVERIFIED)과 결과코드가 저장 요청된다", async () => {
      const { store, rec } = fakeStore();
      await runPublic({ store, fetcher: publicFetcher({ list: code("22") }).fetcher });
      expect(rec.probeRows[0]).toMatchObject({ result: { status: "FAIL", code: "QUOTA_EXCEEDED" }, resultCode: "22" });
      expect(rec.probeRows[1].result).toMatchObject({ status: "UNVERIFIED", reason: "PRECONDITION_FAILED" });
    });

    it("DEMO 점검에는 판정을 저장하지 않고 호출 기록의 새 칸은 비어 있다 (이전 방식 그대로)", async () => {
      const { store, rec } = fakeStore();
      await run({ store });
      expect(rec.probeRows).toEqual([]);
      for (const check of rec.apiChecks) expect([check.apiId ?? null, check.operationId ?? null, check.requestSummary ?? null]).toEqual([null, null, null]);
    });

    it("DEMO 점검에는 점검 판정(probes)을 만들지 않는다", async () => {
      const { store } = fakeStore();
      expect((await run({ store })).probes).toEqual([]);
    });
  });

  describe("일일 호출 예산 (설정값 public_daily_budget = 900)", () => {
    const withUsed = (used: number) =>
      fakeStore({
        async countPublicCallsToday() {
          return used;
        },
      });

    it("오늘 900회를 모두 썼으면 호출하지 않고 BUDGET_EXCEEDED를 남겨 실패로 마감한다", async () => {
      const { store, rec } = withUsed(900);
      const { fetcher, urls } = publicFetcher();
      const result = await runPublic({ store, fetcher });
      expect(result).toMatchObject({ status: "failed", apiCallCount: 0, detections: [] });
      expect(urls).toHaveLength(0);
      expect(codes(rec)).toContain("BUDGET_EXCEEDED");
      expect(rec.finished).toEqual([{ status: "failed", calls: 0 }]);
    });

    it("899회 썼으면 1회만 남아 목록만 부르고 호출 상한 도달로 부분 완료", async () => {
      const { store, rec } = withUsed(899);
      const { fetcher, urls } = publicFetcher();
      const result = await runPublic({ store, fetcher });
      expect(urls).toHaveLength(1);
      expect(result).toMatchObject({ status: "partial", apiCallCount: 1 });
      expect(codes(rec)).toContain("CALL_LIMIT_REACHED");
    });

    it("895회 썼으면 5회가 남아 목록 1번 + 상세 4번까지 부른다", async () => {
      const { store } = withUsed(895);
      const { fetcher, urls } = publicFetcher();
      const result = await runPublic({ store, fetcher });
      expect(urls).toHaveLength(5);
      expect(result.apiCallCount).toBe(5);
    });

    it("예산이 아직 정해지지 않았으면(null) 오늘 호출 수를 확인하지 않고 실행당 상한만 적용한다", async () => {
      let asked = 0;
      const { store } = fakeStore({
        async countPublicCallsToday() {
          asked += 1;
          return 999_999;
        },
      });
      const result = await runPublic({ store, settings: { ...settings, publicDailyBudget: null } });
      expect(asked).toBe(0);
      expect(result.apiCallCount).toBe(7);
    });

    it("DEMO 점검은 예산을 확인하지 않는다", async () => {
      let asked = 0;
      const { store } = fakeStore({
        async countPublicCallsToday() {
          asked += 1;
          return 999_999;
        },
      });
      await run({ store });
      expect(asked).toBe(0);
    });
  });
});

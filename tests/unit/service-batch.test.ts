// 서비스(배치) 단위 실행 시험 (R04 확장) — 서비스별 하루 호출 예산 · 호출 간격 · 배치 순서·요약
// 실제 온비드 API는 부르지 않는다. 가짜 응답(fetchImpl)과 메모리 저장소만 쓴다.
import { describe, expect, it } from "vitest";
import { genericProbeTargets } from "@/lib/checks/generic-probe";
import { createPublicFetcher } from "@/lib/checks/public-fetcher";
import { runCheck } from "@/lib/checks/run-check";
import { createPacer, serviceCallsLeft, serviceDailyLimits } from "@/lib/checks/service-limits";
import type { ApiCheckRecord, CheckStore, ProbeRecord, RecordAction } from "@/lib/checks/types";
import { API_REGISTRY } from "@/lib/registry";
import { DEFAULT_SETTING_VALUES, parseSettings } from "@/lib/settings/schema";

const settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const NOW = new Date("2026-11-03T03:00:00Z");
const KEY = "abc%2Fdef%3D%3D";

describe("serviceDailyLimits / serviceCallsLeft", () => {
  it("등록부에서 쿼터가 있는 서비스마다 하루 호출 예산을 읽는다 (서비스 안 오퍼레이션 중 가장 작은 값)", () => {
    const limits = serviceDailyLimits();
    expect(Object.keys(limits).length).toBeGreaterThan(0);
    for (const v of Object.values(limits)) expect(v).toBeGreaterThan(0);
    // 같은 서비스에 쿼터가 다른 오퍼레이션이 둘 있으면 작은 쪽을 쓴다
    const service = API_REGISTRY.services[0];
    const op = service.operations[0];
    const fake = { ...API_REGISTRY, services: [{ ...service, operations: [{ ...op, quota: { dailyLimit: 500, source: "t" } }, { ...op, operationId: "other", quota: { dailyLimit: 300, source: "t" } }] }] };
    expect(serviceDailyLimits(fake as never)).toEqual({ [service.serviceId]: 300 });
  });

  it("쿼터가 없는 서비스는 제한 없음(null)이다", () => {
    expect(serviceCallsLeft({}, {}, {}, "SVC-API-001")).toBeNull();
  });

  it("남은 호출 수 경계: 한도 직전(1회 남음)은 1, 한도에 닿으면 0, 넘어도 0 아래로 내려가지 않는다", () => {
    const limits = { "SVC-API-001": 100 };
    expect(serviceCallsLeft(limits, { "SVC-API-001": 90 }, { "SVC-API-001": 9 }, "SVC-API-001")).toBe(1); // 한 칸 안
    expect(serviceCallsLeft(limits, { "SVC-API-001": 90 }, { "SVC-API-001": 10 }, "SVC-API-001")).toBe(0); // 한 칸 밖(딱 닿음)
    expect(serviceCallsLeft(limits, { "SVC-API-001": 150 }, {}, "SVC-API-001")).toBe(0); // 이미 넘음
    expect(serviceCallsLeft(limits, {}, {}, "SVC-API-001")).toBe(100); // 오늘 아직 안 씀
  });
});

describe("createPacer (호출 간격)", () => {
  function clock() {
    let t = 1_000;
    const slept: number[] = [];
    return { now: () => t, advance: (ms: number) => void (t += ms), sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept };
  }

  it("같은 서비스에 연달아 부르면 간격이 찰 때까지 기다린다 (경계: 199ms 지났으면 1ms, 200ms 지났으면 기다리지 않음)", async () => {
    const c = clock();
    const pacer = createPacer(200, c.now, c.sleep);
    await pacer.wait("A"); // 처음은 기다리지 않음
    c.advance(199);
    await pacer.wait("A");
    c.advance(200);
    await pacer.wait("A");
    expect(c.slept).toEqual([1]);
  });

  it("서비스가 다르면 서로 기다리지 않는다", async () => {
    const c = clock();
    const pacer = createPacer(200, c.now, c.sleep);
    await pacer.wait("A");
    await pacer.wait("B");
    expect(c.slept).toEqual([]);
  });

  it("간격이 0이거나 비어 있으면(null) 기다리지 않는다", async () => {
    for (const interval of [0, null]) {
      const c = clock();
      const pacer = createPacer(interval, c.now, c.sleep);
      await pacer.wait("A");
      await pacer.wait("A");
      expect(c.slept).toEqual([]);
    }
  });
});

function fakeApi(handler: (url: URL) => Response) {
  const urls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { impl, urls };
}
const okBody = (items: unknown) => new Response(JSON.stringify({ header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: { item: items }, totalCount: 1 } }));
const listItem = (n: number) => ({ cltrMngNo: `2026-1100-00000${n}`, pbctCdtnNo: 100 + n, onbidCltrNm: `물건 ${n}`, orgNm: "기관", cltrBidBgngDt: "202605180900", cltrBidEndDt: "202605201700", pbctStatCd: "0002" });

describe("조회기의 호출 간격 (createPublicFetcher)", () => {
  it("같은 서비스(부동산 목록)를 연달아 부르면 설정한 간격을 둔다. 응답 시간(durationMs)에는 기다린 시간이 들어가지 않는다", async () => {
    let t = 0;
    const slept: number[] = [];
    const api = fakeApi(() => okBody([listItem(1)]));
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, now: () => t, callIntervalMs: 200, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    await fetcher("public-list", { remainingCalls: 5, remainingMs: 60_000 });
    t += 50;
    const second = await fetcher("public-list", { remainingCalls: 5, remainingMs: 60_000 });
    expect(slept).toEqual([150]); // 50ms 지났으니 150ms만 더 기다림
    expect(second.durationMs).toBe(0);
  });

  it("호출 간격을 주지 않으면 기다리지 않는다 (기존 동작)", async () => {
    const slept: number[] = [];
    const api = fakeApi(() => okBody([listItem(1)]));
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, sleep: async (ms) => void slept.push(ms) });
    await fetcher("public-list", { remainingCalls: 5, remainingMs: 60_000 });
    await fetcher("public-list", { remainingCalls: 5, remainingMs: 60_000 });
    expect(slept).toEqual([]);
  });
});

// ---- 점검 엔진: 서비스별 예산 · 배치 순서 · 배치 요약 ----
function memoryStore(usedToday: Record<string, number> = {}) {
  const rec = { apiChecks: [] as ApiCheckRecord[], probes: [] as ProbeRecord[], logs: [] as { level: string; code: string; message: string }[] };
  const store: CheckStore = {
    async startRun() {
      return { runId: 21, status: "running" };
    },
    async recordApiCheck(_id, r) {
      rec.apiChecks.push(r);
    },
    async recordProbe(_id, _s, p) {
      rec.probes.push(p);
    },
    async recentProbeHistory() {
      return [];
    },
    async countPublicCallsToday() {
      return 0;
    },
    async countPublicCallsTodayByService() {
      return usedToday;
    },
    async saveCollected() {},
    async recordDetection() {
      return { anomalyId: 1, action: "created" as RecordAction };
    },
    async log(_id, level, code, message) {
      rec.logs.push({ level, code, message });
    },
    async finishRun() {},
  };
  return { store, rec };
}

const extraBody = () => okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", cltrMngNo: "2026-1100-000001", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" });
function mixedApi(extra: (url: URL) => Response = extraBody) {
  return fakeApi((url) => {
    if (url.pathname.endsWith("getRlstCltrList2")) return okBody([listItem(1), listItem(2), listItem(3)]);
    if (url.pathname.endsWith("getRlstDtlInf2")) return okBody(listItem(Number(url.searchParams.get("cltrMngNo")!.slice(-1))));
    return extra(url);
  });
}

async function run(api: ReturnType<typeof mixedApi>, mem = memoryStore(), reverseExtras = false) {
  const targets = genericProbeTargets(NOW);
  const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, extraOperations: targets });
  const endpoints = targets.map((t) => ({ endpoint: t.endpoint, operationKey: t.operationKey }));
  const result = await runCheck({ trigger: "manual", source: "PUBLIC", settings, store: mem.store, fetcher, extraEndpoints: reverseExtras ? [...endpoints].reverse() : endpoints });
  return { result, rec: mem.rec };
}

describe("서비스별 하루 호출 예산 (엔진)", () => {
  const SVC = "SVC-API-011"; // 인기 순위 서비스 (추가 오퍼레이션)

  it("한 서비스의 오늘 예산을 다 썼으면 그 서비스만 호출하지 않고 미점검(BUDGET_SKIP)으로 남기며, 다른 서비스는 계속 점검한다", async () => {
    const limit = serviceDailyLimits()[SVC];
    const api = mixedApi();
    const { result, rec } = await run(api, memoryStore({ [SVC]: limit }));
    const skipped = result.probes.find((p) => p.operationKey.startsWith(`${SVC}/`))!;
    expect(skipped.result).toEqual({ status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" });
    expect(api.urls.some((u) => u.pathname.includes("getInqRnkClg"))).toBe(false); // 요청을 보내지 않음
    expect(rec.logs.filter((l) => l.code === "SERVICE_BUDGET_EXCEEDED")).toHaveLength(1);
    // 다른 서비스는 정상 점검 (격리)
    const others = result.probes.filter((p) => !p.operationKey.startsWith(`${SVC}/`) && "attempted" in p.result && p.result.attempted);
    expect(others.length).toBeGreaterThan(8);
  });

  it("예산 경계: 1회 남았으면 호출하고(한 칸 안), 0회 남았으면 호출하지 않는다(한 칸 밖)", async () => {
    const limit = serviceDailyLimits()[SVC];
    const inside = mixedApi();
    const a = await run(inside, memoryStore({ [SVC]: limit - 1 }));
    expect(inside.urls.some((u) => u.pathname.includes("getInqRnkClg"))).toBe(true);
    expect(a.result.probes.find((p) => p.operationKey.startsWith(`${SVC}/`))!.result).toMatchObject({ attempted: true });
    const outside = mixedApi();
    await run(outside, memoryStore({ [SVC]: limit }));
    expect(outside.urls.some((u) => u.pathname.includes("getInqRnkClg"))).toBe(false);
  });

  it("예산을 다 쓴 서비스는 장애도 이상징후도 아니다 (실패로 세지 않음)", async () => {
    const limit = serviceDailyLimits()[SVC];
    const { result } = await run(mixedApi(), memoryStore({ [SVC]: limit }));
    expect(result.probes.filter((p) => p.operationKey.startsWith(`${SVC}/`) && p.result.status === "FAIL")).toEqual([]);
    expect(result.detections.filter((d) => d.itemKey.startsWith(SVC))).toEqual([]);
  });
});

describe("서비스 단위 배치 순서와 요약 (엔진)", () => {
  it("추가 오퍼레이션을 어떤 순서로 넘겨도 등록부의 서비스 순서대로, 같은 서비스끼리 이어서 호출한다", async () => {
    const api = mixedApi();
    await run(api, memoryStore(), true); // 일부러 거꾸로 넘긴다
    const targets = genericProbeTargets(NOW);
    const expected = targets.map((t) => new URL(t.url).pathname.split("/").pop());
    const actualExtras = api.urls.map((u) => u.pathname.split("/").pop()).filter((name) => expected.includes(name));
    expect(actualExtras).toEqual(expected);
  });

  it("서비스마다 SERVICE_BATCH 요약 로그가 한 줄씩 남고, 판정 분포와 호출 수가 들어 있다", async () => {
    const { rec } = await run(mixedApi());
    const lines = rec.logs.filter((l) => l.code === "SERVICE_BATCH");
    const probedServices = new Set([...genericProbeTargets(NOW).map((t) => t.operationKey.split("/")[0]), "SVC-API-001", "SVC-API-004"]);
    expect(lines).toHaveLength(probedServices.size); // 점검한 서비스마다 한 줄
    const svc011 = lines.find((l) => l.message.includes("SVC-API-011"))!;
    expect(svc011.message).toMatch(/(정상\(데이터\)|실패) 1/);
    expect(svc011.message).toContain("이번 실행 호출 1회");
    const ids = lines.map((l) => /SVC-API-\d+/.exec(l.message)![0]);
    expect(ids).toEqual(API_REGISTRY.services.map((sv) => sv.serviceId).filter((id) => ids.includes(id))); // 등록부 순서
  });

  it("한 서비스가 실패해도 다음 서비스 배치가 이어진다 (격리)", async () => {
    const { result, rec } = await run(mixedApi((url) => (url.pathname.endsWith("getInqRnkClg") ? new Response("x", { status: 500 }) : extraBody())));
    expect(result.probes.find((p) => p.operationKey.startsWith("SVC-API-011/"))!.result).toMatchObject({ status: "FAIL" });
    expect(rec.logs.find((l) => l.code === "SERVICE_BATCH" && l.message.includes("SVC-API-011"))!.message).toContain("실패 1");
    expect(rec.logs.some((l) => l.code === "SERVICE_BATCH" && l.message.includes("SVC-API-012"))).toBe(true);
  });
});

describe("상세 0건 재조회 로그 (엔진)", () => {
  it("상세가 0건이던 물건을 다시 조회했으면 DETAIL_REQUERY 로그에 시도·복구 수를 남긴다", async () => {
    let first = true;
    const api = fakeApi((url) => {
      if (url.pathname.endsWith("getRlstCltrList2")) return okBody([listItem(1), listItem(2)]);
      if (url.pathname.endsWith("getRlstDtlInf2")) {
        const id = Number(url.searchParams.get("cltrMngNo")!.slice(-1));
        if (id === 2 && first) {
          first = false; // 첫 조회만 0건, 재조회는 성공
          return new Response(JSON.stringify({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }));
        }
        return okBody(listItem(id));
      }
      return extraBody();
    });
    const { rec } = await run(api);
    const line = rec.logs.find((l) => l.code === "DETAIL_REQUERY")!;
    expect(line.message).toContain("1건을 한 번 더 조회해 1건에서 상세를 받았습니다");
  });
});

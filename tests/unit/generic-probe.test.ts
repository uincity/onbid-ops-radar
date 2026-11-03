// 일반 조회기로 점검하는 추가 오퍼레이션(1단계 9개 + 2단계 4개) 시험 (R04 확장) — 입력 해석 · 조회기 · 점검 엔진 연결 · 격리 · 호출 예약
// 실제 온비드 API는 부르지 않는다. 가짜 응답(fetchImpl)과 메모리 저장소만 쓴다.
import { describe, expect, it } from "vitest";
import { genericEndpointName, genericProbeTargets, resolveProbeInput } from "@/lib/checks/generic-probe";
import { createPublicFetcher } from "@/lib/checks/public-fetcher";
import { buildPublicCheck } from "@/lib/checks/public-setup";
import { runCheck } from "@/lib/checks/run-check";
import type { ApiCheckRecord, CheckStore, ProbeRecord, LogLevel, RecordAction } from "@/lib/checks/types";
import { DEFAULT_SETTING_VALUES, parseSettings } from "@/lib/settings/schema";
import { allOperations } from "@/lib/registry";

const settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const NOW = new Date("2026-11-03T03:00:00Z"); // KST 2026-11-03 12:00
const KEY = "abc%2Fdef%3D%3D";

describe("resolveProbeInput (자리표시자 해석)", () => {
  it("{PREV_YEAR}는 KST 기준 직전 연도다", () => {
    expect(resolveProbeInput({ inqPerd: "{PREV_YEAR}", statsTypeCd: "0021" }, NOW)).toEqual({ inqPerd: "2025", statsTypeCd: "0021" });
  });
  it("연도 경계: KST 새해 00:00:00부터 직전 연도가 바뀐다 (UTC 12-31 15:00 = KST 01-01 00:00)", () => {
    expect(resolveProbeInput({ inqPerd: "{PREV_YEAR}" }, new Date("2026-12-31T14:59:59Z")).inqPerd).toBe("2025"); // 한 칸 안 (KST 12-31 23:59:59)
    expect(resolveProbeInput({ inqPerd: "{PREV_YEAR}" }, new Date("2026-12-31T15:00:00Z")).inqPerd).toBe("2026"); // 한 칸 밖 (KST 01-01 00:00:00)
  });
  it("알 수 없는 자리표시자는 지어내지 않고 멈춘다", () => {
    expect(() => resolveProbeInput({ x: "{NEXT_WEEK}" }, NOW)).toThrow(/알 수 없는/);
  });
  it("{TODAY}·{DAYS_AGO_7}은 KST 기준 YYYYMMDD다 (월 경계: 11-03의 7일 전은 10-27)", () => {
    expect(resolveProbeInput({ a: "{DAYS_AGO_7}", b: "{TODAY}" }, NOW)).toEqual({ a: "20261027", b: "20261103" });
    // 연도 경계: KST 2027-01-03의 7일 전은 2026-12-27
    expect(resolveProbeInput({ a: "{DAYS_AGO_7}" }, new Date("2027-01-03T03:00:00Z")).a).toBe("20261227");
  });
  it("날짜는 UTC가 아니라 KST로 센다 (UTC 10-31 15:00 = KST 11-01 00:00)", () => {
    expect(resolveProbeInput({ b: "{TODAY}" }, new Date("2026-10-31T14:59:59Z")).b).toBe("20261031");
    expect(resolveProbeInput({ b: "{TODAY}" }, new Date("2026-10-31T15:00:00Z")).b).toBe("20261101");
  });
  it("자리표시자가 없는 값은 그대로다", () => {
    expect(resolveProbeInput({ cltrDivNm: "부동산" }, NOW)).toEqual({ cltrDivNm: "부동산" });
  });
});

describe("genericProbeTargets", () => {
  const targets = genericProbeTargets(NOW);
  it("1·2단계 13개 + 교차 참조 자식(공고 상세) 1개이고, 전용 조회기가 있는 부동산 목록·상세는 빠져 있다", () => {
    expect(targets).toHaveLength(14);
    expect(targets.map((t) => t.operationKey)).toContain("SVC-API-016/getPbancDtlInf");
    expect(targets.map((t) => t.operationKey)).not.toContain("SVC-API-001/getRlstCltrList");
    expect(targets.map((t) => t.operationKey)).not.toContain("SVC-API-004/getRlstDtlInf");
  });
  it("점검 이름은 api_checks 허용 형식이고 서로 다르며, 호출 주소는 https 허용 호스트다", () => {
    expect(new Set(targets.map((t) => t.endpoint)).size).toBe(14);
    for (const t of targets) {
      expect(t.endpoint).toMatch(/^[A-Za-z0-9_.-]{1,60}$/);
      expect(t.url).toMatch(/^https:\/\/apis\.data\.go\.kr\//);
      expect(t.url).not.toMatch(/serviceKey/i);
    }
    expect(genericEndpointName("SVC-API-010", "getItrsCltrRnkClg")).toBe("svc-api-010-getItrsCltrRnkClg");
  });
  it("승인이 확인되지 않은 오퍼레이션은 점검 입력이 있어도 목록에 넣지 않는다", () => {
    const ops = allOperations();
    const one = ops.find((o) => o.key === "SVC-API-010/getItrsCltrRnkClg")!;
    const mutated = { ...one.operation, approval: "UNCONFIRMED" as const };
    const fake = { ...one.service, operations: [mutated] };
    expect(genericProbeTargets(NOW, { services: [fake] } as never)).toEqual([]);
  });
  it("공고 목록·입찰결과 목록은 오늘 기준 최근 7일(KST) 개찰일로 부른다", () => {
    for (const key of ["SVC-API-015/getPbancList", "SVC-API-013/getCltrBidRsltList"]) {
      expect(targets.find((t) => t.operationKey === key)!.params).toEqual({ cltrTypeCd: "0001", prptDivCd: "0007", opbdDtStart: "20261027", opbdDtEnd: "20261103" });
    }
  });
  it("근거가 없는 공고 입찰결과(getPbancBidRsltList)와 정부재산 등은 목록에 없다", () => {
    expect(targets.map((t) => t.operationKey)).not.toContain("SVC-API-019/getPbancBidRsltList");
    expect(targets.some((t) => /SVC-API-02[1-4]/.test(t.operationKey))).toBe(false);
  });
  it("통계 오퍼레이션의 입력이 풀어 쓴 값으로 들어 있다", () => {
    const stats = targets.find((t) => t.operationKey === "SVC-API-026/getKamcoCltrClarStats")!;
    expect(stats.params).toEqual({ statsTypeCd: "0021", inqPerd: "2025" });
  });
});

function fakeApi(handler: (url: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { impl, urls };
}
const okBody = (items: unknown) => new Response(JSON.stringify({ header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: { item: items }, totalCount: 1 } }));
const nodata = () => new Response(JSON.stringify({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }));

describe("일반 조회기 (createPublicFetcher + extraOperations)", () => {
  const target = genericProbeTargets(NOW).find((t) => t.operationKey === "SVC-API-026/getKamcoCltrClarStats")!;

  it("요청: 서비스키·pageNo=1·numOfRows=1·json과 점검 입력을 붙여 부르고, 기록에는 키 없는 요청 요약과 서비스ID·오퍼레이션 ID가 남는다", async () => {
    const api = fakeApi(() => okBody({ statsTypeCd: "0021", inqPerd: "2025" }));
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, extraOperations: [target] });
    const result = await fetcher(target.endpoint, { remainingCalls: 5, remainingMs: 60_000 });
    expect(api.urls).toHaveLength(1);
    const u = api.urls[0];
    expect(u.origin + u.pathname).toBe(target.url);
    expect(u.searchParams.get("numOfRows")).toBe("1");
    expect(u.searchParams.get("pageNo")).toBe("1");
    expect(u.searchParams.get("inqPerd")).toBe("2025");
    expect(u.searchParams.get("statsTypeCd")).toBe("0021");
    expect(result).toMatchObject({ outcome: "success", httpCalls: 1, records: [], apiId: "SVC-API-026", operationId: "getKamcoCltrClarStats", endpointName: target.endpoint });
    expect(result.requestSummary).toContain("inqPerd=2025");
    expect(result.requestSummary).not.toMatch(/serviceKey|abc%2F/i);
  });

  it("0건(결과코드 03)은 empty_result, 서비스키 문제(30)는 auth_or_quota, HTTP 500은 http_error로 구분한다", async () => {
    const outcomes: string[] = [];
    for (const res of [nodata, () => new Response(JSON.stringify({ result: { resultCode: "30", resultMsg: "x" } })), () => new Response("x", { status: 500 })]) {
      const api = fakeApi(res);
      const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, extraOperations: [target] });
      outcomes.push((await fetcher(target.endpoint, { remainingCalls: 5, remainingMs: 60_000 })).outcome);
    }
    expect(outcomes).toEqual(["empty_result", "auth_or_quota", "http_error"]);
  });

  it("추가 오퍼레이션을 넘기지 않으면 알 수 없는 점검 이름으로 멈춘다 (기존 동작)", () => {
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: fakeApi(() => nodata()).impl });
    expect(() => fetcher(target.endpoint, { remainingCalls: 5, remainingMs: 60_000 })).toThrow(/알 수 없는/);
  });
});

// ---- 점검 엔진 연결 ----
function memoryStore(prior: Record<string, { status: never; reason: string | null }[]> = {}) {
  const rec = { apiChecks: [] as ApiCheckRecord[], probes: [] as ProbeRecord[], logs: [] as { level: LogLevel; code: string }[], finished: [] as { status: string; calls: number }[], collected: 0 };
  const store: CheckStore = {
    async startRun() {
      return { runId: 11, status: "running" };
    },
    async recordApiCheck(_id, r) {
      rec.apiChecks.push(r);
    },
    async recordProbe(_id, _s, p) {
      rec.probes.push(p);
    },
    async recentProbeHistory(_s, apiId, operationId) {
      return [...rec.probes.filter((p) => p.apiId === apiId && p.operationId === operationId).reverse().map((p) => ({ status: p.result.status, reason: "code" in p.result ? p.result.code : "reason" in p.result ? p.result.reason : null })), ...(prior[`${apiId}/${operationId}`] ?? [])] as never;
    },
    async countPublicCallsToday() {
      return 0;
    },
    async countPublicCallsTodayByService() {
      return {};
    },
    async saveCollected() {
      rec.collected += 1;
    },
    async recordDetection() {
      return { anomalyId: 1, action: "created" as RecordAction };
    },
    async log(_id, level, code) {
      rec.logs.push({ level, code });
    },
    async finishRun(_id, status, calls) {
      rec.finished.push({ status, calls });
    },
  };
  return { store, rec };
}

const listItem = (n: number) => ({ cltrMngNo: `2026-1100-00000${n}`, pbctCdtnNo: 100 + n, onbidCltrNm: `물건 ${n}`, orgNm: "기관", cltrBidBgngDt: "202605180900", cltrBidEndDt: "202605201700", pbctStatCd: "0002" });

// 부동산 목록·상세는 정상, 추가 오퍼레이션은 요청에 따라 다른 응답을 돌려주는 가짜 서버
function mixedApi(extra: (url: URL) => Response, listCount = 3) {
  return fakeApi((url) => {
    if (url.pathname.endsWith("getRlstCltrList2")) return okBody(Array.from({ length: listCount }, (_, i) => listItem(i + 1)));
    if (url.pathname.endsWith("getRlstDtlInf2")) return okBody(listItem(Number(url.searchParams.get("cltrMngNo")!.slice(-1))));
    return extra(url);
  });
}

describe("점검 엔진 + 추가 오퍼레이션", () => {
  const run = (api: ReturnType<typeof mixedApi>, over: { callLimit?: number; store?: ReturnType<typeof memoryStore> } = {}) => {
    const mem = over.store ?? memoryStore();
    const built = buildPublicCheck({ serviceKey: KEY, timeoutSeconds: 10, now: NOW });
    // 가짜 응답을 쓰도록 조회기를 다시 만든다 (같은 추가 오퍼레이션 목록)
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, extraOperations: genericProbeTargets(NOW) });
    return runCheck({ trigger: "manual", source: "PUBLIC", settings, store: mem.store, fetcher, extraEndpoints: built.extraEndpoints, callLimit: over.callLimit }).then((result) => ({ result, rec: mem.rec }));
  };

  it("목록·상세 2개 + 추가 14개(교차 참조 자식 포함) = 점검 16개가 각각 판정되고, 추가 오퍼레이션의 응답은 저장하지 않는다", async () => {
    const api = mixedApi(() => okBody({ ctgrId: "1", ctgrNm: "x", upCtgrId: "0", pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1" }));
    const { result, rec } = await run(api);
    expect(result.probes).toHaveLength(16);
    expect(rec.probes.filter((p) => p.result.status !== "UNVERIFIED" || p.result.attempted)).toHaveLength(16);
    expect(rec.collected).toBe(2); // 목록·상세만 저장
    // 등록부 28개 중 점검한 16개 + 요청 없이 검증 불가로 남긴 12개 = 28개가 중복 없이 기록됨
    expect(result.unprobeable).toHaveLength(12);
    const keys = rec.probes.map((p) => `${p.apiId}/${p.operationId}`);
    expect(new Set(keys).size).toBe(28);
  });

  it("한 추가 오퍼레이션이 실패(HTTP 500)·타임아웃성 오류여도 다른 오퍼레이션은 계속 점검된다 (격리)", async () => {
    const api = mixedApi((url) => (url.pathname.endsWith("getInqRnkClg") ? new Response("x", { status: 500 }) : okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" })));
    const { result } = await run(api);
    const byOp = Object.fromEntries(result.probes.map((p) => [p.operationKey, p.result]));
    expect(byOp["SVC-API-011/getInqRnkClg"]).toMatchObject({ status: "FAIL", code: "HTTP_ERROR" });
    expect(Object.values(byOp).filter((r) => r.status !== "UNVERIFIED").length).toBeGreaterThan(8);
    expect(result.status).toBe("partial"); // 실패가 하나 있으면 성공으로 마감하지 않는다
  });

  it("추가 오퍼레이션의 0건은 이상징후 없이 검증 불가(NO_DATA_UNCONFIRMED)로 남는다 (정상 무데이터인지 확정할 근거 없음)", async () => {
    const api = mixedApi(() => nodata());
    const { result } = await run(api);
    const stat = result.probes.find((p) => p.operationKey === "SVC-API-026/getOrgCltrClarStats")!;
    expect(stat.result).toEqual({ status: "UNVERIFIED", attempted: true, reason: "NO_DATA_UNCONFIRMED" });
    expect(result.detections.filter((d) => d.ruleId.startsWith("API_"))).toEqual([]);
  });

  it("서비스키 문제(30)가 나면 그 뒤 점검은 하지 않고 검증 불가(선행 실패)로 남기며 이상징후를 만들지 않는다", async () => {
    const api = mixedApi((url) => (url.pathname.endsWith("getInqRnkClg") ? new Response(JSON.stringify({ result: { resultCode: "30", resultMsg: "x" } })) : okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1" })));
    const { result } = await run(api);
    expect(result.status).toBe("failed");
    const after = result.probes.find((p) => p.operationKey === "SVC-API-012/get50PctDecrCltr")!;
    expect(after.result).toMatchObject({ status: "UNVERIFIED", attempted: false, reason: "PRECONDITION_FAILED" });
    expect(result.detections).toEqual([]);
  });

  it("호출 상한 20회: 추가 오퍼레이션 14개 몫을 먼저 떼어 두어, 목록·상세가 다 써도 14개는 모두 호출된다 (총 20회)", async () => {
    // 목록이 물건 30개를 돌려줘도(상세를 30번 부르려 해도) 추가 오퍼레이션 13개 몫은 남아 있어야 한다
    const api = mixedApi(() => okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" }), 30);
    const { result } = await run(api, { callLimit: 20 });
    const extraCalls = api.urls.filter((u) => !/getRlst(CltrList2|DtlInf2)/.test(u.pathname)).length;
    expect(extraCalls).toBe(14);
    expect(result.apiCallCount).toBe(20);
    expect(api.urls.length).toBe(20);
  });

  it("기본 상한 60회(설정값): 추가 오퍼레이션 14개 + 목록 1 + 상세 45 = 60회를 쓰고 넘지 않는다", async () => {
    const api = mixedApi(() => okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" }), 80);
    const { result } = await run(api); // callLimit을 주지 않으면 설정값(기본 60)을 쓴다
    const details = api.urls.filter((u) => u.pathname.endsWith("getRlstDtlInf2")).length;
    const extraCalls = api.urls.filter((u) => !/getRlst(CltrList2|DtlInf2)/.test(u.pathname)).length;
    expect(extraCalls).toBe(14);
    expect(details).toBe(45);
    expect(result.apiCallCount).toBe(60);
    expect(api.urls.length).toBe(60);
  });

  it("호출 상한이 작으면(5회) 앞에서부터 채우고 나머지는 미점검(BUDGET_SKIP)으로 남긴다 — 장애로 세지 않는다", async () => {
    const api = mixedApi(() => okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" }));
    const { result } = await run(api, { callLimit: 5 });
    expect(result.apiCallCount).toBeLessThanOrEqual(5);
    const skipped = result.probes.filter((p) => p.result.status === "NOT_RUN");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((p) => p.result.status === "NOT_RUN" && p.result.reason === "BUDGET_SKIP")).toBe(true);
  });

  it("연속 3번 실패한 추가 오퍼레이션은 API_HTTP_ERROR 이상징후가 된다 (식별값 = 서비스ID/오퍼레이션ID)", async () => {
    const fail = { status: "FAIL" as never, reason: "HTTP_ERROR" };
    const mem = memoryStore({ "SVC-API-011/getInqRnkClg": [fail, fail] });
    const api = mixedApi((url) => (url.pathname.endsWith("getInqRnkClg") ? new Response("x", { status: 500 }) : okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbancMngNo: "202406-21411-00", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" })));
    const { result } = await run(api, { store: mem });
    expect(result.detections.find((d) => d.ruleId === "API_HTTP_ERROR")?.itemKey).toBe("SVC-API-011/getInqRnkClg");
  });

  it("추가 오퍼레이션을 넘기지 않으면 기존과 똑같이 목록·상세 2개만 점검한다", async () => {
    const mem = memoryStore();
    const api = mixedApi(() => nodata());
    const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl });
    const result = await runCheck({ trigger: "manual", source: "PUBLIC", settings, store: mem.store, fetcher });
    expect(result.probes).toHaveLength(2);
    expect(result.unprobeable).toHaveLength(26);
  });
});

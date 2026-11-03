// 교차 참조 DQ_CROSS_API_REF 시험 (공고 목록 → 공고 상세, PRD 5-2A) — 관계 검증 · 조회기의 식별키 전달 · 엔진 판정(정상·의심·적용 제외)
// 실제 온비드 API는 부르지 않는다. 가짜 응답(fetchImpl)과 메모리 저장소만 쓴다.
import { describe, expect, it } from "vitest";
import { CROSS_API_RELATIONS, inputsFromParent, LINK_VALUE_PATTERN, relationProblems, validCrossApiRelations } from "@/lib/checks/cross-api";
import { genericProbeTargets } from "@/lib/checks/generic-probe";
import { createPublicFetcher } from "@/lib/checks/public-fetcher";
import { runCheck } from "@/lib/checks/run-check";
import type { ApiCheckRecord, CheckStore, ProbeRecord, RecordAction } from "@/lib/checks/types";
import { allOperations, API_REGISTRY } from "@/lib/registry";
import { DEFAULT_SETTING_VALUES, parseSettings } from "@/lib/settings/schema";

const settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const NOW = new Date("2026-11-03T03:00:00Z");
const KEY = "abc%2Fdef%3D%3D";
const PARENT = "SVC-API-015/getPbancList";
const CHILD = "SVC-API-016/getPbancDtlInf";
const REL = CROSS_API_RELATIONS[0];

describe("관계 목록과 등록부(명세)의 일치", () => {
  it("공고 목록(015) → 공고 상세(016)는 등록부와 맞는 공식 관계다", () => {
    expect(REL).toEqual({ parentKey: PARENT, childKey: CHILD, fields: ["pbancMngNo"] });
    expect(relationProblems(REL)).toEqual([]);
  });

  it("선언한 관계 8개가 모두 등록부(명세)와 맞는다: 자식의 필수 입력 = 관계의 항목, 부모 응답에 항목이 있고, 부모가 자식의 입력 출처 후보다", () => {
    expect(CROSS_API_RELATIONS).toHaveLength(8);
    for (const relation of CROSS_API_RELATIONS) expect(relationProblems(relation), `${relation.parentKey} → ${relation.childKey}`).toEqual([]);
    expect(validCrossApiRelations()).toEqual([...CROSS_API_RELATIONS]);
  });

  it("자식은 하나의 부모만 갖고, 등록부 순서에서 부모보다 뒤에 있다 (엔진이 등록부 순서로 부르므로 부모 값을 먼저 얻는다)", () => {
    const order = allOperations().map((o) => o.key);
    const children = CROSS_API_RELATIONS.map((r) => r.childKey);
    expect(new Set(children).size).toBe(children.length);
    for (const r of CROSS_API_RELATIONS) expect(order.indexOf(r.parentKey), `${r.parentKey} → ${r.childKey}`).toBeLessThan(order.indexOf(r.childKey));
  });

  it("부모에서 자식 입력 만들기: 필요한 항목이 모두 있어야 하고(한 칸 안), 하나라도 없거나 위험한 모양이면 만들지 않는다(한 칸 밖)", () => {
    const two = { parentKey: "a/b", childKey: "c/d", fields: ["cltrMngNo", "pbctCdtnNo"] };
    expect(inputsFromParent(two, { cltrMngNo: ["X-1"], pbctCdtnNo: ["100"] })).toEqual({ cltrMngNo: "X-1", pbctCdtnNo: "100" });
    expect(inputsFromParent(two, { cltrMngNo: ["X-1"] })).toBeUndefined();
    expect(inputsFromParent(two, { cltrMngNo: ["X-1"], pbctCdtnNo: ["a b"] })).toBeUndefined();
    expect(inputsFromParent(two, { cltrMngNo: ["bad value", "X-2"], pbctCdtnNo: ["100"] })).toEqual({ cltrMngNo: "X-2", pbctCdtnNo: "100" }); // 쓸 수 있는 첫 값을 쓴다
    expect(inputsFromParent(two, undefined)).toBeUndefined();
  });

  it("부모가 자식 입력값의 출처로 연결돼 있지 않거나, 항목이 없으면 관계로 쓰지 않는다", () => {
    const withoutSource = structuredClone(API_REGISTRY);
    for (const s of withoutSource.services) for (const o of s.operations) if (`${s.serviceId}/${o.operationId}` === CHILD) o.inputSourceCandidates = [];
    expect(relationProblems(REL, withoutSource).join()).toContain("입력값 출처");
    expect(validCrossApiRelations(withoutSource)).not.toContainEqual(REL); // 연결이 끊긴 관계만 빠진다
    expect(validCrossApiRelations(withoutSource)).toHaveLength(7);

    expect(relationProblems({ ...REL, fields: ["noSuchField"] }).join()).toContain("noSuchField");
    expect(relationProblems({ ...REL, childKey: "SVC-API-999/none" }).join()).toContain("등록부에 없습니다");
  });

  it("식별키 값은 영문·숫자·점·밑줄·하이픈 1~60자만 쓴다 (경계: 60자 안, 61자 밖)", () => {
    expect(LINK_VALUE_PATTERN.test("202406-21411-00")).toBe(true);
    expect(LINK_VALUE_PATTERN.test("a".repeat(60))).toBe(true);
    expect(LINK_VALUE_PATTERN.test("a".repeat(61))).toBe(false);
    for (const bad of ["", "a b", "a/b", "a&b=1", "a?x", "가나"]) expect(LINK_VALUE_PATTERN.test(bad), bad).toBe(false);
  });

  it("점검 대상 목록에 자식이 부모보다 뒤에 있고, 부모는 식별키를 뽑으며 자식은 입력을 받는다", () => {
    const targets = genericProbeTargets(NOW);
    const keys = targets.map((t) => t.operationKey);
    expect(keys.indexOf(PARENT)).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf(CHILD)).toBeGreaterThan(keys.indexOf(PARENT));
    expect(targets.find((t) => t.operationKey === PARENT)).toMatchObject({ linkFields: ["pbancMngNo"] });
    expect(targets.find((t) => t.operationKey === CHILD)).toMatchObject({ params: {}, linkFields: ["pbancMngNo"], inputNames: ["pbancMngNo"] });
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
const nodata = () => new Response(JSON.stringify({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }));
const CTX = { remainingCalls: 5, remainingMs: 60_000 };

describe("조회기: 식별키 뽑기와 전달", () => {
  const targets = genericProbeTargets(NOW);
  const make = (handler: (url: URL) => Response) => {
    const api = fakeApi(handler);
    return { api, fetcher: createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: api.impl, extraOperations: targets }) };
  };
  const parentName = targets.find((t) => t.operationKey === PARENT)!.endpoint;
  const childName = targets.find((t) => t.operationKey === CHILD)!.endpoint;

  it("부모 응답에서 식별키 값을 뽑아 돌려준다 (최대 5개, 문자·숫자만, 성공한 응답에서만)", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ pbancMngNo: `P-${i}` }));
    const { fetcher } = make(() => okBody(items));
    expect((await fetcher(parentName, CTX)).linkValues).toEqual({ pbancMngNo: ["P-0", "P-1", "P-2", "P-3", "P-4"] });
    const { fetcher: mixed } = make(() => okBody([{ pbancMngNo: 12345 }, { pbancMngNo: null }, { other: "x" }, { pbancMngNo: { a: 1 } }]));
    expect((await mixed(parentName, CTX)).linkValues).toEqual({ pbancMngNo: ["12345"] });
    const { fetcher: empty } = make(() => nodata());
    expect((await empty(parentName, CTX)).linkValues).toBeUndefined();
  });

  it("자식은 전달받은 식별키를 요청에 넣어 부르고, 응답에서 다시 식별키를 뽑는다", async () => {
    const { api, fetcher } = make(() => okBody({ pbancMngNo: "P-1" }));
    const result = await fetcher(childName, { ...CTX, inputs: { pbancMngNo: "P-1" } });
    expect(api.urls[0].searchParams.get("pbancMngNo")).toBe("P-1");
    expect(result.linkValues).toEqual({ pbancMngNo: ["P-1"] });
  });

  it("입력값이 없거나 요청에 넣기 위험한 모양이면 호출하지 않고 멈춘다", async () => {
    const { api, fetcher } = make(() => okBody({}));
    await expect(fetcher(childName, CTX)).rejects.toThrow(/입력값/);
    await expect(fetcher(childName, { ...CTX, inputs: { pbancMngNo: "a&b=1" } })).rejects.toThrow(/입력값/);
    await expect(fetcher(childName, { ...CTX, inputs: { other: "x" } })).rejects.toThrow(/입력값/);
    expect(api.urls).toHaveLength(0);
  });
});

// ---- 점검 엔진 ----
function memoryStore() {
  const rec = { apiChecks: [] as ApiCheckRecord[], probes: [] as ProbeRecord[], logs: [] as { code: string; message: string }[] };
  const store: CheckStore = {
    async startRun() {
      return { runId: 31, status: "running" };
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
      return {};
    },
    async saveCollected() {},
    async recordDetection() {
      return { anomalyId: 1, action: "created" as RecordAction };
    },
    async log(_id, _level, code, message) {
      rec.logs.push({ code, message });
    },
    async finishRun() {},
  };
  return { store, rec };
}

const listItem = (n: number) => ({ cltrMngNo: `2026-1100-00000${n}`, pbctCdtnNo: 100 + n, onbidCltrNm: `물건 ${n}`, orgNm: "기관", cltrBidBgngDt: "202605180900", cltrBidEndDt: "202605201700", pbctStatCd: "0002" });
const other = () => okBody({ pbctCdtnNo: "1", onbidPbancNo: "1", pbctNo: "1", ctgrId: "1", ctgrNm: "x", upCtgrId: "0" });

// 공고 목록(부모)·공고 상세(자식)만 시험하려고 나머지는 평범한 응답을 준다
function api(parent: (url: URL) => Response, child: (url: URL) => Response) {
  return fakeApi((url) => {
    if (url.pathname.endsWith("getRlstCltrList2")) return okBody([listItem(1)]);
    if (url.pathname.endsWith("getRlstDtlInf2")) return okBody(listItem(1));
    if (url.pathname.endsWith("getPbancList2")) return parent(url);
    if (url.pathname.endsWith("getPbancDtlInf2")) return child(url);
    return other();
  });
}
async function run(fake: ReturnType<typeof api>) {
  const targets = genericProbeTargets(NOW);
  const fetcher = createPublicFetcher({ serviceKey: KEY, timeoutSeconds: 10, fetchImpl: fake.impl, extraOperations: targets });
  const mem = memoryStore();
  const result = await runCheck({ trigger: "manual", source: "PUBLIC", settings, store: mem.store, fetcher, extraEndpoints: targets.map((t) => ({ endpoint: t.endpoint, operationKey: t.operationKey })) });
  return { result, rec: mem.rec, childCalls: fake.urls.filter((u) => u.pathname.endsWith("getPbancDtlInf2")) };
}
const cross = <T extends { ruleId: string }>(detections: T[]) => detections.filter((d) => d.ruleId === "DQ_CROSS_API_REF");
const childProbe = (probes: { operationKey: string; result: unknown }[]) => probes.find((p) => p.operationKey === CHILD)!.result;

describe("DQ_CROSS_API_REF (엔진)", () => {
  it("정상: 부모 목록의 식별키로 자식을 부르고, 자식이 같은 식별키를 돌려주면 의심 없음 (검사 1건)", async () => {
    const { result, rec, childCalls } = await run(api(() => okBody({ pbancMngNo: "P-1", onbidPbancNo: "1" }), () => okBody({ pbancMngNo: "P-1" })));
    expect(childCalls).toHaveLength(1);
    expect(childCalls[0].searchParams.get("pbancMngNo")).toBe("P-1");
    expect(cross(result.detections)).toEqual([]);
    expect(rec.logs.find((l) => l.code === "DQ_CROSS_API_CHECKED")?.message).toContain("검사 1건");
    expect(rec.logs.some((l) => l.code === "DQ_CROSS_API_NOT_APPLICABLE")).toBe(false);
  });

  it("의심: 자식이 부모 목록에 없는 식별키를 돌려주면 DQ_CROSS_API_REF를 등록한다 (식별값 = 자식 오퍼레이션 + 요청한 식별키)", async () => {
    const { result } = await run(api(() => okBody({ pbancMngNo: "P-1" }), () => okBody({ pbancMngNo: "P-2" })));
    const found = cross(result.detections);
    expect(found).toHaveLength(1);
    expect(found[0].itemKey).toBe(`${CHILD}:P-1`);
    expect(found[0].evidence).toMatchObject({ rule: "DQ_CROSS_API_REF", childKey: "P-1", parentKey: "P-2" });
    expect(found[0].valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("판정 보류: 자식이 0건이면 이상징후를 만들지 않고 적용 제외로 남긴다 (정당한 예외와 구분할 수 없음)", async () => {
    const { result, rec } = await run(api(() => okBody({ pbancMngNo: "P-1" }), () => nodata()));
    expect(cross(result.detections)).toEqual([]);
    expect(rec.logs.some((l) => l.code === "DQ_CROSS_API_NOT_APPLICABLE")).toBe(true);
    expect(rec.logs.some((l) => l.code === "DQ_CROSS_API_CHECKED")).toBe(false);
  });

  it("부모가 0건이라 식별키를 얻지 못하면 자식을 부르지 않고 검증 불가(입력값 없음)로 남긴다", async () => {
    const { result, rec, childCalls } = await run(api(() => nodata(), () => okBody({ pbancMngNo: "P-1" })));
    expect(childCalls).toHaveLength(0);
    expect(childProbe(result.probes)).toEqual({ status: "UNVERIFIED", attempted: false, reason: "NO_VALID_INPUT" });
    expect(cross(result.detections)).toEqual([]);
    expect(rec.logs.some((l) => l.code === "DQ_CROSS_API_NOT_APPLICABLE")).toBe(true);
  });

  it("부모 응답에 식별키 항목이 없으면 부모 자체가 응답 구조 오류(FAIL)라 자식은 선행 실패로 남는다", async () => {
    const { result, childCalls } = await run(api(() => okBody({ onbidPbancNo: "1" }), () => okBody({ pbancMngNo: "P-1" })));
    expect(childCalls).toHaveLength(0);
    expect(result.probes.find((p) => p.operationKey === PARENT)!.result).toMatchObject({ status: "FAIL", code: "SCHEMA_ERROR" });
    expect(childProbe(result.probes)).toEqual({ status: "UNVERIFIED", attempted: false, reason: "PRECONDITION_FAILED" });
  });

  it("부모가 실패하면(HTTP 500) 자식은 선행 실패로 검증 불가이고, 자식 오퍼레이션 장애로 세지 않는다", async () => {
    const { result, childCalls } = await run(api(() => new Response("x", { status: 500 }), () => okBody({ pbancMngNo: "P-1" })));
    expect(childCalls).toHaveLength(0);
    expect(childProbe(result.probes)).toEqual({ status: "UNVERIFIED", attempted: false, reason: "PRECONDITION_FAILED" });
    expect(cross(result.detections)).toEqual([]);
  });

  it("식별키가 요청에 넣기 위험한 모양이면(공백·기호) 자식을 부르지 않는다", async () => {
    const { childCalls, result } = await run(api(() => okBody({ pbancMngNo: "P 1&x=1" }), () => okBody({ pbancMngNo: "P-1" })));
    expect(childCalls).toHaveLength(0);
    expect(childProbe(result.probes)).toMatchObject({ status: "UNVERIFIED", attempted: false });
  });

  it("자식이 실패해도(HTTP 500) 이상징후는 만들지 않고 다른 점검은 계속된다 (격리)", async () => {
    const { result, childCalls } = await run(api(() => okBody({ pbancMngNo: "P-1" }), () => new Response("x", { status: 500 })));
    expect(childCalls).toHaveLength(1);
    expect(childProbe(result.probes)).toMatchObject({ status: "FAIL", code: "HTTP_ERROR" });
    expect(cross(result.detections)).toEqual([]);
    expect(result.probes.filter((p) => "attempted" in p.result && p.result.attempted).length).toBeGreaterThan(10);
  });
});

// ---- 식별번호(cltrMngNo·pbctCdtnNo)로 부르는 자식들: 동산·자동차·입찰결과 상세, 물건 입찰 정보 ----
describe("관계가 여러 개일 때 (엔진)", () => {
  const mvast = (over: Record<string, unknown> = {}) => okBody({ cltrMngNo: "M-1", pbctCdtnNo: "100", onbidPbancNo: "1", pbctNo: "1", pbancMngNo: "P-1", ...over });
  // 경로 끝 이름 → 응답. 정해지지 않은 경로는 평범한 응답을 준다
  function byPath(map: Record<string, (url: URL) => Response>) {
    return fakeApi((url) => {
      if (url.pathname.endsWith("getRlstCltrList2")) return okBody([listItem(1)]);
      if (url.pathname.endsWith("getRlstDtlInf2")) return okBody(listItem(1));
      const name = url.pathname.split("/").pop()!;
      return (map[name] ?? (() => mvast()))(url);
    });
  }
  const callsTo = (fake: ReturnType<typeof byPath>, name: string) => fake.urls.filter((u) => u.pathname.endsWith(name));

  it("부모가 모든 식별키를 내주면 자식 8개를 모두 부른다. 각 자식은 자기 필수 입력만 받는다", async () => {
    const fake = byPath({});
    const { result } = await run(fake);
    const childNames = ["getPbancDtlInf2", "getPbancBidInf2", "getPbancCltrInf2", "getPbancBidRsltDtl2", "getMvastDtlInf2", "getCarDtlInf2", "getCltrBidInf2", "getCltrBidRsltDtl2"];
    for (const name of childNames) expect(callsTo(fake, name), name).toHaveLength(1);
    expect(callsTo(fake, "getPbancBidInf2")[0].searchParams.get("pbancMngNo")).toBe("P-1");
    expect(callsTo(fake, "getMvastDtlInf2")[0].searchParams.get("cltrMngNo")).toBe("M-1");
    expect(callsTo(fake, "getMvastDtlInf2")[0].searchParams.has("pbctCdtnNo")).toBe(false); // 필수 입력이 아닌 값은 보내지 않는다
    const bid = callsTo(fake, "getCltrBidInf2")[0];
    expect([bid.searchParams.get("cltrMngNo"), bid.searchParams.get("pbctCdtnNo")]).toEqual(["M-1", "100"]); // 두 항목이 모두 필요한 자식
    expect(result.probes.filter((p) => CROSS_API_RELATIONS.some((r) => r.childKey === p.operationKey) && "attempted" in p.result && p.result.attempted)).toHaveLength(8);
  });

  it("두 항목이 필요한 자식은 하나라도 쓸 수 없으면 부르지 않는다 (공매조건번호가 위험한 모양)", async () => {
    const fake = byPath({ getMvastCltrList2: () => mvast({ pbctCdtnNo: "1 2" }) });
    const { result } = await run(fake);
    expect(callsTo(fake, "getCltrBidInf2")).toHaveLength(0);
    expect(result.probes.find((p) => p.operationKey === "SVC-API-007/getCltrBidInf")!.result).toMatchObject({ status: "UNVERIFIED", attempted: false }); // 이 가짜 부모는 응답 구조도 부족해 이유는 선행 실패로 남는다
    expect(callsTo(fake, "getMvastDtlInf2")).toHaveLength(1); // 같은 부모의 다른 자식(필수 입력이 cltrMngNo뿐)은 계속 점검된다
  });

  it("한 부모가 실패해도 다른 부모의 자식은 계속 점검된다 (격리)", async () => {
    const fake = byPath({ getMvastCltrList2: () => new Response("x", { status: 500 }) });
    const { result } = await run(fake);
    expect(callsTo(fake, "getMvastDtlInf2")).toHaveLength(0);
    expect(callsTo(fake, "getCarDtlInf2")).toHaveLength(1);
    expect(callsTo(fake, "getPbancDtlInf2")).toHaveLength(1);
    expect(result.probes.find((p) => p.operationKey === "SVC-API-005/getMvastDtlInf")!.result).toEqual({ status: "UNVERIFIED", attempted: false, reason: "PRECONDITION_FAILED" });
  });

  it("자식이 다른 물건관리번호를 돌려주면 그 관계의 DQ_CROSS_API_REF를 등록한다 (다른 관계는 영향 없음)", async () => {
    const fake = byPath({ getMvastDtlInf2: () => mvast({ cltrMngNo: "M-OTHER" }) });
    const { result } = await run(fake);
    const found = cross(result.detections);
    expect(found).toHaveLength(1);
    expect(found[0].itemKey).toBe("SVC-API-005/getMvastDtlInf:M-1");
  });

  it("자식이 대표 식별키를 응답에 싣지 않으면 판정을 보류한다 (이상징후 없음)", async () => {
    const fake = byPath({ getPbancBidInf2: () => okBody({ onbidPbancNo: "1" }) });
    const { result } = await run(fake);
    expect(cross(result.detections)).toEqual([]);
  });
});

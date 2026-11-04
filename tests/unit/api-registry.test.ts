// 서비스 등록부 시험 (R01): 등록부의 숫자·식별값·확인 상태가 약속대로인지, 잘못된 등록부는 거부되는지,
// 그리고 이미 구현된 PUBLIC 조회기의 주소·저장 필드·오류 코드와 등록부가 서로 어긋나지 않는지 본다.
import { describe, expect, it } from "vitest";
import registryJson from "@/data/registry/api-registry.json";
import { API_REGISTRY, allOperations, findOperation, liveVerifiedOperations, registryCoverage } from "@/lib/registry";
import { registrySchema, type ApiRegistry } from "@/lib/registry/schema";
import { PUBLIC_DETAIL_URL, PUBLIC_LIST_URL, PUBLIC_STORED_FIELDS } from "@/lib/checks/public-fetcher";
import { AUTH_OR_QUOTA_CODES } from "@/lib/checks/public-response";
import { PUBLIC_PROFILE } from "@/lib/rules/field-profile";

const clone = () => structuredClone(registryJson) as unknown as ApiRegistry;
const rejects = (mutate: (r: ReturnType<typeof clone>) => void) => {
  const r = clone();
  mutate(r);
  return registrySchema.safeParse(r).success === false;
};

describe("등록부 내용 (2026-10-29 확정)", () => {
  it("관리 목표 26종을 모두 등록했다(16번 활용가이드 SVC-API-009 유가증권 상세정보 추가, 2026-11-04). 미확정은 없다", () => {
    expect(registryCoverage()).toEqual({ target: 26, registered: 26, unconfirmed: 0, operations: 29, liveVerifiedOperations: 27 });
    expect(API_REGISTRY.unresolved).toHaveLength(0);
    // 16번 활용가이드는 SVC-API-009(유가증권 상세정보)다. 서비스 ID는 001~027 중 008이 없어 26개다(명세서에도 008에 해당하는 문서가 없음)
    expect(findOperation("SVC-API-009/getSctDtlInf")?.operation.requiredParams.map((p) => p.name)).toEqual(["cltrMngNo"]);
    expect(findOperation("SVC-API-009/getSctDtlInf")?.operation.url).toBe("https://apis.data.go.kr/B010003/OnbidSctDtlInfSrvc/getSctDtlInf");
  });

  it("실호출로 확인한 오퍼레이션은 27개다: 부동산 목록·상세(2026-10-29)와 사용자가 실행한 25개(2026-11-03)", () => {
    expect(liveVerifiedOperations().map((o) => o.key).sort()).toEqual([
      "SVC-API-001/getRlstCltrList",
      "SVC-API-002/getMvastCltrList",
      "SVC-API-003/getCarCltrList",
      "SVC-API-004/getRlstDtlInf",
      "SVC-API-005/getMvastDtlInf",
      "SVC-API-006/getCarDtlInf",
      "SVC-API-007/getCltrBidInf",
      "SVC-API-010/getItrsCltrRnkClg",
      "SVC-API-011/getInqRnkClg",
      "SVC-API-012/get50PctDecrCltr",
      "SVC-API-013/getCltrBidRsltList",
      "SVC-API-014/getCltrBidRsltDtl",
      "SVC-API-015/getPbancList",
      "SVC-API-016/getPbancDtlInf",
      "SVC-API-017/getPbancBidInf",
      "SVC-API-018/getPbancCltrInf",
      "SVC-API-019/getPbancBidRsltList",
      "SVC-API-020/getPbancBidRsltDtl",
      "SVC-API-021/getGvwsGnrPrptInf",
      "SVC-API-023/getPjpnBlnPrptInf",
      "SVC-API-024/getDisuseCmdtyInf",
      "SVC-API-025/getOnbidDtlAddrInfo",
      "SVC-API-025/getOnbidUsgCodeInfo",
      "SVC-API-026/getKamcoCltrClarStats",
      "SVC-API-026/getOrgCltrClarStats",
      "SVC-API-027/getKamcoCltrUsgStats",
      "SVC-API-027/getOrgCltrUsgStats",
    ]);
  });

  it("나머지 2개 오퍼레이션(공유일반재산: 실호출 결과 0건이라 무데이터 허용 / 유가증권 상세정보: 점검 입력 미정)은 명세만 확인했고, 승인·쿼터는 사용자가 확인했지만(2026-11-03) 점검 입력은 정하지 않아 점검 전 상태가 UNVERIFIED:NO_VALID_INPUT이다", () => {
    const others = allOperations().filter((o) => o.operation.verification.state === "SPEC_ONLY");
    expect(others.map((o) => o.key).sort()).toEqual(["SVC-API-009/getSctDtlInf", "SVC-API-022/getPbownGnrPrptInf"]);
    for (const { operation, key } of others) {
      expect(operation.approval, key).toBe("APPROVED");
      // 공유일반재산은 2026-11-04 9가지 입력에서 모두 0건이라 사용자 결정으로 0건을 정상 무데이터로 처리, 유가증권 상세정보는 무데이터 정책 미정
      expect(operation.noDataPolicy, key).toBe(key === "SVC-API-022/getPbownGnrPrptInf" ? "ALLOWED" : "UNDEFINED");
      if (operation.probe.input === null) {
        // 점검 입력의 근거가 없는 것은 비워 두고 검증 불가로 둔다 (지어내지 않는다)
        expect(operation.availabilityBeforeProbe, key).toBe("UNVERIFIED:NO_VALID_INPUT");
        expect(operation.probe, key).toEqual({ mode: null, input: null, inputSource: null });
      } else {
        expect(operation.availabilityBeforeProbe, key).toBeNull(); // 점검 대기
      }
    }
  });

  it("점검 입력은 1·2단계 13개(사용자 수집 코드)와 3단계 5개(서비스 명세서 샘플 값)이고, 모두 점검 방식과 근거가 있으며 내 PC 경로가 들어 있지 않다", () => {
    const withInput = allOperations().filter((o) => o.operation.probe.input !== null);
    expect(withInput.map((o) => o.key).sort()).toEqual([
      "SVC-API-002/getMvastCltrList",
      "SVC-API-003/getCarCltrList",
      "SVC-API-010/getItrsCltrRnkClg",
      "SVC-API-011/getInqRnkClg",
      "SVC-API-012/get50PctDecrCltr",
      "SVC-API-013/getCltrBidRsltList",
      "SVC-API-015/getPbancList",
      "SVC-API-019/getPbancBidRsltList",
      "SVC-API-021/getGvwsGnrPrptInf",
      "SVC-API-022/getPbownGnrPrptInf",
      "SVC-API-023/getPjpnBlnPrptInf",
      "SVC-API-024/getDisuseCmdtyInf",
      "SVC-API-025/getOnbidDtlAddrInfo",
      "SVC-API-025/getOnbidUsgCodeInfo",
      "SVC-API-026/getKamcoCltrClarStats",
      "SVC-API-026/getOrgCltrClarStats",
      "SVC-API-027/getKamcoCltrUsgStats",
      "SVC-API-027/getOrgCltrUsgStats",
    ]);
    const specSample = ["SVC-API-019", "SVC-API-021", "SVC-API-022", "SVC-API-023", "SVC-API-024"];
    for (const { operation, key } of withInput) {
      expect(operation.probe.mode, key).toBe("structural");
      // 3단계는 수집 코드가 없어 명세서 샘플 값이 근거다 (사용자 승인 2026-11-03)
      expect(operation.probe.inputSource, key).toMatch(specSample.includes(key.split("/")[0]) ? /서비스 명세서 샘플 값/ : /사용자 수집 코드 .+\.py/);
      expect(operation.probe.inputSource, key).not.toMatch(/[A-Za-z]:[\\/]|\/Users\//); // 드라이브 경로(D:\...)나 홈 폴더 경로가 없어야 한다
    }
    // 근거가 되는 값 그대로인지 (사용자 수집 코드에서 확인한 코드 값)
    const input = (k: string) => allOperations().find((o) => o.key === k)!.operation.probe.input;
    expect(input("SVC-API-026/getKamcoCltrClarStats")).toEqual({ statsTypeCd: "0021", inqPerd: "{PREV_YEAR}" });
    expect(input("SVC-API-027/getKamcoCltrUsgStats")).toEqual({ statsTypeCd: "0041", inqPerd: "{PREV_YEAR}" });
    expect(input("SVC-API-010/getItrsCltrRnkClg")).toEqual({ cltrDivNm: "부동산" });
  });

  it("사용자가 확인한 일일 쿼터(100,000회)가 25종 모든 오퍼레이션에 근거와 함께 들어 있다", () => {
    for (const { operation, key } of allOperations()) {
      expect(operation.quota, key).toMatchObject({ dailyLimit: 100000 });
      expect(operation.quota?.source, key).toContain("사용자 확인 2026-11-03");
    }
  });

  it("식별 파라미터가 필수인 오퍼레이션은 입력값 출처 후보를 가지며 UNVERIFIED:NO_VALID_INPUT이다", () => {
    for (const { operation, key } of allOperations()) {
      const needsIds = operation.requiredParams.some((p) => ["cltrMngNo", "pbctCdtnNo", "pbancMngNo"].includes(p.name));
      if (needsIds) {
        expect(operation.inputSourceCandidates.length, key).toBeGreaterThan(0);
        if (operation.verification.state === "SPEC_ONLY") expect(operation.availabilityBeforeProbe, key).toBe("UNVERIFIED:NO_VALID_INPUT");
      } else {
        expect(operation.inputSourceCandidates, key).toEqual([]);
      }
    }
  });

  it("부동산 물건상세의 입력값 출처 후보에 부동산 물건목록이 들어 있다", () => {
    expect(findOperation("SVC-API-004/getRlstDtlInf")?.operation.inputSourceCandidates).toContain("SVC-API-001/getRlstCltrList");
  });

  it("모든 호출 주소는 https이고 허용 호스트(apis.data.go.kr)이며 읽기 전용 GET이다", () => {
    for (const { operation, key } of allOperations()) {
      const url = new URL(operation.url);
      expect(url.protocol, key).toBe("https:");
      expect(API_REGISTRY.common.allowedHosts, key).toContain(url.hostname);
      expect(operation.method, key).toBe("GET");
      expect(operation.url, key).not.toMatch(/serviceKey|%2[FfBb]/);
    }
  });

  it("오퍼레이션마다 응답 항목을 읽었다 (비어 있지 않음)", () => {
    for (const { operation, key } of allOperations()) {
      expect(operation.responseFields.length, key).toBeGreaterThan(0);
      expect(operation.responseFieldCount, key).toBeGreaterThanOrEqual(operation.responseFields.length);
    }
  });

  it("결과코드표는 명세서 25개에서 모두 같았고, 정상(00)·데이터없음(03)·서비스키 관련 코드가 있다", () => {
    expect(API_REGISTRY.common.resultCodesDifferInDocs).toEqual([]);
    const codes = API_REGISTRY.common.resultCodes.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["00", "03", "20", "22", "30"]));
    expect(API_REGISTRY.common.resultCodes.find((c) => c.code === "03")?.message).toBe("NODATA_ERROR");
  });

  it("비밀 값처럼 보이는 문자열이 없다 (긴 영숫자·인코딩된 키 모양)", () => {
    const text = JSON.stringify(registryJson);
    expect(text).not.toMatch(/%2[FfBb]|%3[Dd]%3[Dd]/);
    expect(text).not.toMatch(/[A-Za-z0-9]{40,}/);
  });
});

describe("이미 구현된 PUBLIC 조회기와 등록부가 어긋나지 않는다", () => {
  const list = findOperation("SVC-API-001/getRlstCltrList")!.operation;
  const detail = findOperation("SVC-API-004/getRlstDtlInf")!.operation;

  it("조회기가 부르는 주소가 등록부의 목록·상세 주소와 같다", () => {
    expect(PUBLIC_LIST_URL).toBe(list.url);
    expect(PUBLIC_DETAIL_URL).toBe(detail.url);
  });

  it("조회기가 저장하는 필드는 등록부의 목록·상세 응답 항목에 모두 있다 (명세에 없는 필드를 만들지 않음)", () => {
    const listFields = new Set(list.responseFields.map((f) => f.name));
    const detailFields = new Set(detail.responseFields.map((f) => f.name));
    for (const field of PUBLIC_STORED_FIELDS) {
      expect(listFields.has(field), `목록 응답에 ${field}`).toBe(true);
      expect(detailFields.has(field), `상세 응답에 ${field}`).toBe(true);
    }
  });

  it("PUBLIC 프로필의 필수·비교 필드도 등록부 응답 항목 안에 있다", () => {
    const listFields = new Set(list.responseFields.map((f) => f.name));
    for (const f of [...PUBLIC_PROFILE.requiredFields, ...PUBLIC_PROFILE.compareFields]) expect(listFields.has(f), f).toBe(true);
  });

  it("조회기의 필수 요청 파라미터가 등록부와 같다 (목록: 재산유형·수의계약 / 상세: 물건관리번호)", () => {
    expect(list.requiredParams.map((p) => p.name).sort()).toEqual(["prptDivCd", "pvctTrgtYn"]);
    expect(detail.requiredParams.map((p) => p.name)).toEqual(["cltrMngNo"]);
  });

  it("서비스키·한도 문제로 분류하는 코드가 모두 등록부 결과코드표에 있다", () => {
    const registered = new Set(API_REGISTRY.common.resultCodes.map((c) => c.code));
    for (const code of AUTH_OR_QUOTA_CODES) expect(registered.has(code), code).toBe(true);
  });

  it("조회기가 쓰는 초당·평균 응답 기준이 명세서의 초당 10회와 맞다 (호출 간격 설계의 근거)", () => {
    expect(list.tpsLimit).toBe(10);
    expect(detail.tpsLimit).toBe(10);
  });
});

describe("잘못된 등록부는 거부된다", () => {
  it("원본은 통과한다", () => {
    expect(registrySchema.safeParse(registryJson).success).toBe(true);
  });

  it("서비스ID 중복", () => expect(rejects((r) => (r.services[1].serviceId = r.services[0].serviceId))).toBe(true));
  it("확정 서비스 수가 실제 등록 수와 다름", () => expect(rejects((r) => (r.confirmedServices = 25))).toBe(true));
  it("목표 수 ≠ 확정 + 미확정", () => expect(rejects((r) => (r.targetServices = 27))).toBe(true));
  it("미확정 서비스가 없는데 미확정 슬롯 설명이 있음", () => expect(rejects((r) => (r.unresolved = [{ slot: "x", state: "UNCONFIRMED", note: "y" }]))).toBe(true));
  it("허용되지 않은 호스트", () =>
    expect(
      rejects((r) => {
        r.services[0].baseUrl = "https://evil.example.com/B010003/OnbidRlstListSrvc2";
        r.services[0].operations.forEach((o) => (o.url = `${r.services[0].baseUrl}/${o.path}`));
      }),
    ).toBe(true));
  it("http(암호화 없음) 주소", () => expect(rejects((r) => (r.services[0].operations[0].url = r.services[0].operations[0].url.replace("https", "http")))).toBe(true));
  it("호출 주소가 서비스 주소 + 경로와 다름", () => expect(rejects((r) => (r.services[0].operations[0].path = "otherPath"))).toBe(true));
  it("GET이 아닌 방식", () => expect(rejects((r) => ((r.services[0].operations[0] as { method: string }).method = "POST"))).toBe(true));
  it("실호출 확인인데 확인 날짜가 없음", () => expect(rejects((r) => (r.services[0].operations[0].verification.verifiedAt = null))).toBe(true));
  it("승인을 확인하지 못했는데 점검 방식이 채워져 있음 (지어낸 값)", () =>
    expect(rejects((r) => { r.services[1].operations[0].approval = "UNCONFIRMED"; r.services[1].operations[0].quota = null as never; r.services[1].operations[0].probe.mode = "positive" as never; })).toBe(true));
  it("승인을 확인하지 못했는데 쿼터가 채워져 있음", () =>
    expect(rejects((r) => { r.services[1].operations[0].approval = "UNCONFIRMED"; r.services[1].operations[0].quota = { dailyLimit: 1000, source: "추정" } as never; })).toBe(true));
  it("점검 입력에 알 수 없는 자리표시자가 있음", () =>
    expect(rejects((r) => (r.services.find((s) => s.serviceId === "SVC-API-026")!.operations[0].probe.input = { inqPerd: "{NEXT_WEEK}" }))).toBe(true));
  it("점검 입력이 있는데 근거가 없음 (지어낸 값)", () =>
    expect(rejects((r) => { const p = r.services.find((s) => s.serviceId === "SVC-API-026")!.operations[0].probe; p.inputSource = null as never; })).toBe(true));
  it("명세만 확인한 오퍼레이션에 점검 입력도 점검 전 상태도 없음 (점검 입력을 비운 첫 오퍼레이션)", () =>
    expect(rejects((r) => { const o = r.services.flatMap((x) => x.operations).find((y) => y.verification.state === "SPEC_ONLY")!; o.probe = { mode: null, input: null, inputSource: null } as never; o.availabilityBeforeProbe = null; })).toBe(true));
  it("입력값 출처 후보가 등록부에 없음", () => expect(rejects((r) => (r.services[3].operations[0].inputSourceCandidates = ["SVC-API-999/nothing"]))).toBe(true));
  it("자기 자신이 입력값 출처 후보", () => expect(rejects((r) => (r.services[3].operations[0].inputSourceCandidates = ["SVC-API-004/getRlstDtlInf"]))).toBe(true));
  it("오퍼레이션 ID 중복", () => expect(rejects((r) => r.services[0].operations.push(structuredClone(r.services[0].operations[0])))).toBe(true));
  it("결과코드표가 비어 있음", () => expect(rejects((r) => (r.common.resultCodes = []))).toBe(true));
});

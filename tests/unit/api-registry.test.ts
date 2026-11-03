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
  it("관리 목표 26종 중 25종을 등록했고 1종은 미확정이다", () => {
    expect(registryCoverage()).toEqual({ target: 26, registered: 25, unconfirmed: 1, operations: 28, liveVerifiedOperations: 2 });
    expect(API_REGISTRY.unresolved).toHaveLength(1);
    expect(API_REGISTRY.unresolved[0].note).toContain("16번");
    expect(API_REGISTRY.unresolved[0].note).toContain("008");
  });

  it("실호출로 확인한 오퍼레이션은 부동산 물건목록·상세 2개뿐이다", () => {
    expect(liveVerifiedOperations().map((o) => o.key)).toEqual(["SVC-API-001/getRlstCltrList", "SVC-API-004/getRlstDtlInf"]);
  });

  it("나머지 26개 오퍼레이션은 명세만 확인했고, 승인·쿼터는 사용자가 확인했지만(2026-11-03) 점검 입력은 정하지 않아 점검 전 상태가 UNVERIFIED:NO_VALID_INPUT이다", () => {
    const others = allOperations().filter((o) => o.operation.verification.state === "SPEC_ONLY");
    expect(others).toHaveLength(26);
    for (const { operation, key } of others) {
      expect(operation.availabilityBeforeProbe, key).toBe("UNVERIFIED:NO_VALID_INPUT");
      expect(operation.approval, key).toBe("APPROVED");
      expect(operation.probe, key).toEqual({ mode: null, input: null, inputSource: null }); // 점검 방식·입력값은 근거가 생기기 전에 만들지 않는다
      expect(operation.noDataPolicy, key).toBe("UNDEFINED");
    }
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
  it("확정 서비스 수가 실제 등록 수와 다름", () => expect(rejects((r) => (r.confirmedServices = 26))).toBe(true));
  it("목표 수 ≠ 확정 + 미확정", () => expect(rejects((r) => (r.targetServices = 27))).toBe(true));
  it("미확정 슬롯 설명이 없음", () => expect(rejects((r) => (r.unresolved = []))).toBe(true));
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
  it("명세만 확인한 오퍼레이션에 점검 전 상태가 없음", () => expect(rejects((r) => (r.services[1].operations[0].availabilityBeforeProbe = null))).toBe(true));
  it("승인을 확인하지 못했는데 점검 방식이 채워져 있음 (지어낸 값)", () =>
    expect(rejects((r) => { r.services[1].operations[0].approval = "UNCONFIRMED"; r.services[1].operations[0].quota = null as never; r.services[1].operations[0].probe.mode = "positive" as never; })).toBe(true));
  it("승인을 확인하지 못했는데 쿼터가 채워져 있음", () =>
    expect(rejects((r) => { r.services[1].operations[0].approval = "UNCONFIRMED"; r.services[1].operations[0].quota = { dailyLimit: 1000, source: "추정" } as never; })).toBe(true));
  it("입력값 출처 후보가 등록부에 없음", () => expect(rejects((r) => (r.services[3].operations[0].inputSourceCandidates = ["SVC-API-999/nothing"]))).toBe(true));
  it("자기 자신이 입력값 출처 후보", () => expect(rejects((r) => (r.services[3].operations[0].inputSourceCandidates = ["SVC-API-004/getRlstDtlInf"]))).toBe(true));
  it("오퍼레이션 ID 중복", () => expect(rejects((r) => r.services[0].operations.push(structuredClone(r.services[0].operations[0])))).toBe(true));
  it("결과코드표가 비어 있음", () => expect(rejects((r) => (r.common.resultCodes = []))).toBe(true));
});

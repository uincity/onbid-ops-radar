// 온비드 OpenAPI 응답 해석 시험 (PLAN 작업 33): 정상 · 데이터없음 · 서비스키·한도 문제 · 일반 오류 · 깨진 응답
import { describe, expect, it } from "vitest";
import { AUTH_OR_QUOTA_CODES, parseOnbidBody } from "@/lib/checks/public-response";

const ok = (items: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items, numOfRows: 10, pageNo: 1, totalCount: 2, ...extra } });

describe("정상 응답 (header.resultCode = 00)", () => {
  it("item이 배열이면 그대로 돌려준다", () => {
    const r = parseOnbidBody(ok({ item: [{ cltrMngNo: "A" }, { cltrMngNo: "B" }] }));
    expect(r).toEqual({ kind: "ok", items: [{ cltrMngNo: "A" }, { cltrMngNo: "B" }], totalCount: 2 });
  });

  it("item이 한 건이라 객체로 와도 배열로 바꿔 준다", () => {
    expect(parseOnbidBody(ok({ item: { cltrMngNo: "A" } }))).toMatchObject({ kind: "ok", items: [{ cltrMngNo: "A" }] });
  });

  it("정상 코드인데 항목이 없으면 데이터없음으로 본다 (빈 문자열 items, 빈 배열 모두)", () => {
    expect(parseOnbidBody(ok(""))).toEqual({ kind: "nodata" });
    expect(parseOnbidBody(ok({ item: [] }))).toEqual({ kind: "nodata" });
    expect(parseOnbidBody(ok(undefined))).toEqual({ kind: "nodata" });
  });

  it("객체가 아닌 항목은 버린다", () => {
    expect(parseOnbidBody(ok({ item: [{ a: 1 }, "x", null] }))).toMatchObject({ kind: "ok", items: [{ a: 1 }] });
  });

  it("totalCount가 문자열 숫자여도 읽는다", () => {
    expect(parseOnbidBody(ok({ item: [{ a: 1 }] }, { totalCount: "7" }))).toMatchObject({ totalCount: 7 });
  });
});

describe("result 모양의 응답 (데이터없음 · 오류)", () => {
  const result = (code: string) => JSON.stringify({ result: { resultCode: code, resultMsg: "x" } });

  it("03 NODATA_ERROR는 데이터없음", () => {
    expect(parseOnbidBody(result("03"))).toEqual({ kind: "nodata" });
  });

  it.each([...AUTH_OR_QUOTA_CODES])("서비스키·한도 문제 코드 %s는 일반 실패와 구분한다", (code) => {
    expect(parseOnbidBody(result(code))).toEqual({ kind: "auth_or_quota", code });
  });

  it.each(["01", "02", "04", "05", "10", "11", "12", "99"])("그 밖의 오류 코드 %s는 일반 실패", (code) => {
    expect(parseOnbidBody(result(code))).toEqual({ kind: "error", code });
  });

  it("header 모양으로 온 오류 코드도 같게 처리한다", () => {
    expect(parseOnbidBody(JSON.stringify({ header: { resultCode: "22", resultMsg: "LIMITED" } }))).toEqual({ kind: "auth_or_quota", code: "22" });
  });

  it("서비스키·한도 문제로 구분되는 코드는 20·21·22·30·31·32·33 일곱 개다", () => {
    expect([...AUTH_OR_QUOTA_CODES].sort()).toEqual(["20", "21", "22", "30", "31", "32", "33"]);
  });
});

describe("공공데이터포털 관문의 XML 오류", () => {
  const xml = (code: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

  it("등록되지 않은 서비스키(30)·한도 초과(22)는 서비스키·한도 문제", () => {
    expect(parseOnbidBody(xml("30"))).toEqual({ kind: "auth_or_quota", code: "30" });
    expect(parseOnbidBody(xml("22"))).toEqual({ kind: "auth_or_quota", code: "22" });
  });

  it("코드를 찾을 수 없는 XML은 일반 오류", () => {
    expect(parseOnbidBody("<html>gateway</html>")).toEqual({ kind: "error", code: "XML" });
  });
});

describe("깨진 응답", () => {
  it.each([
    ["JSON이 아님", "not json"],
    ["빈 응답", ""],
    ["배열", "[]"],
    ["결과 코드 없음", "{}"],
  ])("%s는 일반 오류이며 예외를 던지지 않는다", (_label, body) => {
    expect(parseOnbidBody(body).kind).toBe("error");
  });
});

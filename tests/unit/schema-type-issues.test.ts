// 자료형 경고 상세(typeIssues) — 어느 항목이 명세와 어떻게 달랐는지 모양만 기록하고 값 원문은 남기지 않는다
import { describe, expect, it } from "vitest";
import { checkResponseSchema, describeShape, mergeSchemaChecks } from "@/lib/checks/probe/schema-check";
import { detectSchemaIssue } from "@/lib/rules/dq-rules";
import { buildSchemaEvidence } from "@/lib/checks/dq-evidence";

const fields = [
  { name: "pbctNo", type: "NUMBER(22)", required: true },
  { name: "onbidCltrNm", type: "VARCHAR(1000)", required: false },
  { name: "bidList", type: "Array", required: false },
];

describe("describeShape", () => {
  it("값 원문 없이 모양만 돌려준다", () => {
    expect(describeShape("홍길동")).toBe("string(길이 3)");
    expect(describeShape([1, 2])).toBe("array(길이 2)");
    expect(describeShape({ a: 1 })).toBe("object");
    expect(describeShape(true)).toBe("boolean");
  });
});

describe("checkResponseSchema typeIssues", () => {
  it("문제 없으면 비어 있다 (한 칸 안)", () => {
    const r = checkResponseSchema([{ pbctNo: "123", onbidCltrNm: "물건", bidList: [] }], fields);
    expect(r.warnings).toBe(0);
    expect(r.typeIssues).toEqual([]);
  });
  it("숫자 항목에 숫자 아닌 문자가 오면 항목·명세·모양을 남기고 원문은 남기지 않는다 (한 칸 밖)", () => {
    const r = checkResponseSchema([{ pbctNo: "abc-비밀", onbidCltrNm: "물건" }], fields);
    expect(r.warnings).toBe(1);
    expect(r.typeIssues).toEqual([{ field: "pbctNo", expected: "NUMBER(22)", actual: "string(길이 6)", count: 1 }]);
    expect(JSON.stringify(r.typeIssues)).not.toContain("비밀");
  });
  it("같은 항목·같은 모양은 건수로 묶는다", () => {
    const r = checkResponseSchema([{ pbctNo: "x" }, { pbctNo: "y" }], fields);
    expect(r.typeIssues).toEqual([{ field: "pbctNo", expected: "NUMBER(22)", actual: "string(길이 1)", count: 2 }]);
  });
  it("문자 항목에 객체가 오고 배열 항목에 문자가 오는 경우", () => {
    const r = checkResponseSchema([{ onbidCltrNm: { a: 1 }, bidList: "x" }], fields);
    expect(r.typeIssues?.map((t) => `${t.field}:${t.actual}`).sort()).toEqual(["bidList:string(길이 1)", "onbidCltrNm:object"]);
  });
  it("여러 호출 결과를 합칠 때 상세도 합쳐진다", () => {
    const a = checkResponseSchema([{ pbctNo: "x" }], fields);
    const b = checkResponseSchema([{ pbctNo: "y" }], fields);
    expect(mergeSchemaChecks([a, b])?.typeIssues).toEqual([{ field: "pbctNo", expected: "NUMBER(22)", actual: "string(길이 1)", count: 2 }]);
  });
});

describe("이상징후 근거", () => {
  it("근거에 상세가 들어가고 지문(valueHash)은 상세와 무관하게 같다", () => {
    const withDetail = detectSchemaIssue(checkResponseSchema([{ pbctNo: "x" }], fields))!;
    const ev = buildSchemaEvidence("SVC-API-007", "getCltrBidInf", withDetail);
    expect(ev.evidence).toMatchObject({ typeWarnings: 1, typeIssues: [{ field: "pbctNo" }] });
    const noDetail = { ...withDetail, typeIssues: [] };
    expect(buildSchemaEvidence("SVC-API-007", "getCltrBidInf", noDetail).valueHash).toBe(ev.valueHash);
  });
});

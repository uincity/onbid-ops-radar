// 데이터 품질 규칙 DQ_SCHEMA·DQ_LIST_DETAIL_REF·DQ_CROSS_API_REF 판정 시험 (PRD 5-2A) — 정상·이상·판정 보류, 경계 포함
import { describe, expect, it } from "vitest";
import { buildCrossApiEvidence, buildListDetailRefEvidence, buildSchemaEvidence } from "@/lib/checks/dq-evidence";
import { detectCrossApiRef, detectListDetailRef, detectSchemaIssue } from "@/lib/rules/dq-rules";
import type { SchemaCheckResult } from "@/lib/checks/probe/schema-check";

const schema = (over: Partial<SchemaCheckResult> = {}): SchemaCheckResult => ({ checked: true, ok: true, inspected: 5, problems: [], warnings: 0, ...over });
const missing = (field: string, count: number) => ({ code: "MISSING_REQUIRED_FIELD" as const, field, count });

describe("detectSchemaIssue (DQ_SCHEMA)", () => {
  it("정상 응답은 이상 없음", () => expect(detectSchemaIssue(schema())).toBeNull());
  it("검사한 항목이 없으면(호출 실패·0건) 판정하지 않는다", () => {
    expect(detectSchemaIssue(schema({ checked: false, inspected: 0 }))).toBeNull();
    expect(detectSchemaIssue(null)).toBeNull();
    expect(detectSchemaIssue(undefined)).toBeNull();
  });
  it("필수 항목 누락은 의심 (한 칸 밖: 1건 누락)", () => {
    const issue = detectSchemaIssue(schema({ ok: false, problems: [missing("pbctNo", 1)] }));
    expect(issue).toEqual({ missing: [{ field: "pbctNo", count: 1 }], typeWarnings: 0, inspected: 5 });
  });
  it("자료형 경고만 있어도 의심 (한 칸 밖: 경고 1건)", () => {
    expect(detectSchemaIssue(schema({ warnings: 1 }))?.typeWarnings).toBe(1);
  });
  it("누락 항목은 이름순으로 정렬된다", () => {
    const issue = detectSchemaIssue(schema({ ok: false, problems: [missing("z", 1), missing("a", 2)] }));
    expect(issue?.missing.map((m) => m.field)).toEqual(["a", "z"]);
  });
});

describe("detectListDetailRef (DQ_LIST_DETAIL_REF)", () => {
  const list = { cltrMngNo: "A-1", pbctCdtnNo: "100" };
  it("식별값이 같으면 이상 없음 (숫자·문자 모양 차이와 앞뒤 공백은 무시)", () => {
    expect(detectListDetailRef(list, { cltrMngNo: " A-1 ", pbctCdtnNo: 100 })).toEqual([]);
  });
  it("물건관리번호가 다르면 불일치", () => {
    expect(detectListDetailRef(list, { cltrMngNo: "A-2", pbctCdtnNo: "100" })).toEqual([{ field: "cltrMngNo", list: "A-1", detail: "A-2" }]);
  });
  it("공매조건번호가 다르면 불일치, 둘 다 다르면 둘 다", () => {
    expect(detectListDetailRef(list, { cltrMngNo: "A-1", pbctCdtnNo: "101" })).toHaveLength(1);
    expect(detectListDetailRef(list, { cltrMngNo: "B", pbctCdtnNo: "101" })).toHaveLength(2);
  });
  it("한쪽이 비어 있거나 상세가 없으면 판정하지 않는다 (비어 있음은 DQ_REQUIRED, 상세 없음은 보류)", () => {
    expect(detectListDetailRef(list, { cltrMngNo: "", pbctCdtnNo: undefined })).toEqual([]);
    expect(detectListDetailRef(list, null)).toEqual([]);
    expect(detectListDetailRef(null, list)).toEqual([]);
  });
});

describe("detectCrossApiRef (DQ_CROSS_API_REF)", () => {
  const parents = new Set(["P1", "P2"]);
  it("부모 기준이 없으면 적용 제외", () => {
    expect(detectCrossApiRef(new Set(), [{ childKey: "c", parentKey: "P1" }])).toEqual({ outcome: "NOT_APPLICABLE", reason: "NO_PARENT_BASIS" });
  });
  it("자식이 없거나 부모를 가리키지 않으면 적용 제외 (모든 부모에 자식을 요구하지 않는다)", () => {
    expect(detectCrossApiRef(parents, [])).toEqual({ outcome: "NOT_APPLICABLE", reason: "NO_CHILD" });
    expect(detectCrossApiRef(parents, [{ childKey: "c", parentKey: " " }])).toEqual({ outcome: "NOT_APPLICABLE", reason: "NO_CHILD" });
  });
  it("자식이 가리키는 부모가 모두 있으면 이상 없음, 하나라도 없으면 그 자식만 의심", () => {
    expect(detectCrossApiRef(parents, [{ childKey: "c1", parentKey: "P1" }])).toEqual({ outcome: "checked", orphans: [] });
    expect(detectCrossApiRef(parents, [{ childKey: "c1", parentKey: "P1" }, { childKey: "c2", parentKey: "P9" }])).toEqual({ outcome: "checked", orphans: [{ childKey: "c2", parentKey: "P9" }] });
  });
});

describe("DQ 근거·지문", () => {
  it("같은 상황이면 같은 지문, 빠진 항목이 달라지면 다른 지문 (검사 건수는 지문에 넣지 않는다)", () => {
    const a = buildSchemaEvidence("SVC-API-001", "getRlstCltrList", { missing: [{ field: "x", count: 1 }], typeWarnings: 0, inspected: 5 });
    const b = buildSchemaEvidence("SVC-API-001", "getRlstCltrList", { missing: [{ field: "x", count: 4 }], typeWarnings: 0, inspected: 20 });
    const c = buildSchemaEvidence("SVC-API-001", "getRlstCltrList", { missing: [{ field: "y", count: 1 }], typeWarnings: 0, inspected: 5 });
    expect(a.valueHash).toBe(b.valueHash);
    expect(a.valueHash).not.toBe(c.valueHash);
    expect(a.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.evidence.note).toContain("의심");
  });
  it("참조 불일치·교차 참조 지문은 값이 같으면 같고 다르면 다르다", () => {
    const m = [{ field: "cltrMngNo" as const, list: "A", detail: "B" }];
    expect(buildListDetailRefEvidence("A", m).valueHash).toBe(buildListDetailRefEvidence("A", m).valueHash);
    expect(buildListDetailRefEvidence("A", m).valueHash).not.toBe(buildListDetailRefEvidence("A", [{ ...m[0], detail: "C" }]).valueHash);
    expect(buildCrossApiEvidence("c", "p").valueHash).not.toBe(buildCrossApiEvidence("c", "q").valueHash);
  });
});

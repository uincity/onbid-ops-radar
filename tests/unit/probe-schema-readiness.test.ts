// 응답 구조 확인(schema-check)과 점검 준비 상태(readiness) 시험 (R02)
import { describe, expect, it } from "vitest";
import { CONDITIONALLY_ABSENT_FIELDS, checkResponseSchema, mergeSchemaChecks } from "@/lib/checks/probe/schema-check";
import { checkReadiness, needsIdInput } from "@/lib/checks/probe/readiness";
import { allOperations, findOperation } from "@/lib/registry";

const listOp = findOperation("SVC-API-001/getRlstCltrList")!.operation;
const detailOp = findOperation("SVC-API-004/getRlstDtlInf")!.operation;

// 등록부(명세)가 필수로 적은 항목을 모두 채운 정상 응답 항목
function fullItem(op: typeof listOp, over: Record<string, unknown> = {}): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const f of op.responseFields) if (f.required) item[f.name] = f.type.toUpperCase().startsWith("NUMBER") ? 1 : "x";
  return { ...item, ...over };
}

describe("응답 구조 확인 (필수 응답 항목·자료형)", () => {
  it("명세의 필수 항목이 모두 있으면 ok (선택 항목이 없거나 늘어나도 정상)", () => {
    const r = checkResponseSchema([fullItem(listOp), fullItem(listOp, { someNewField: "추가된 선택 필드" })], listOp.responseFields);
    expect(r).toEqual({ checked: true, ok: true, inspected: 2, problems: [], warnings: 0 });
  });

  it("필수 항목이 빠지면 ok가 아니고, 어느 항목이 몇 건에서 빠졌는지 알려 준다", () => {
    const a = fullItem(listOp);
    const b = fullItem(listOp);
    delete a.pbctNo;
    delete b.pbctNo;
    delete b.cltrMngNo;
    const r = checkResponseSchema([a, b, fullItem(listOp)], listOp.responseFields);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([{ code: "MISSING_REQUIRED_FIELD", field: "pbctNo", count: 2 }, { code: "MISSING_REQUIRED_FIELD", field: "cltrMngNo", count: 1 }]));
  });

  it("필수 항목 값이 null·빈 문자열이어도 '항목은 있다'고 본다 (값이 비어 있는 것은 구조 문제가 아니다)", () => {
    expect(checkResponseSchema([fullItem(listOp, { pbctNo: null, pbctNsq: "" })], listOp.responseFields).ok).toBe(true);
  });

  it("명세 문구로 '없을 수 있다'고 확인된 항목(pbctsn)은 필수로 가정하지 않는다", () => {
    expect(Object.keys(CONDITIONALLY_ABSENT_FIELDS)).toEqual(["pbctsn"]);
    const item = fullItem(listOp);
    delete item.pbctsn;
    expect(listOp.responseFields.find((f) => f.name === "pbctsn")?.required).toBe(true); // 명세상은 필수(1)
    expect(checkResponseSchema([item], listOp.responseFields).ok).toBe(true);
  });

  it("자료형이 어긋나면 ok는 유지하되 경고를 센다: 숫자 항목에 글자, 문자 항목에 객체", () => {
    const r = checkResponseSchema([fullItem(listOp, { pbctNo: "숫자아님", onbidCltrNm: { nested: 1 } })], listOp.responseFields);
    expect(r.ok).toBe(true);
    expect(r.warnings).toBe(2);
  });

  it("숫자 항목에 숫자 모양의 문자열이 와도 정상이다", () => {
    expect(checkResponseSchema([fullItem(listOp, { pbctNo: "9992357", apslEvlAmt: "700000000000" })], listOp.responseFields)).toMatchObject({ ok: true, warnings: 0 });
  });

  it("배열 항목에 배열이 아닌 값이 오면 경고 (상세의 사진 목록 등)", () => {
    expect(checkResponseSchema([fullItem(detailOp, { potoUrlList: "배열이 아님" })], detailOp.responseFields).warnings).toBe(1);
    expect(checkResponseSchema([fullItem(detailOp, { potoUrlList: [{ urlAdr: "x" }] })], detailOp.responseFields).warnings).toBe(0);
  });

  it("앞쪽 20건만 검사한다 (21번째부터 문제가 있어도 보지 않는다)", () => {
    const items = Array.from({ length: 25 }, (_, i) => (i >= 20 ? fullItem(listOp, { cltrMngNo: undefined }) : fullItem(listOp)));
    const r = checkResponseSchema(items, listOp.responseFields);
    expect(r.inspected).toBe(20);
    expect(r.ok).toBe(true);
    // 경계: 20번째(인덱스 19)는 검사한다
    const edge = Array.from({ length: 20 }, (_, i) => (i === 19 ? fullItem(listOp, { cltrMngNo: undefined }) : fullItem(listOp)));
    expect(checkResponseSchema(edge, listOp.responseFields).ok).toBe(false);
  });

  it("검사할 항목이나 기준이 없으면 checked=false (구조 오류로 단정하지 않는다)", () => {
    expect(checkResponseSchema([], listOp.responseFields)).toMatchObject({ checked: false, ok: true });
    expect(checkResponseSchema([fullItem(listOp)], [])).toMatchObject({ checked: false, ok: true });
  });

  it("여러 번 호출한 결과를 합친다: 하나라도 필수 항목이 빠졌으면 ok가 아니고, 검사 못 한 것은 무시한다", () => {
    const good = checkResponseSchema([fullItem(detailOp)], detailOp.responseFields);
    const badItem = fullItem(detailOp);
    delete badItem.onbidCltrno;
    const bad = checkResponseSchema([badItem], detailOp.responseFields);
    expect(mergeSchemaChecks([good, bad, null, undefined])).toMatchObject({ checked: true, ok: false, inspected: 2, problems: [{ field: "onbidCltrno", count: 1 }] });
    expect(mergeSchemaChecks([good, good])).toMatchObject({ ok: true, inspected: 2 });
    expect(mergeSchemaChecks([null, undefined])).toBeNull();
  });
});

describe("점검 준비 상태 (점검할 수 없는 이유는 장애가 아니라 UNVERIFIED)", () => {
  const op = (needsId: boolean, approval: "UNCONFIRMED" | "APPROVED" | "NOT_APPROVED" | "CONFIRMED_BY_USER_2026_10_29") => ({
    requiredParams: needsId ? [{ name: "cltrMngNo", kr: "", type: "", sample: "" }] : [{ name: "statsTypeCd", kr: "", type: "", sample: "" }],
    approval,
  });

  it("선행 점검이 실패했으면 PRECONDITION_FAILED가 가장 먼저다", () => {
    expect(checkReadiness(op(true, "UNCONFIRMED"), { hasValidInput: false, precedingFailed: true })).toBe("PRECONDITION_FAILED");
  });

  it("식별 번호가 필요한데 입력값이 없으면 NO_VALID_INPUT (승인 확인 전에도 이 이유가 앞선다)", () => {
    expect(checkReadiness(op(true, "UNCONFIRMED"), { hasValidInput: false })).toBe("NO_VALID_INPUT");
    expect(checkReadiness(op(true, "APPROVED"), { hasValidInput: false })).toBe("NO_VALID_INPUT");
  });

  it("입력값이 있어도 승인이 확인되지 않았으면 APPROVAL_UNCONFIRMED, 미승인이면 NOT_APPROVED", () => {
    expect(checkReadiness(op(true, "UNCONFIRMED"), { hasValidInput: true })).toBe("APPROVAL_UNCONFIRMED");
    expect(checkReadiness(op(true, "NOT_APPROVED"), { hasValidInput: true })).toBe("NOT_APPROVED");
  });

  it("식별 번호가 필요 없는 오퍼레이션은 입력값 유무와 관계없이 승인만 본다", () => {
    expect(needsIdInput(op(false, "UNCONFIRMED"))).toBe(false);
    expect(checkReadiness(op(false, "UNCONFIRMED"), { hasValidInput: false })).toBe("APPROVAL_UNCONFIRMED");
    expect(checkReadiness(op(false, "APPROVED"), { hasValidInput: false })).toBeNull();
  });

  it("승인되었고 입력값도 있으면 점검할 수 있다 (null)", () => {
    expect(checkReadiness(op(true, "CONFIRMED_BY_USER_2026_10_29"), { hasValidInput: true })).toBeNull();
    expect(checkReadiness(op(true, "APPROVED"), { hasValidInput: true })).toBeNull();
  });

  it("등록부 28개 오퍼레이션 모두: 점검 전 판정이 등록부의 availabilityBeforeProbe와 같다 (R01과 R02가 어긋나지 않음)", () => {
    for (const { operation, key } of allOperations()) {
      const reason = checkReadiness(operation, { hasValidInput: false });
      if (operation.verification.state === "SPEC_ONLY") {
        if (operation.probe.input !== null) {
          // 점검 입력이 정해진 것은 점검 대기: 승인·식별값 면에서 막힌 이유가 없고 점검 전 상태는 비어 있다
          expect(reason, key).toBeNull();
          expect(operation.availabilityBeforeProbe, key).toBeNull();
        } else {
          // 승인되고 식별값도 필요 없는데 점검 입력을 정하지 않은 오퍼레이션은 readiness가 통과(null)시키지만, 등록부는 NO_VALID_INPUT(점검 입력 미정)으로 둔다
          expect(`UNVERIFIED:${reason ?? "NO_VALID_INPUT"}`, key).toBe(operation.availabilityBeforeProbe);
        }
      } else {
        // 실호출 확인이 끝난 오퍼레이션: 입력값만 있으면 점검할 수 있다
        expect(checkReadiness(operation, { hasValidInput: true }), key).toBeNull();
      }
    }
  });
});

// Design Ref: PRD 5-2A(DQ_CROSS_API_REF), C-1 — "공식적으로 연결 가능한 API 관계"에만 쓰는 교차 참조 관계 목록
// 관계는 서비스 명세(등록부)로 확인되는 것만 넣는다. 모든 목록에 상대 API 결과를 요구하지 않고, 명세가 연결해 둔 식별키만 따라간다.
// 순수 함수다. 네트워크·DB를 모른다.
import { findOperation, API_REGISTRY, type ApiRegistry } from "@/lib/registry";

export type CrossApiRelation = {
  parentKey: string; // 식별키를 내주는 쪽 ("서비스ID/오퍼레이션ID")
  childKey: string; // 그 식별키로 부르는 쪽
  fields: readonly string[]; // 부모 응답 항목 이름 = 자식 필수 입력 이름 (자식 응답에도 있다). 첫 번째가 교차 참조 비교에 쓰는 대표 식별키
  // 부모 목록의 "일부 물건"에만 자식이 있는 관계(예: 동산 목록 중 용도가 유가증권인 물건만 유가증권 상세가 있다). 있으면 자식을 점검할 때 부모 목록을
  // 이 조건(params)으로 한 번 더 조회해, 응답 항목 matchField가 matchValue인 물건의 식별키로 자식을 부른다. 부모의 기본 점검 응답은 쓰지 않는다
  parentLookup?: { params: Readonly<Record<string, string>>; matchField: string; matchValue: string };
};

// 명세(등록부)가 "이 목록의 식별키로 부른다"고 연결해 둔 부모 → 자식 관계. 자식의 필수 입력은 아래 항목뿐이고, 부모는 자식의 inputSourceCandidates에 들어 있다.
// 자식은 등록부 순서상 부모보다 뒤에 있어야 한다(엔진이 등록부 순서로 부르므로). 시험이 이를 확인한다.
export const CROSS_API_RELATIONS: readonly CrossApiRelation[] = [
  // 공고 목록(015)의 pbancMngNo → 공고 상세·입찰·물건·입찰결과 상세
  { parentKey: "SVC-API-015/getPbancList", childKey: "SVC-API-016/getPbancDtlInf", fields: ["pbancMngNo"] },
  { parentKey: "SVC-API-015/getPbancList", childKey: "SVC-API-017/getPbancBidInf", fields: ["pbancMngNo"] },
  { parentKey: "SVC-API-015/getPbancList", childKey: "SVC-API-018/getPbancCltrInf", fields: ["pbancMngNo"] },
  { parentKey: "SVC-API-015/getPbancList", childKey: "SVC-API-020/getPbancBidRsltDtl", fields: ["pbancMngNo"] },
  // 동산·자동차·입찰결과 목록의 cltrMngNo(+공매조건번호) → 각 상세
  { parentKey: "SVC-API-002/getMvastCltrList", childKey: "SVC-API-005/getMvastDtlInf", fields: ["cltrMngNo"] },
  { parentKey: "SVC-API-003/getCarCltrList", childKey: "SVC-API-006/getCarDtlInf", fields: ["cltrMngNo"] },
  { parentKey: "SVC-API-002/getMvastCltrList", childKey: "SVC-API-007/getCltrBidInf", fields: ["cltrMngNo", "pbctCdtnNo"] },
  { parentKey: "SVC-API-013/getCltrBidRsltList", childKey: "SVC-API-014/getCltrBidRsltDtl", fields: ["cltrMngNo"] },
  // 동산 목록(002) 중 용도 중분류가 유가증권(11200)인 물건의 cltrMngNo → 유가증권 상세정보(009). 사용자 확인(2026-11-04)과 실호출(002를 cltrUsgMclsCtgrId=11200으로 조회 →
  // 그 cltrMngNo로 009 조회, 코드 00·1건·식별키 일치)로 확인했다. 용도 중분류 11200은 사용자 수집 코드의 용도코드표(onbid_usage_codes_structured.json)의 '유가증권'이다
  {
    parentKey: "SVC-API-002/getMvastCltrList",
    childKey: "SVC-API-009/getSctDtlInf",
    fields: ["cltrMngNo"],
    parentLookup: { params: { cltrUsgMclsCtgrId: "11200" }, matchField: "cltrUsgMclsCtgrId", matchValue: "11200" },
  },
];

// 식별키 값으로 쓸 수 있는 모양 (요청 주소에 그대로 넣으므로 이상한 글자는 거른다)
export const LINK_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,60}$/;

// 관계가 등록부(명세)와 맞는지 확인한다. 맞지 않는 항목을 알려 주며, 빈 목록이면 이상 없음
export function relationProblems(relation: CrossApiRelation, registry: ApiRegistry = API_REGISTRY): string[] {
  const problems: string[] = [];
  const parent = findOperation(relation.parentKey, registry)?.operation;
  const child = findOperation(relation.childKey, registry)?.operation;
  if (!parent) problems.push(`부모 오퍼레이션이 등록부에 없습니다: ${relation.parentKey}`);
  if (!child) problems.push(`자식 오퍼레이션이 등록부에 없습니다: ${relation.childKey}`);
  if (!parent || !child) return problems;
  for (const field of relation.fields) {
    if (!parent.responseFields.some((f) => f.name === field)) problems.push(`부모 응답에 ${field} 항목이 없습니다.`);
    if (!child.responseFields.some((f) => f.name === field)) problems.push(`자식 응답에 ${field} 항목이 없습니다.`);
  }
  if (relation.parentLookup) {
    if (!parent.responseFields.some((f) => f.name === relation.parentLookup!.matchField)) problems.push(`부모 응답에 ${relation.parentLookup.matchField} 항목이 없습니다.`);
    if (parent.probe.input === null) problems.push("부모 오퍼레이션의 점검 입력이 없어 부모 조회를 만들 수 없습니다.");
  }
  const required = child.requiredParams.map((p) => p.name).sort().join(",");
  if (required !== [...relation.fields].sort().join(",")) problems.push(`자식의 필수 입력(${required})이 관계의 항목(${relation.fields.join(",")})과 다릅니다.`);
  if (!child.inputSourceCandidates.includes(relation.parentKey)) problems.push("명세가 부모를 자식의 입력값 출처로 연결하고 있지 않습니다.");
  return problems;
}

// 등록부와 맞는 관계만 돌려준다
export const validCrossApiRelations = (registry: ApiRegistry = API_REGISTRY): CrossApiRelation[] => CROSS_API_RELATIONS.filter((r) => relationProblems(r, registry).length === 0);

// 부모 응답에서 뽑아 둔 식별키로 자식의 입력값을 만든다. 필요한 항목이 하나라도 없거나 쓸 수 없는 모양이면 undefined (자식을 부르지 않는다)
export function inputsFromParent(relation: CrossApiRelation, parentValues: Readonly<Record<string, string[]>> | undefined): Record<string, string> | undefined {
  const inputs: Record<string, string> = {};
  for (const field of relation.fields) {
    const value = parentValues?.[field]?.find((v) => LINK_VALUE_PATTERN.test(v));
    if (value === undefined) return undefined;
    inputs[field] = value;
  }
  return inputs;
}

// Design Ref: PRD 5-2A(DQ_CROSS_API_REF), C-1 — "공식적으로 연결 가능한 API 관계"에만 쓰는 교차 참조 관계 목록
// 관계는 서비스 명세(등록부)로 확인되는 것만 넣는다. 모든 목록에 상대 API 결과를 요구하지 않고, 명세가 연결해 둔 식별키만 따라간다.
// 순수 함수다. 네트워크·DB를 모른다.
import { findOperation, API_REGISTRY, type ApiRegistry } from "@/lib/registry";

export type CrossApiRelation = {
  parentKey: string; // 식별키를 내주는 쪽 ("서비스ID/오퍼레이션ID")
  childKey: string; // 그 식별키로 부르는 쪽
  field: string; // 부모 응답 항목 이름 = 자식 필수 입력 이름 = 자식 응답 항목 이름
};

// 공고 목록(015)의 pbancMngNo → 공고 상세(016)의 필수 입력 pbancMngNo (등록부 016의 inputSourceCandidates와 dependencyNote)
export const CROSS_API_RELATIONS: readonly CrossApiRelation[] = [{ parentKey: "SVC-API-015/getPbancList", childKey: "SVC-API-016/getPbancDtlInf", field: "pbancMngNo" }];

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
  if (!parent.responseFields.some((f) => f.name === relation.field)) problems.push(`부모 응답에 ${relation.field} 항목이 없습니다.`);
  if (child.requiredParams.length !== 1 || child.requiredParams[0].name !== relation.field) problems.push(`자식의 필수 입력이 ${relation.field} 하나가 아닙니다.`);
  if (!child.responseFields.some((f) => f.name === relation.field)) problems.push(`자식 응답에 ${relation.field} 항목이 없습니다.`);
  if (!child.inputSourceCandidates.includes(relation.parentKey)) problems.push("명세가 부모를 자식의 입력값 출처로 연결하고 있지 않습니다.");
  return problems;
}

// 등록부와 맞는 관계만 돌려준다
export const validCrossApiRelations = (registry: ApiRegistry = API_REGISTRY): CrossApiRelation[] => CROSS_API_RELATIONS.filter((r) => relationProblems(r, registry).length === 0);

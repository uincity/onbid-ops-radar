// Design Ref: PRD 5-2A, 5-2B — DQ_* 이상징후의 근거와 "원본 값 지문" (순수 함수)
// 지문은 규칙이 실제로 보는 값만으로 만든다. 같은 상황이면 같은 지문이라 정상 판정(dismissed) 건과 비교할 수 있다.
import { createHash } from "node:crypto";
import type { RefMismatch, SchemaIssue } from "@/lib/rules/dq-rules";
import type { BuiltEvidence } from "./evidence";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const NOTE = "데이터 품질 의심 건입니다. 담당자가 확인하기 전까지 확정된 오류가 아닙니다.";

// 식별값은 "서비스ID/오퍼레이션ID" (API 상태 이상징후와 같은 방식)
export function buildSchemaEvidence(apiId: string, operationId: string, issue: SchemaIssue): BuiltEvidence {
  const key = `${apiId}/${operationId}`;
  return {
    evidence: { rule: "DQ_SCHEMA", apiId, operationId, missingFields: issue.missing, typeWarnings: issue.typeWarnings, inspected: issue.inspected, note: NOTE },
    // 검사한 건수·빠진 건수는 점검마다 달라지므로 지문에는 "어떤 항목이 빠졌나"와 자료형 경고 유무만 넣는다
    valueHash: sha256(`DQ_SCHEMA|${key}|${issue.missing.map((m) => m.field).join(",")}|${issue.typeWarnings > 0}`),
  };
}

export function buildListDetailRefEvidence(itemKey: string, mismatches: readonly RefMismatch[]): BuiltEvidence {
  return {
    evidence: { rule: "DQ_LIST_DETAIL_REF", mismatches, note: NOTE },
    valueHash: sha256(`DQ_LIST_DETAIL_REF|${itemKey}|${mismatches.map((m) => `${m.field}:${m.list}>${m.detail}`).join(";")}`),
  };
}

export function buildCrossApiEvidence(childKey: string, parentKey: string): BuiltEvidence {
  return { evidence: { rule: "DQ_CROSS_API_REF", childKey, parentKey, note: NOTE }, valueHash: sha256(`DQ_CROSS_API_REF|${childKey}|${parentKey}`) };
}

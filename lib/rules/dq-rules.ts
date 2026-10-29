// Design Ref: PRD 5-2A — 데이터 품질 핵심 규칙 중 새로 만든 3개의 판정 (순수 함수, LLM 없음)
//  - DQ_SCHEMA          : 공식 명세의 필수 응답 항목이 빠졌거나 자료형이 어긋난 응답
//  - DQ_LIST_DETAIL_REF : 목록에서 얻은 식별값으로 상세를 불렀는데 다른 물건·공매조건이 돌아옴 (참조 불일치)
//  - DQ_CROSS_API_REF   : 공식적으로 연결되는 API 사이에서, 자식이 가리키는 부모 식별값이 부모 목록에 없음
// DQ_REQUIRED는 기존 필수정보 판정(detectRequiredField)을 PUBLIC에서 새 이름으로 쓰므로 여기서 다시 만들지 않는다.
// 오탐 통제: 호출 실패·상세 0건·선택 필드 추가·조건부 필드는 판정하지 않는다 (PRD 5-2A 금지 판단).
import type { SchemaCheckResult } from "@/lib/checks/probe/schema-check";

// ── DQ_SCHEMA ──
export type SchemaIssue = { missing: { field: string; count: number }[]; typeWarnings: number; inspected: number };

// 필수 항목이 빠졌거나 자료형 경고가 있으면 의심으로 돌려준다. 검사한 항목이 없으면(호출 실패·0건) 판정하지 않는다.
export function detectSchemaIssue(schema: SchemaCheckResult | null | undefined): SchemaIssue | null {
  if (!schema || !schema.checked) return null;
  if (schema.problems.length === 0 && schema.warnings === 0) return null;
  return {
    missing: schema.problems.map((p) => ({ field: p.field, count: p.count })).sort((a, b) => a.field.localeCompare(b.field)),
    typeWarnings: schema.warnings,
    inspected: schema.inspected,
  };
}

// ── DQ_LIST_DETAIL_REF ──
// 목록과 상세가 "같은 물건·같은 공매조건"을 가리켜야 하는 식별 필드 (부록 A)
export const REF_IDENTITY_FIELDS = ["cltrMngNo", "pbctCdtnNo"] as const;
export type RefMismatch = { field: (typeof REF_IDENTITY_FIELDS)[number]; list: string; detail: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

// 둘 다 값이 있는데 다르면 불일치. 한쪽이 비어 있으면 판정하지 않는다(비어 있음은 DQ_REQUIRED가 본다)
export function detectListDetailRef(list: Record<string, unknown> | null, detail: Record<string, unknown> | null): RefMismatch[] {
  if (!list || !detail) return [];
  const out: RefMismatch[] = [];
  for (const field of REF_IDENTITY_FIELDS) {
    const a = text(list[field]);
    const b = text(detail[field]);
    if (a && b && a !== b) out.push({ field, list: a, detail: b });
  }
  return out;
}

// ── DQ_CROSS_API_REF ──
export type CrossRef = { childKey: string; parentKey: string };
export type CrossApiResult = { outcome: "NOT_APPLICABLE"; reason: "NO_PARENT_BASIS" | "NO_CHILD" } | { outcome: "checked"; orphans: CrossRef[] };

// 부모 목록(기준)이 없거나 자식이 없으면 판정하지 않는다. 모든 부모에 자식이 있어야 한다고 요구하지 않고, 자식이 가리키는 부모만 확인한다.
export function detectCrossApiRef(parentKeys: ReadonlySet<string>, children: readonly CrossRef[]): CrossApiResult {
  if (parentKeys.size === 0) return { outcome: "NOT_APPLICABLE", reason: "NO_PARENT_BASIS" };
  const withParent = children.filter((c) => c.parentKey.trim() !== "");
  if (withParent.length === 0) return { outcome: "NOT_APPLICABLE", reason: "NO_CHILD" };
  return { outcome: "checked", orphans: withParent.filter((c) => !parentKeys.has(c.parentKey)) };
}

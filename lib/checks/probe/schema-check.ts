// Design Ref: PRD 5-2-2 5단계(스키마), 부록 C-1 API_SCHEMA — 응답 항목의 "기본 구조" 확인
// 공식 명세(등록부)의 필수 응답 항목이 실제 응답에 있는지, 자료형이 크게 어긋나지 않는지를 본다. 순수 함수다.
// 데이터 품질 규칙 DQ_SCHEMA(R06)와는 다르다: 여기서는 "점검 요청이 정상 응답을 받았는지"를 판단하는 최소 확인만 한다.
// 오탐을 줄이는 원칙 (PRD 5-2A): 선택 필드가 늘어난 것은 정상, 조건부로 빠질 수 있는 필드를 필수로 가정하지 않는다.
import type { RegistryOperation } from "@/lib/registry/schema";

type FieldSpec = Pick<RegistryOperation["responseFields"][number], "name" | "type" | "required">;

export type SchemaProblem = { code: "MISSING_REQUIRED_FIELD"; field: string; count: number };

export type SchemaCheckResult = {
  checked: boolean; // 검사할 항목이 있었는가
  ok: boolean; // 필수 항목이 모두 있다 (자료형 경고는 ok를 깨지 않는다)
  inspected: number; // 검사한 응답 항목(레코드) 수
  problems: SchemaProblem[]; // 필수 항목이 빠진 경우
  warnings: number; // 자료형이 이상한 값의 수 (DEGRADED 후보)
};

// 명세서의 설명으로 "필수(1)로 적혀 있어도 실제로는 없을 수 있다"고 확인된 항목. 필수로 가정하지 않는다.
// 근거는 항목마다 명세서 문구를 적는다. 근거 없이 추가하지 않는다.
export const CONDITIONALLY_ABSENT_FIELDS: Readonly<Record<string, string>> = {
  pbctsn: "명세: 차수(2026.1.1 이후 확정된 공고는 차수 표시되지 않음)",
};

const MAX_INSPECTED = 20; // 응답이 아무리 커도 앞쪽 레코드만 본다 (가볍게)

const isNumeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

// 항목의 자료형(명세서 표기)과 값이 어긋나는지. 비어 있는 값(null·"")은 자료형 문제로 보지 않는다.
function typeWarning(type: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const t = type.toUpperCase();
  if (t.startsWith("NUMBER")) return !isNumeric(value);
  if (t.startsWith("ARRAY")) return !Array.isArray(value);
  if (t.startsWith("CHAR") || t.startsWith("VARCHAR")) return typeof value === "object"; // 문자·숫자는 허용, 객체·배열은 이상
  return false;
}

export function checkResponseSchema(items: readonly Record<string, unknown>[], fields: readonly FieldSpec[]): SchemaCheckResult {
  if (items.length === 0 || fields.length === 0) return { checked: false, ok: true, inspected: 0, problems: [], warnings: 0 };

  const inspected = items.slice(0, MAX_INSPECTED);
  const required = fields.filter((f) => f.required && !(f.name in CONDITIONALLY_ABSENT_FIELDS));
  const missingCount = new Map<string, number>();
  let warnings = 0;

  for (const item of inspected) {
    for (const f of required) {
      if (!(f.name in item) || item[f.name] === undefined) missingCount.set(f.name, (missingCount.get(f.name) ?? 0) + 1);
    }
    for (const f of fields) if (f.name in item && typeWarning(f.type, item[f.name])) warnings += 1;
  }

  const problems: SchemaProblem[] = [...missingCount.entries()].map(([field, count]) => ({ code: "MISSING_REQUIRED_FIELD", field, count }));
  return { checked: true, ok: problems.length === 0, inspected: inspected.length, problems, warnings };
}

// 한 조회가 여러 번 호출한 결과(PUBLIC 상세)를 하나로 합친다: 검사한 것 중 하나라도 필수 항목이 빠졌으면 ok가 아니다
export function mergeSchemaChecks(results: readonly (SchemaCheckResult | null | undefined)[]): SchemaCheckResult | null {
  const checked = results.filter((r): r is SchemaCheckResult => !!r && r.checked);
  if (checked.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of checked) for (const p of r.problems) counts.set(p.field, (counts.get(p.field) ?? 0) + p.count);
  const problems: SchemaProblem[] = [...counts.entries()].map(([field, count]) => ({ code: "MISSING_REQUIRED_FIELD", field, count }));
  return {
    checked: true,
    ok: problems.length === 0,
    inspected: checked.reduce((n, r) => n + r.inspected, 0),
    problems,
    warnings: checked.reduce((n, r) => n + r.warnings, 0),
  };
}

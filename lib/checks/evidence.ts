// Design Ref: DESIGN §6.1(anomalies.evidence·value_hash), PRD 5-2 규칙 9 — 탐지 근거와 "원본 값 지문" 만들기
// 근거(evidence): 담당자가 화면에서 "무엇이 어떻게 틀렸는지" 볼 수 있게 규칙별 요약과 관련 값을 담는다.
// 지문(value_hash): 규칙이 실제로 보는 원본 값만으로 만든다. 정상 판정(dismissed)한 건과 "값이 같은지" 비교하는 데 쓴다.
//   → 같은 값이면 같은 지문, 값이 하나라도 바뀌면 다른 지문. 수집 시각·탐지 횟수 같은 것은 섞지 않는다.
// 순수 함수다. DB를 모른다.
import { createHash } from "node:crypto";
import { detectDateOrder } from "@/lib/rules/date-order";
import { detectRequiredField } from "@/lib/rules/required-fields";
import { COMPARE_FIELDS, type ListDetailResult } from "@/lib/rules/list-detail";
import type { RuleId } from "@/lib/rules/detect-item";

type Fields = Record<string, unknown> | null;

// 규칙마다 "이 규칙이 실제로 읽는 필드"
const RELEVANT_FIELDS: Record<RuleId, readonly string[]> = {
  DATE_ORDER: ["bid_start_at", "bid_end_at"],
  REQUIRED_FIELD: ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at", "item_status"],
  LIST_DETAIL_MISMATCH: COMPARE_FIELDS,
};

const MAX_TEXT = 200; // 근거에 담는 문자열 길이 제한 (DB 근거 크기 제한 10,000바이트를 넘지 않게)

// 키 순서가 달라도 같은 값이면 같은 문자열이 되게 만든다
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const pick = (fields: Fields, keys: readonly string[]) => (fields ? Object.fromEntries(keys.map((k) => [k, fields[k] ?? null])) : null);
const clip = (value: unknown): unknown => (typeof value === "string" && value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
const clipAll = (obj: Record<string, unknown> | null) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, clip(v)])) : null);

export type BuiltEvidence = { evidence: Record<string, unknown>; valueHash: string };

// 데이터 규칙 3개의 근거와 지문
export function buildDetectionEvidence(ruleId: RuleId, list: Fields, detail: Fields, listDetail: ListDetailResult): BuiltEvidence {
  const keys = RELEVANT_FIELDS[ruleId];
  const values = { list: pick(list, keys), detail: pick(detail, keys) };

  let summary: Record<string, unknown>;
  if (ruleId === "DATE_ORDER") {
    summary = { findings: { list: list ? detectDateOrder(list) : null, detail: detail ? detectDateOrder(detail) : null } };
  } else if (ruleId === "REQUIRED_FIELD") {
    summary = { problems: { list: list ? (detectRequiredField(list)?.problems ?? null) : null, detail: detail ? (detectRequiredField(detail)?.problems ?? null) : null } };
  } else {
    const compared = listDetail.outcome === "compared";
    summary = { gapSeconds: listDetail.gapSeconds, diffs: compared && listDetail.finding ? listDetail.finding.diffs.map((d) => ({ field: d.field, list: clip(d.list), detail: clip(d.detail) })) : [] };
  }

  return {
    evidence: { rule: ruleId, ...summary, values: { list: clipAll(values.list), detail: clipAll(values.detail) } },
    valueHash: sha256(canonical({ rule: ruleId, values })),
  };
}

// API 상태 이상징후(EMPTY_RESULT): 물건 식별값 자리에는 API 이름이 들어간다. 바뀔 "값"이 없으므로 지문은 API 이름으로만 만든다.
export function buildEmptyResultEvidence(endpoint: string): BuiltEvidence {
  return { evidence: { rule: "EMPTY_RESULT", endpoint, recordCount: 0 }, valueHash: sha256(`EMPTY_RESULT|${endpoint}`) };
}

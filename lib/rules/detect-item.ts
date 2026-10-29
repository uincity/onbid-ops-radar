// 물건 1건(목록·상세)에 탐지 규칙 3개를 모두 적용해 결과를 모으는 곳 (PoC)
// 순수 함수다. DB에 저장하거나 이상징후를 만드는 일은 하지 않는다. (저장은 PLAN 23번 record_detection이 맡는다)
import { detectDateOrder } from "./date-order";
import { detectRequiredField } from "./required-fields";
import { compareListDetail, type ListDetailResult } from "./list-detail";

export type RuleId = "DATE_ORDER" | "REQUIRED_FIELD" | "LIST_DETAIL_MISMATCH";

export type ItemInput = {
  list: { fields: Record<string, unknown>; collectedAtMs: number } | null;
  detail: { fields: Record<string, unknown>; collectedAtMs: number } | null;
};

export type ItemDetection = { rules: RuleId[]; listDetail: ListDetailResult };

export function detectItem(item: ItemInput, compareWindowSeconds: number): ItemDetection {
  const rules = new Set<RuleId>();
  for (const record of [item.list, item.detail]) {
    if (!record) continue;
    if (detectRequiredField(record.fields)) rules.add("REQUIRED_FIELD");
    if (detectDateOrder(record.fields)) rules.add("DATE_ORDER");
  }
  const listDetail = compareListDetail(item.list, item.detail, compareWindowSeconds);
  if (listDetail.outcome === "compared" && listDetail.finding) rules.add("LIST_DETAIL_MISMATCH");
  return { rules: [...rules].sort(), listDetail };
}

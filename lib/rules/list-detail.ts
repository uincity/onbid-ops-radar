// Design Ref: PRD 5-2 규칙 3 — 탐지 규칙 3: 목록·상세 정합성 (LIST_DETAIL_MISMATCH)
// 목록·상세가 모두 있고 수집 시각 차이가 허용 시간 "이내(같으면 포함)"일 때만 비교한다.
// 진행상태(item_status)처럼 정상적으로 바뀔 수 있는 필드는 비교하지 않는다.
// 허용 시간은 코드에 숫자로 쓰지 않고 호출하는 쪽이 설정값(compare_window_minutes)에서 읽어 넘긴다.
import { DEMO_PROFILE, type FieldProfile } from "./field-profile";

export const LIST_DETAIL_RULE_ID = "LIST_DETAIL_MISMATCH" as const;

// DEMO의 비교 필드 (다른 출처는 프로필의 compareFields)
export const COMPARE_FIELDS = DEMO_PROFILE.compareFields;

export type ListDetailRecord = { fields: Record<string, unknown>; collectedAtMs: number };

export type ListDetailResult =
  | { outcome: "skipped"; reason: "NO_COUNTERPART" | "WINDOW_EXCEEDED"; gapSeconds: number | null }
  | { outcome: "compared"; gapSeconds: number; finding: { ruleId: typeof LIST_DETAIL_RULE_ID; diffs: { field: string; list: unknown; detail: unknown }[] } | null };

// 날짜는 같은 순간이면 표기가 달라도 같은 값으로 본다
function sameValue(profile: FieldProfile, key: string, a: unknown, b: unknown): boolean {
  if (key === profile.startField || key === profile.endField) {
    const [x, y] = [profile.parseDate(a), profile.parseDate(b)];
    if (x !== null && y !== null) return x === y;
  }
  return a === b;
}

export function compareListDetail(
  list: ListDetailRecord | null,
  detail: ListDetailRecord | null,
  windowSeconds: number,
  profile: FieldProfile = DEMO_PROFILE,
): ListDetailResult {
  if (!list || !detail) return { outcome: "skipped", reason: "NO_COUNTERPART", gapSeconds: null };

  const gapSeconds = Math.round(Math.abs(detail.collectedAtMs - list.collectedAtMs) / 1000);
  if (gapSeconds > windowSeconds) return { outcome: "skipped", reason: "WINDOW_EXCEEDED", gapSeconds };

  const diffs = profile.compareFields.filter((key) => !sameValue(profile, key, list.fields[key], detail.fields[key])).map((field) => ({
    field,
    list: list.fields[field],
    detail: detail.fields[field],
  }));
  return { outcome: "compared", gapSeconds, finding: diffs.length > 0 ? { ruleId: LIST_DETAIL_RULE_ID, diffs } : null };
}

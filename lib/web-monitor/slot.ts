// Design Ref: docs/design-homepage-monitoring.md §6.1(slot_at) / Plan W06 — 정시 칸(시간 단위) 계산 (순수 함수)
// 매시 :07에 도는 정시 점검은 "그 시각의 칸"에 속한다. 칸의 시각은 그 시간의 정각(UTC)이다.
// 같은 칸의 정시 점검은 DB가 하나만 인정하므로, 호출이 중복되어도 대체 실행이 늦게 돌아도 같은 칸으로 계산돼야 한다.
const HOUR_MS = 60 * 60 * 1000;

export function scheduledSlotAt(nowMs: number): Date {
  return new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS);
}

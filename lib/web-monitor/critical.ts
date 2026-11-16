// Design Ref: docs/design-homepage-monitoring.md §5.10(W26 핵심 시간대 촉진 점검) — 핵심 시간대·촉진 칸 계산 (순수 함수)
// DB 함수 web_critical_tick()(supabase/migrations/20261116100000_add_web_critical_checks.sql)과 같은 규칙이다.
// DB가 "지금 앱을 부를지"를 정하고, 앱은 이 파일로 한 번 더 확인한다. 둘이 어긋나면 촉진 점검이 조용히 건너뛰므로 tests/unit/web-critical.test.ts가 경계를 지킨다.
import { kstClock } from "@/lib/time";
import type { CriticalRange } from "./settings";

const MINUTE_MS = 60_000;
export const SCHEDULED_MINUTE = 7; // 정시 점검은 매시 :07 — 촉진 칸은 이 시각을 기준으로 맞춘다

/** 평일(월~금)의 핵심 시간대 구간 안인가 (알림 강조 판단에도 쓴다. 켜기 설정과는 무관) */
export function isInCriticalHours(instant: Date, ranges: readonly CriticalRange[]): boolean {
  const { isoDow, hour } = kstClock(instant);
  if (isoDow > 5) return false; // 주말
  return ranges.some((r) => hour >= r.from && hour < r.to);
}

/** 이 분이 촉진 칸인가: (분−7) mod 간격 = 0 이고 분 ≠ 7 (:07은 정시 점검이 이미 한다) */
export function isCriticalGridMinute(minute: number, intervalMin: number): boolean {
  if (minute === SCHEDULED_MINUTE) return false;
  return (((minute - SCHEDULED_MINUTE) % intervalMin) + intervalMin) % intervalMin === 0;
}

/** 지금 촉진 점검을 해야 하는 칸인가 (켜져 있음 + 평일 핵심 시간대 + 촉진 칸) */
export function isCriticalSlot(instant: Date, s: { criticalEnabled: boolean; criticalRanges: readonly CriticalRange[]; criticalIntervalMin: number }): boolean {
  if (!s.criticalEnabled) return false;
  if (!isInCriticalHours(instant, s.criticalRanges)) return false;
  return isCriticalGridMinute(kstClock(instant).minute, s.criticalIntervalMin);
}

/** 촉진 칸의 시각: 분 단위로 자른 시각. 같은 칸의 중복 호출은 DB(critical_slot_at 유일)가 하나만 인정한다 */
export function criticalSlotAt(nowMs: number): Date {
  return new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS);
}

/** 알림 강조·지속 알림 간격 단축을 적용할 때인가: 촉진 점검이 켜져 있고 지금이 핵심 시간대 안 (정시·재확인·촉진 어느 실행이든 같은 기준) */
export function criticalNowOf(s: { criticalEnabled: boolean; criticalRanges: readonly CriticalRange[] }, instant: Date): boolean {
  return s.criticalEnabled && isInCriticalHours(instant, s.criticalRanges);
}

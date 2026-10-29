// 예약 점검 시각의 UTC 표현 (Supabase Cron은 UTC로 동작한다). 스크립트(.mjs)는 TypeScript인 lib/time.ts를 불러올 수 없어 값을 여기에 둔다.
// KST 09:00 = UTC 00:00. lib/time.ts의 SCHEDULED_RUN_UTC와 같은 값인지 tests/unit/schedule-clock-drift.test.ts가 확인한다.
export const SCHEDULED_RUN_UTC = { hour: 0, minute: 0 };

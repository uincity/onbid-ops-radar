// Design Ref: DESIGN §1.2 원칙 5(DB에는 표준시 UTC로 저장하고 집계·표시만 KST로 바꾼다), §11.1(lib/time.ts), PRD 5-5(KST 기준)
// 한국 표준시(KST) 계산 도우미. 브라우저·서버·테스트 어디서나 같은 결과가 나오도록 순수 함수로만 만들었다.
// 한국은 일광절약시간이 없어 항상 UTC+9이므로, 시간대 데이터베이스 없이 +9시간으로 계산한다.

export const KST_TIME_ZONE = "Asia/Seoul";
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

// 예약 점검 시각(PRD 5-5: 매일 KST 09:00). Supabase Cron은 UTC로 동작하므로 아래 SCHEDULED_RUN_UTC로 설정한다. (PLAN 31번)
export const SCHEDULED_RUN_KST = { hour: 9, minute: 0 } as const;

// KST 시각(시·분)을 UTC 시각(시·분)으로 바꾼다. 날짜는 넘어가도 시·분만 돌려준다. 예: KST 09:00 → UTC 00:00
export function utcClockOf(kst: { hour: number; minute: number }): { hour: number; minute: number } {
  const totalMinutes = (((kst.hour * 60 + kst.minute - 9 * 60) % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

export const SCHEDULED_RUN_UTC = utcClockOf(SCHEDULED_RUN_KST);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// "YYYY-MM-DD" 형식이고 실제로 있는 날짜인지 (2026-02-30 같은 날짜는 거부)
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  if (!isValidDateString(value)) {
    throw new RangeError(`날짜 형식이 올바르지 않습니다: "${value}" (YYYY-MM-DD 형식의 실제 있는 날짜여야 합니다)`);
  }
  const match = DATE_PATTERN.exec(value)!;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function assertInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) throw new RangeError("올바르지 않은 시각입니다.");
}

// 어떤 순간(instant)이 KST로 며칠인지 "YYYY-MM-DD"로 돌려준다.
export function toKstDateString(instant: Date): string {
  assertInstant(instant);
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// KST 날짜 하루의 범위: [시작, 끝). 시작은 그날 00:00, 끝은 다음 날 00:00(= "24:00")이고 끝은 포함하지 않는다. (PRD 5-5 일일 집계 기준)
export function kstDayRange(date: string): { start: Date; end: Date } {
  const { year, month, day } = parseDate(date);
  const start = new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

// KST 날짜에 일수를 더하거나 뺀다. 예: addDaysKst("2026-10-29", -1) → "2026-10-28"
export function addDaysKst(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// 화면에 보여 줄 KST 시각: "2026-10-29 09:00:12"
export function formatKst(instant: Date): string {
  assertInstant(instant);
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

// 그날 예약 점검이 시작되어야 하는 순간 (KST 09:00)
export function scheduledRunAt(date: string): Date {
  const { start } = kstDayRange(date);
  return new Date(start.getTime() + SCHEDULED_RUN_KST.hour * HOUR_MS + SCHEDULED_RUN_KST.minute * MINUTE_MS);
}

// 예약 점검 누락을 판단하는 기한: 예정 시각 + 대기 시간(분). 기본은 KST 09:30. (PRD 5-5)
export function scheduleMissedDeadline(date: string, graceMinutes: number): Date {
  return new Date(scheduledRunAt(date).getTime() + graceMinutes * MINUTE_MS);
}

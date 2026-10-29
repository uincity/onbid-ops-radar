// Design Ref: DESIGN §11.2 — 탐지 규칙이 함께 쓰는 날짜·시각 해석기 (순수 함수, Next.js·Supabase를 모른다)
// "2026-03-01T09:00:00+09:00"처럼 시간대(Z 또는 ±hh:mm)가 붙은 ISO 8601만 올바른 값으로 본다.
// 시간대가 없거나 존재하지 않는 날짜(2026-02-30)는 null이다. 그런 값은 날짜 순서를 따질 수 없으므로 필수정보 규칙(PLAN 19번)이 다룬다.

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// 올바른 ISO 8601 날짜·시각이면 그 "순간"(밀리초)을, 아니면 null.
// 표기가 달라도 같은 순간이면 같은 값이다. (09:00+09:00 == 00:00Z)
export function parseIsoInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = ISO.exec(value);
  if (!m) return null;

  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  // 2026-02-30처럼 달력에 없는 날짜 거르기
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;

  let offsetMs = 0;
  if (m[8] !== "Z") {
    const sign = m[8][0] === "-" ? -1 : 1;
    const offsetHour = Number(m[8].slice(1, 3));
    const offsetMinute = Number(m[8].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMs = sign * (offsetHour * 3_600_000 + offsetMinute * 60_000);
  }

  const fractionMs = m[7] ? Math.round(Number(`0${m[7]}`) * 1000) : 0;
  return Date.UTC(year, month - 1, day, hour, minute, second) + fractionMs - offsetMs;
}

// lib/time.ts (한국 표준시 계산) 단위 테스트
// 하루의 경계(00:00)와 예약 시각(09:00)처럼 틀리기 쉬운 순간을 중심으로 채점한다.
import { describe, expect, it } from "vitest";
import {
  SCHEDULED_RUN_KST,
  SCHEDULED_RUN_UTC,
  addDaysKst,
  formatKst,
  isValidDateString,
  kstDayRange,
  scheduleMissedDeadline,
  scheduledRunAt,
  toKstDateString,
  utcClockOf,
} from "@/lib/time";

describe("toKstDateString: 어떤 순간이 KST로 며칠인가", () => {
  it("UTC 15:00은 KST로 다음 날 00:00이다 (날짜가 바뀌는 경계)", () => {
    expect(toKstDateString(new Date("2026-10-28T14:59:59.999Z"))).toBe("2026-10-28");
    expect(toKstDateString(new Date("2026-10-28T15:00:00.000Z"))).toBe("2026-10-29");
  });

  it("UTC로는 아직 전날이어도 KST로는 이미 오늘이다 (서버 시각이 UTC여도 한국 날짜로 센다)", () => {
    expect(toKstDateString(new Date("2026-10-29T00:00:00Z"))).toBe("2026-10-29"); // KST 09:00
    expect(toKstDateString(new Date("2026-12-31T15:30:00Z"))).toBe("2027-01-01"); // 해가 바뀌는 경계
  });

  it("올바르지 않은 시각은 오류", () => {
    expect(() => toKstDateString(new Date("nope"))).toThrow(RangeError);
  });
});

describe("kstDayRange: KST 하루 [00:00, 다음 날 00:00)", () => {
  it("시작은 전날 UTC 15:00, 끝은 다음 날 KST 00:00이다", () => {
    const { start, end } = kstDayRange("2026-10-29");
    expect(start.toISOString()).toBe("2026-10-28T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-29T15:00:00.000Z");
  });

  it("그날 23:59:59.999(KST)는 포함되고, 다음 날 00:00(KST)은 포함되지 않는다", () => {
    const { start, end } = kstDayRange("2026-10-29");
    const lastMoment = new Date("2026-10-29T14:59:59.999Z"); // KST 23:59:59.999
    const nextMidnight = new Date("2026-10-29T15:00:00.000Z"); // KST 다음 날 00:00
    expect(lastMoment >= start && lastMoment < end).toBe(true);
    expect(nextMidnight >= start && nextMidnight < end).toBe(false);
    expect(toKstDateString(lastMoment)).toBe("2026-10-29");
    expect(toKstDateString(nextMidnight)).toBe("2026-10-30");
  });

  it("하루는 항상 24시간이다 (한국은 일광절약시간이 없다)", () => {
    for (const date of ["2026-03-08", "2026-03-29", "2026-10-25", "2026-11-01"]) {
      const { start, end } = kstDayRange(date);
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("실제로 없는 날짜나 형식이 틀린 날짜는 거부한다", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-10-32", "2026-1-5", "20261029", "", "2026-10-29T00:00"]) {
      expect(() => kstDayRange(bad), bad).toThrow(RangeError);
    }
  });

  it("윤년의 2월 29일은 허용한다", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2100-02-29")).toBe(false); // 100으로 나누어지는 해는 윤년이 아님
  });
});

describe("addDaysKst", () => {
  it("달·해가 바뀌어도 맞게 계산한다", () => {
    expect(addDaysKst("2026-10-29", -1)).toBe("2026-10-28");
    expect(addDaysKst("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysKst("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKst("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysKst("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysKst("2026-10-29", 0)).toBe("2026-10-29");
  });
});

describe("formatKst", () => {
  it("KST 시각을 'YYYY-MM-DD HH:mm:ss'로 보여 준다", () => {
    expect(formatKst(new Date("2026-10-29T00:00:12Z"))).toBe("2026-10-29 09:00:12");
    expect(formatKst(new Date("2026-10-28T15:00:00Z"))).toBe("2026-10-29 00:00:00");
    expect(formatKst(new Date("2026-10-29T14:59:59Z"))).toBe("2026-10-29 23:59:59");
  });
});

describe("예약 점검 시각 (PRD 5-5: 매일 KST 09:00, 누락 판단은 30분 뒤)", () => {
  it("KST 09:00은 UTC 00:00이다 — Supabase Cron은 UTC로 설정한다", () => {
    expect(SCHEDULED_RUN_KST).toEqual({ hour: 9, minute: 0 });
    expect(SCHEDULED_RUN_UTC).toEqual({ hour: 0, minute: 0 });
  });

  it("utcClockOf: 시·분만 바꾸고 날짜가 넘어가는 경우도 맞게 계산한다", () => {
    expect(utcClockOf({ hour: 9, minute: 30 })).toEqual({ hour: 0, minute: 30 }); // 누락 확인 작업: UTC 00:30
    expect(utcClockOf({ hour: 0, minute: 0 })).toEqual({ hour: 15, minute: 0 });
    expect(utcClockOf({ hour: 8, minute: 59 })).toEqual({ hour: 23, minute: 59 });
    expect(utcClockOf({ hour: 23, minute: 45 })).toEqual({ hour: 14, minute: 45 });
  });

  it("scheduledRunAt: 그날 KST 09:00 순간", () => {
    expect(scheduledRunAt("2026-10-29").toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(formatKst(scheduledRunAt("2026-10-29"))).toBe("2026-10-29 09:00:00");
  });

  it("scheduleMissedDeadline: 예정 시각 + 대기 시간(기본 30분 → KST 09:30)", () => {
    expect(formatKst(scheduleMissedDeadline("2026-10-29", 30))).toBe("2026-10-29 09:30:00");
    expect(scheduleMissedDeadline("2026-10-29", 30).toISOString()).toBe("2026-10-29T00:30:00.000Z"); // 누락 확인 Cron의 UTC 시각과 같다
    expect(formatKst(scheduleMissedDeadline("2026-10-29", 120))).toBe("2026-10-29 11:00:00");
  });
});

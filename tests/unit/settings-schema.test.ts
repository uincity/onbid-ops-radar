// lib/settings/schema.ts (설정값의 모양·범위·관계·도우미) 단위 테스트
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SETTING_VALUES,
  INT_RANGES,
  PUBLIC_DAILY_BUDGET_RANGE,
  SETTING_KEYS,
  SettingsError,
  apiTimeoutMs,
  compareWindowMs,
  fieldsFor,
  findRelationProblems,
  isEmptyAllowed,
  parseSettings,
  resolveCallLimit,
  runTimeLimitMs,
  type Settings,
  type SettingRow,
} from "@/lib/settings/schema";

const defaultRows = (): SettingRow[] => SETTING_KEYS.map((key) => ({ key, value: DEFAULT_SETTING_VALUES[key] }));
const withValue = (key: string, value: unknown): SettingRow[] =>
  defaultRows().map((row) => (row.key === key ? { key, value } : row));

function problemsOf(rows: SettingRow[]): readonly string[] {
  try {
    parseSettings(rows);
  } catch (error) {
    if (error instanceof SettingsError) return error.problems;
    throw error;
  }
  return [];
}

describe("기본값 (PRD 5-5)", () => {
  it("기본값 14개를 그대로 읽으면 PRD 5-5의 숫자가 나온다", () => {
    const s = parseSettings(defaultRows());
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.compareWindowMinutes).toBe(10);
    expect(s.apiTimeoutSeconds).toBe(10);
    expect(s.apiCallLimitDefault).toBe(20);
    expect(s.apiCallLimitMax).toBe(100);
    expect(s.runTimeLimitSeconds).toBe(60);
    expect(s.reasonMinLength).toBe(10);
    expect(s.scheduleMissedGraceMinutes).toBe(30);
    expect(s.staleRunningSeconds).toBe(120);
    expect(s.scheduledSource).toBe("DEMO");
    expect(s.publicDailyBudget).toBeNull();
  });

  it("항목은 정확히 14개다", () => {
    expect(SETTING_KEYS).toHaveLength(14);
  });
});

describe("숫자 항목의 범위: 경계값은 허용하고 한 칸 밖은 거부한다", () => {
  for (const [key, range] of Object.entries(INT_RANGES)) {
    it(`${key}: ${range.min}~${range.max}`, () => {
      // 기본값끼리의 관계(기본 상한 ≤ 최대 상한 등)를 깨지 않도록, 관계가 없는 경계만 개별로 시험한다
      const rowsAt = (value: unknown) => withValue(key, value);
      expect(problemsOf(rowsAt(range.min - 1)).some((p) => p.startsWith(`${key}:`))).toBe(true);
      expect(problemsOf(rowsAt(range.max + 1)).some((p) => p.startsWith(`${key}:`))).toBe(true);
      expect(problemsOf(rowsAt(range.min + 0.5)).some((p) => p.startsWith(`${key}:`))).toBe(true); // 소수 거부
      expect(problemsOf(rowsAt(String(range.min))).some((p) => p.startsWith(`${key}:`))).toBe(true); // 숫자처럼 보이는 글자 거부
      expect(problemsOf(rowsAt(null)).some((p) => p.startsWith(`${key}:`))).toBe(true);
      expect(problemsOf(rowsAt(true)).some((p) => p.startsWith(`${key}:`))).toBe(true);
    });
  }

  it("범위 안의 값은 받아들인다 (관계 규칙을 깨지 않는 값)", () => {
    expect(parseSettings(withValue("compare_window_minutes", 1)).compareWindowMinutes).toBe(1);
    expect(parseSettings(withValue("compare_window_minutes", 60)).compareWindowMinutes).toBe(60);
    expect(parseSettings(withValue("api_timeout_seconds", 60)).apiTimeoutSeconds).toBe(60);
    expect(parseSettings(withValue("reason_min_length", 10)).reasonMinLength).toBe(10);
    expect(parseSettings(withValue("reason_min_length", 100)).reasonMinLength).toBe(100);
    expect(parseSettings(withValue("schedule_missed_grace_minutes", 120)).scheduleMissedGraceMinutes).toBe(120);
  });

  it("사유 최소 글자 수는 10 아래로 내릴 수 없다 (이력 테이블의 10자 규칙과 어긋나기 때문)", () => {
    expect(problemsOf(withValue("reason_min_length", 9))).not.toHaveLength(0);
  });
});

describe("PUBLIC 일일 호출 예산", () => {
  it("비움(null)과 양의 정수를 허용하고, 0·음수·글자·소수는 거부한다", () => {
    expect(parseSettings(withValue("public_daily_budget", null)).publicDailyBudget).toBeNull();
    expect(parseSettings(withValue("public_daily_budget", PUBLIC_DAILY_BUDGET_RANGE.min)).publicDailyBudget).toBe(1);
    expect(parseSettings(withValue("public_daily_budget", PUBLIC_DAILY_BUDGET_RANGE.max)).publicDailyBudget).toBe(1_000_000);
    for (const bad of [0, -1, 1_000_001, 1.5, "many", {}, []]) {
      expect(problemsOf(withValue("public_daily_budget", bad)), String(bad)).not.toHaveLength(0);
    }
  });
});

describe("출처 · 필드 목록 · 빈 결과 허용", () => {
  it("scheduled_source는 DEMO/PUBLIC만 허용한다", () => {
    expect(parseSettings(withValue("scheduled_source", "PUBLIC")).scheduledSource).toBe("PUBLIC");
    for (const bad of ["TEST", "demo", "", 1, null]) {
      expect(problemsOf(withValue("scheduled_source", bad)), String(bad)).not.toHaveLength(0);
    }
  });

  it("필드 목록은 출처(DEMO/PUBLIC)별 영문 소문자·숫자·밑줄 이름만 허용한다", () => {
    expect(parseSettings(withValue("required_fields", { DEMO: ["a", "b_1"], PUBLIC: [] })).requiredFields).toEqual({ DEMO: ["a", "b_1"], PUBLIC: [] });
    expect(parseSettings(withValue("required_fields", {})).requiredFields).toEqual({});
    const bad: unknown[] = [
      { TEST: ["a"] }, // 모르는 출처
      { DEMO: "a" }, // 목록이 아님
      { DEMO: ["Name"] }, // 대문자
      { DEMO: ["1abc"] }, // 숫자로 시작
      { DEMO: [1] }, // 글자가 아님
      { DEMO: ["bad name"] }, // 공백
      ["a"], // 출처별 묶음이 아님
      { DEMO: Array.from({ length: 31 }, (_, i) => `f${i}`) }, // 31개
    ];
    for (const value of bad) expect(problemsOf(withValue("required_fields", value)), JSON.stringify(value)).not.toHaveLength(0);
  });

  it("API 이름별 빈 결과 허용 여부는 true/false만 허용한다", () => {
    expect(parseSettings(withValue("empty_allowed_by_endpoint", { "demo-list": true })).emptyAllowedByEndpoint).toEqual({ "demo-list": true });
    for (const bad of [{ "demo-list": "yes" }, { "bad name": true }, { "demo-list": 1 }, [true]]) {
      expect(problemsOf(withValue("empty_allowed_by_endpoint", bad)), JSON.stringify(bad)).not.toHaveLength(0);
    }
  });
});

describe("줄 단위 문제: 없음·중복·모르는 항목은 모두 모아서 알려 준다", () => {
  it("항목이 없으면 어떤 항목이 없는지 알려 준다", () => {
    const rows = defaultRows().filter((r) => r.key !== "api_timeout_seconds" && r.key !== "scheduled_source");
    const problems = problemsOf(rows);
    expect(problems).toContain("항목이 없음: api_timeout_seconds");
    expect(problems).toContain("항목이 없음: scheduled_source");
  });

  it("모르는 항목과 중복 항목을 알려 준다", () => {
    const problems = problemsOf([...defaultRows(), { key: "price_threshold", value: 1 }, { key: "api_timeout_seconds", value: 10 }]);
    expect(problems).toContain("알 수 없는 항목: price_threshold");
    expect(problems).toContain("항목이 중복됨: api_timeout_seconds");
  });

  it("빈 목록이면 14개 모두 없다고 알려 준다", () => {
    expect(problemsOf([])).toHaveLength(14);
  });

  it("여러 항목이 잘못되면 한꺼번에 모아서 알려 준다 (하나씩 고치며 반복하지 않도록)", () => {
    const rows = withValue("compare_window_minutes", 0).map((r) => (r.key === "run_time_limit_seconds" ? { ...r, value: 5 } : r));
    const problems = problemsOf(rows);
    expect(problems.filter((p) => p.startsWith("compare_window_minutes:") || p.startsWith("run_time_limit_seconds:"))).toHaveLength(2);
  });

  it("오류 메시지에는 잘못된 값 자체가 아니라 규칙이 들어 있다", () => {
    const [problem] = problemsOf(withValue("api_timeout_seconds", 999));
    expect(problem).toContain("정수 1~60");
    expect(problem).not.toContain("999");
  });
});

describe("항목 사이의 관계 (DB는 항목 하나씩만 검사하므로 코드가 확인한다)", () => {
  const base = DEFAULT_SETTINGS;
  const change = (patch: Partial<Settings>): Settings => ({ ...base, ...patch });

  it("기본값은 관계 규칙을 모두 지킨다", () => {
    expect(findRelationProblems(base)).toEqual([]);
  });

  it("호출 기본 상한이 최대 상한보다 크면 거부한다 (같으면 허용)", () => {
    expect(findRelationProblems(change({ apiCallLimitDefault: 51, apiCallLimitMax: 50 }))).toHaveLength(1);
    expect(findRelationProblems(change({ apiCallLimitDefault: 50, apiCallLimitMax: 50 }))).toEqual([]);
  });

  it("멈춘 실행 정리 기준은 점검 실행시간 제한보다 커야 한다 (같으면 거부)", () => {
    expect(findRelationProblems(change({ staleRunningSeconds: 60, runTimeLimitSeconds: 60 }))).toHaveLength(1);
    expect(findRelationProblems(change({ staleRunningSeconds: 61, runTimeLimitSeconds: 60 }))).toEqual([]);
    expect(findRelationProblems(change({ staleRunningSeconds: 60, runTimeLimitSeconds: 300 }))).toHaveLength(1);
  });

  it("비교 대상과 비교 제외에 같은 필드가 있으면 거부한다", () => {
    const problems = findRelationProblems(change({ compareFields: { DEMO: ["item_name", "item_status"] }, excludedFields: { DEMO: ["item_status"] } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("item_status");
    // 다른 출처의 같은 이름은 서로 상관없다
    expect(findRelationProblems(change({ compareFields: { DEMO: ["a"] }, excludedFields: { PUBLIC: ["a"] } }))).toEqual([]);
  });

  it("관계가 어긋난 값은 parseSettings가 읽을 때 오류로 멈춘다", () => {
    expect(problemsOf(withValue("api_call_limit_default", 100).map((r) => (r.key === "api_call_limit_max" ? { ...r, value: 10 } : r)))).toHaveLength(1);
    expect(problemsOf(withValue("stale_running_seconds", 60))).toHaveLength(1);
  });
});

describe("도우미", () => {
  it("fieldsFor: 출처에 항목이 없으면 빈 목록 (부록 A 확정 전의 PUBLIC)", () => {
    expect(fieldsFor(DEFAULT_SETTINGS.requiredFields, "DEMO")).toEqual(["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"]);
    expect(fieldsFor(DEFAULT_SETTINGS.requiredFields, "PUBLIC")).toEqual([]);
  });

  it("isEmptyAllowed: 설정에 없는 API는 허용하지 않는 것으로 본다", () => {
    expect(isEmptyAllowed(DEFAULT_SETTINGS, "demo-list")).toBe(false);
    expect(isEmptyAllowed({ ...DEFAULT_SETTINGS, emptyAllowedByEndpoint: { "demo-list": true } }, "demo-list")).toBe(true);
    expect(isEmptyAllowed(DEFAULT_SETTINGS, "unknown-api")).toBe(false);
  });

  it("resolveCallLimit: 요청이 없으면 기본 20회, 최대 100회를 넘으면 100회로 줄인다", () => {
    expect(resolveCallLimit(DEFAULT_SETTINGS)).toBe(20);
    expect(resolveCallLimit(DEFAULT_SETTINGS, 1)).toBe(1);
    expect(resolveCallLimit(DEFAULT_SETTINGS, 50)).toBe(50);
    expect(resolveCallLimit(DEFAULT_SETTINGS, 100)).toBe(100);
    expect(resolveCallLimit(DEFAULT_SETTINGS, 101)).toBe(100);
    expect(resolveCallLimit(DEFAULT_SETTINGS, 100000)).toBe(100);
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(() => resolveCallLimit(DEFAULT_SETTINGS, bad), String(bad)).toThrow(RangeError);
  });

  it("밀리초 변환: 타임아웃 10초 · 실행시간 60초 · 수집 시각 차이 10분", () => {
    expect(apiTimeoutMs(DEFAULT_SETTINGS)).toBe(10_000);
    expect(runTimeLimitMs(DEFAULT_SETTINGS)).toBe(60_000);
    expect(compareWindowMs(DEFAULT_SETTINGS)).toBe(600_000);
  });
});

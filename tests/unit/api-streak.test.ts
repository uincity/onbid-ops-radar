// 연속 FAIL 세기와 API 상태 이상징후 만들기 시험 (PRD R04) — 기준(3) 한 칸 안·밖 경계 포함
import { describe, expect, it } from "vitest";
import { buildApiDetection, countFailStreak, type ProbeHistoryRow } from "@/lib/checks/api-streak";

const fail = (reason: string): ProbeHistoryRow => ({ status: "FAIL", reason });
const pass: ProbeHistoryRow = { status: "PASS_DATA", reason: null };

describe("countFailStreak", () => {
  it("가장 최근부터 연속 FAIL만 센다", () => {
    expect(countFailStreak([fail("TIMEOUT"), fail("TIMEOUT"), pass, fail("TIMEOUT")])).toEqual({ count: 2, code: "TIMEOUT" });
  });
  it("정상·주의가 끼면 끊긴다", () => {
    expect(countFailStreak([pass, fail("HTTP_ERROR")]).count).toBe(0);
    expect(countFailStreak([{ status: "DEGRADED", reason: "SLOW_RESPONSE" }, fail("HTTP_ERROR")]).count).toBe(0);
    expect(countFailStreak([{ status: "PASS_NO_DATA", reason: null }, fail("HTTP_ERROR")]).count).toBe(0);
  });
  it("검증 불가·미점검은 세지도 끊지도 않는다", () => {
    expect(countFailStreak([fail("HTTP_ERROR"), { status: "UNVERIFIED", reason: "NO_VALID_INPUT" }, { status: "NOT_RUN", reason: "BUDGET_SKIP" }, fail("HTTP_ERROR")]).count).toBe(2);
  });
  it("서비스키·한도 FAIL은 세지도 끊지도 않는다", () => {
    expect(countFailStreak([fail("HTTP_ERROR"), fail("AUTH_ERROR"), fail("QUOTA_EXCEEDED"), fail("HTTP_ERROR")]).count).toBe(2);
  });
  it("세부 코드는 가장 최근 실패의 것이다", () => {
    expect(countFailStreak([fail("SCHEMA_ERROR"), fail("HTTP_ERROR")]).code).toBe("SCHEMA_ERROR");
  });
  it("기록이 없으면 0회", () => {
    expect(countFailStreak([])).toEqual({ count: 0, code: null });
  });
});

describe("buildApiDetection", () => {
  const streak = (count: number) => ({ count, code: "HTTP_ERROR" as const });
  it("기준 3회: 2회는 만들지 않고(한 칸 아래) 3회는 만든다(한 칸 위)", () => {
    expect(buildApiDetection("SVC-API-001", "getRlstCltrList", streak(2), 3)).toBeNull();
    expect(buildApiDetection("SVC-API-001", "getRlstCltrList", streak(3), 3)).toMatchObject({ ruleId: "API_HTTP_ERROR", itemKey: "SVC-API-001/getRlstCltrList" });
  });
  it("실패 코드가 없으면 만들지 않는다", () => {
    expect(buildApiDetection("SVC-API-001", "getRlstCltrList", { count: 5, code: null }, 3)).toBeNull();
  });
  it("지문은 연속 횟수가 늘어도 같고, 실패 코드가 바뀌면 달라진다", () => {
    const a = buildApiDetection("SVC-API-001", "getRlstCltrList", streak(3), 3)!;
    const b = buildApiDetection("SVC-API-001", "getRlstCltrList", streak(7), 3)!;
    const c = buildApiDetection("SVC-API-001", "getRlstCltrList", { count: 3, code: "TIMEOUT" }, 3)!;
    expect(a.valueHash).toBe(b.valueHash);
    expect(a.valueHash).not.toBe(c.valueHash);
  });
});

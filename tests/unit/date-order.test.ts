// 탐지 규칙 1 날짜 정합성(DATE_ORDER) 시험 (PLAN 작업 18)
// 1) 경계값: 종료가 시작보다 1초 빠름 / 같음 / 1초 늦음
// 2) 표기가 달라도 같은 순간이면 같게 본다
// 3) 날짜가 없거나 형식이 틀리면 이 규칙은 침묵한다 (필수정보 규칙의 몫)
// 4) 시나리오 160건으로 채점: 정답표(expected)와 한 건도 어긋나면 안 된다
import { describe, expect, it } from "vitest";
import { detectDateOrder } from "@/lib/rules/date-order";
import { parseIsoInstant } from "@/lib/rules/iso-datetime";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";

const START = "2026-03-01T09:00:00+09:00";

describe("parseIsoInstant (날짜·시각 해석)", () => {
  it("표기가 달라도 같은 순간이면 같은 값이다", () => {
    expect(parseIsoInstant("2026-03-01T09:00:00+09:00")).toBe(parseIsoInstant("2026-03-01T00:00:00Z"));
  });

  it("소수점 초를 읽는다", () => {
    expect(parseIsoInstant("2026-03-01T00:00:00.500Z")! - parseIsoInstant("2026-03-01T00:00:00Z")!).toBe(500);
  });

  it.each([
    ["시간대 없음", "2026-03-01T09:00:00"],
    ["날짜만", "2026-03-01"],
    ["달력에 없는 날짜", "2026-02-30T09:00:00+09:00"],
    ["25시", "2026-03-01T25:00:00+09:00"],
    ["빈 문자열", ""],
    ["숫자", 1772323200000],
    ["null", null],
    ["없음", undefined],
  ])("올바르지 않은 값은 null: %s", (_label, value) => {
    expect(parseIsoInstant(value)).toBeNull();
  });
});

describe("detectDateOrder 경계값", () => {
  it("종료가 시작보다 1초 빠르면 이상징후", () => {
    const finding = detectDateOrder({ bid_start_at: START, bid_end_at: "2026-03-01T08:59:59+09:00" });
    expect(finding).toEqual({
      ruleId: "DATE_ORDER",
      bidStartAt: START,
      bidEndAt: "2026-03-01T08:59:59+09:00",
      gapSeconds: 1,
    });
  });

  it("종료와 시작이 같은 시각이면 정상", () => {
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: START })).toBeNull();
  });

  it("종료가 시작보다 1초 늦으면 정상", () => {
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: "2026-03-01T09:00:01+09:00" })).toBeNull();
  });

  it("표기만 다르고 같은 순간이면 정상 (09:00+09:00 == 00:00Z)", () => {
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: "2026-03-01T00:00:00Z" })).toBeNull();
  });

  it("표기가 달라도 순서가 뒤집혔으면 이상징후 (숫자만 보면 놓치는 경우)", () => {
    // 종료 08:00Z(= 17:00 KST)는 시작보다 늦어 정상, 전날 23:00Z(= 08:00 KST)는 시작보다 1시간 빨라 이상
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: "2026-03-01T08:00:00Z" })).toBeNull();
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: "2026-02-28T23:00:00Z" })?.gapSeconds).toBe(3600);
  });

  it("한참 뒤집힌 경우 gapSeconds가 차이를 초로 담는다", () => {
    expect(detectDateOrder({ bid_start_at: START, bid_end_at: "2026-02-28T09:00:00+09:00" })?.gapSeconds).toBe(86_400);
  });
});

describe("detectDateOrder는 날짜를 판단할 수 없으면 침묵한다", () => {
  it.each([
    ["시작 없음", { bid_end_at: START }],
    ["종료 없음", { bid_start_at: START }],
    ["시작 null", { bid_start_at: null, bid_end_at: START }],
    ["종료 빈 문자열", { bid_start_at: START, bid_end_at: "" }],
    ["시작 형식 오류", { bid_start_at: "내일", bid_end_at: START }],
    ["종료 시간대 없음", { bid_start_at: START, bid_end_at: "2026-02-28T09:00:00" }],
    ["둘 다 없음", {}],
  ])("%s → 이상징후 아님(필수정보 규칙의 몫)", (_label, input) => {
    expect(detectDateOrder(input)).toBeNull();
  });
});

describe("시나리오 160건 채점", () => {
  // 목록·상세 어느 쪽이든 하나라도 걸리면 그 물건은 DATE_ORDER 이상징후다
  const detected = (s: (typeof DEMO_SCENARIOS)[number]) => [s.list, s.detail].some((record) => record && detectDateOrder(record) !== null);

  it("160건 모두 정답표와 같은 결과를 낸다", () => {
    const wrong = DEMO_SCENARIOS.filter((s) => detected(s) !== s.expected.rules.includes("DATE_ORDER")).map((s) => s.id);
    expect(wrong).toEqual([]);
  });

  it("이상징후는 정확히 정답표가 가리키는 건수만큼 나온다 (놓침 0 · 오탐 0)", () => {
    const expectedIds = DEMO_SCENARIOS.filter((s) => s.expected.rules.includes("DATE_ORDER")).map((s) => s.id);
    const foundIds = DEMO_SCENARIOS.filter(detected).map((s) => s.id);
    expect(expectedIds.length).toBeGreaterThanOrEqual(10); // 이상 시나리오 10건 이상이 있어야 채점이 의미 있다
    expect(foundIds).toEqual(expectedIds);
  });

  it("정상 100건에서는 하나도 걸리지 않는다", () => {
    const falseAlarms = DEMO_SCENARIOS.filter((s) => s.group === "normal" && detected(s)).map((s) => s.id);
    expect(falseAlarms).toEqual([]);
  });
});

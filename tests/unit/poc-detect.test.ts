// PoC 시험: 탐지 규칙 3개를 DEMO 160건에 모두 적용해 정답표와 비교한다 (PLAN 19·20 압축판)
// 결과 요약표를 화면에 출력하므로 `npm run test:unit -- poc-detect`로 실행하면 눈으로도 확인할 수 있다.
import { describe, expect, it } from "vitest";
import { detectRequiredField } from "@/lib/rules/required-fields";
import { compareListDetail } from "@/lib/rules/list-detail";
import { detectItem } from "@/lib/rules/detect-item";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { DEFAULT_SETTING_VALUES } from "@/lib/settings/schema";

const WINDOW_SECONDS = DEFAULT_SETTING_VALUES.compare_window_minutes * 60;
const BASE_MS = Date.parse("2026-03-01T00:00:00Z");

// 시나리오 → 규칙 입력. 목록 수집 시각을 기준으로 상세는 detailOffsetSeconds만큼 떨어진 시각이다.
const toInput = (s: (typeof DEMO_SCENARIOS)[number]) => ({
  list: s.list ? { fields: s.list as Record<string, unknown>, collectedAtMs: BASE_MS } : null,
  detail: s.detail ? { fields: s.detail as Record<string, unknown>, collectedAtMs: BASE_MS + s.detailOffsetSeconds * 1000 } : null,
});

const GOOD = {
  demo_item_id: "DEMO-0001",
  item_name: "서울 아파트",
  org_name: "가상기관",
  bid_start_at: "2026-03-01T09:00:00+09:00",
  bid_end_at: "2026-03-02T09:00:00+09:00",
};

describe("필수정보 규칙 경계값", () => {
  it("정상 값은 통과, item_status는 없어도 통과", () => {
    expect(detectRequiredField(GOOD)).toBeNull();
    expect(detectRequiredField({ ...GOOD, item_status: "bidding" })).toBeNull();
  });

  it.each([
    ["항목 없음", { ...GOOD, item_name: undefined }, "item_name", "MISSING"],
    ["null", { ...GOOD, org_name: null }, "org_name", "MISSING"],
    ["공백만", { ...GOOD, item_name: "   " }, "item_name", "MISSING"],
    ["날짜 형식 오류", { ...GOOD, bid_end_at: "2026/03/02" }, "bid_end_at", "BAD_FORMAT"],
    ["시간대 없는 날짜", { ...GOOD, bid_start_at: "2026-03-01T09:00:00" }, "bid_start_at", "BAD_FORMAT"],
    ["물건 번호 형식 오류", { ...GOOD, demo_item_id: "DEMO-12" }, "demo_item_id", "BAD_FORMAT"],
    ["상태값 대문자", { ...GOOD, item_status: "READY" }, "item_status", "BAD_FORMAT"],
  ])("이상징후: %s", (_label, input, field, reason) => {
    expect(detectRequiredField(input)?.problems).toContainEqual({ field, reason });
  });
});

describe("목록·상세 규칙 경계값 (허용 600초)", () => {
  const rec = (fields: Record<string, unknown>, at: number) => ({ fields, collectedAtMs: at });
  const list = rec(GOOD, BASE_MS);

  it.each([
    [599, "compared"],
    [600, "compared"],
    [601, "skipped"],
    [-600, "compared"],
    [-601, "skipped"],
  ])("수집 시간차 %i초 → %s", (offset, outcome) => {
    expect(compareListDetail(list, rec(GOOD, BASE_MS + offset * 1000), WINDOW_SECONDS).outcome).toBe(outcome);
  });

  it("값이 다르면 어떤 필드가 다른지 알려 준다", () => {
    const result = compareListDetail(list, rec({ ...GOOD, org_name: "다른기관" }, BASE_MS), WINDOW_SECONDS);
    expect(result.outcome === "compared" && result.finding?.diffs.map((d) => d.field)).toEqual(["org_name"]);
  });

  it("진행상태만 다른 것은 정상이다", () => {
    const result = compareListDetail(rec({ ...GOOD, item_status: "ready" }, BASE_MS), rec({ ...GOOD, item_status: "closed" }, BASE_MS), WINDOW_SECONDS);
    expect(result.outcome === "compared" && result.finding).toBeNull();
  });

  it("한쪽이 없으면 비교하지 않고 사유를 남긴다", () => {
    expect(compareListDetail(list, null, WINDOW_SECONDS)).toMatchObject({ outcome: "skipped", reason: "NO_COUNTERPART" });
  });
});

describe("DEMO 160건 전체 채점 (규칙 3개)", () => {
  const results = DEMO_SCENARIOS.map((s) => ({ s, got: detectItem(toInput(s), WINDOW_SECONDS) }));

  it("160건 모두 정답표와 같다: 규칙 판정과 목록·상세 비교 결과", () => {
    const wrong = results
      .filter(({ s, got }) => {
        const outcome = got.listDetail.outcome === "compared" ? "compared" : `skipped:${got.listDetail.reason}`;
        return JSON.stringify(got.rules) !== JSON.stringify([...s.expected.rules].sort()) || outcome !== s.expected.listDetail;
      })
      .map(({ s }) => s.id);
    expect(wrong).toEqual([]);
  });

  it("요약표 출력 (정답 / 찾음)", () => {
    const rows = (["DATE_ORDER", "REQUIRED_FIELD", "LIST_DETAIL_MISMATCH"] as const).map((rule) => ({
      규칙: rule,
      정답: DEMO_SCENARIOS.filter((s) => s.expected.rules.includes(rule)).length,
      찾음: results.filter(({ got }) => got.rules.includes(rule)).length,
      놓침: results.filter(({ s, got }) => s.expected.rules.includes(rule) && !got.rules.includes(rule)).length,
      오탐: results.filter(({ s, got }) => !s.expected.rules.includes(rule) && got.rules.includes(rule)).length,
    }));
    console.table(rows);
    for (const row of rows) expect([row.놓침, row.오탐]).toEqual([0, 0]);
    expect(results.filter(({ got }) => got.rules.length === 0)).not.toHaveLength(0); // 정상 물건은 아무것도 안 걸린다
  });
});

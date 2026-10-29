// 탐지 근거·원본 값 지문 시험 (PLAN 작업 23): 값이 같으면 같은 지문, 규칙이 읽는 값이 바뀌면 다른 지문
import { describe, expect, it } from "vitest";
import { buildDetectionEvidence, buildEmptyResultEvidence } from "@/lib/checks/evidence";
import { compareListDetail } from "@/lib/rules/list-detail";

const GOOD = {
  demo_item_id: "DEMO-0001",
  item_name: "서울 아파트",
  org_name: "가상기관",
  bid_start_at: "2026-03-01T09:00:00+09:00",
  bid_end_at: "2026-03-02T09:00:00+09:00",
  item_status: "bidding",
};
const BASE = Date.parse("2026-03-01T00:00:00Z");
const ld = (list: Record<string, unknown> | null, detail: Record<string, unknown> | null) =>
  compareListDetail(list && { fields: list, collectedAtMs: BASE }, detail && { fields: detail, collectedAtMs: BASE + 60_000 }, 600);

describe("DATE_ORDER 지문", () => {
  const reversed = { ...GOOD, bid_end_at: "2026-02-28T09:00:00+09:00" };

  it("같은 값이면 같은 지문, 키 순서가 달라도 같다", () => {
    const a = buildDetectionEvidence("DATE_ORDER", reversed, null, ld(reversed, null));
    const shuffled = Object.fromEntries(Object.entries(reversed).reverse());
    const b = buildDetectionEvidence("DATE_ORDER", shuffled, null, ld(shuffled, null));
    expect(a.valueHash).toBe(b.valueHash);
    expect(a.valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("규칙이 읽는 값(종료일시)이 바뀌면 지문이 달라진다", () => {
    const a = buildDetectionEvidence("DATE_ORDER", reversed, null, ld(reversed, null));
    const changed = { ...reversed, bid_end_at: "2026-02-27T09:00:00+09:00" };
    expect(buildDetectionEvidence("DATE_ORDER", changed, null, ld(changed, null)).valueHash).not.toBe(a.valueHash);
  });

  it("규칙이 읽지 않는 값(물건명)이 바뀌어도 지문은 그대로다", () => {
    const a = buildDetectionEvidence("DATE_ORDER", reversed, null, ld(reversed, null));
    const other = { ...reversed, item_name: "다른 이름" };
    expect(buildDetectionEvidence("DATE_ORDER", other, null, ld(other, null)).valueHash).toBe(a.valueHash);
  });

  it("근거에 어떤 값 때문에 걸렸는지가 담긴다", () => {
    const { evidence } = buildDetectionEvidence("DATE_ORDER", reversed, null, ld(reversed, null));
    expect(evidence).toMatchObject({ rule: "DATE_ORDER", findings: { list: { gapSeconds: 86_400 }, detail: null } });
  });
});

describe("규칙마다 지문이 다르다", () => {
  it("같은 물건이라도 규칙이 다르면 지문이 다르다", () => {
    const bad = { ...GOOD, item_name: "" };
    const listDetail = ld(bad, bad);
    expect(buildDetectionEvidence("REQUIRED_FIELD", bad, bad, listDetail).valueHash).not.toBe(buildDetectionEvidence("DATE_ORDER", bad, bad, listDetail).valueHash);
  });
});

describe("REQUIRED_FIELD · LIST_DETAIL_MISMATCH 근거", () => {
  it("필수정보: 어느 필드가 왜 문제인지 담긴다", () => {
    const bad = { ...GOOD, item_name: "  " };
    const { evidence } = buildDetectionEvidence("REQUIRED_FIELD", bad, null, ld(bad, null));
    expect(evidence).toMatchObject({ rule: "REQUIRED_FIELD", problems: { list: [{ field: "item_name", reason: "MISSING" }] } });
  });

  it("목록·상세: 다른 필드와 값, 수집 시각 차이(초)가 담긴다", () => {
    const detail = { ...GOOD, org_name: "다른기관" };
    const { evidence } = buildDetectionEvidence("LIST_DETAIL_MISMATCH", GOOD, detail, ld(GOOD, detail));
    expect(evidence).toMatchObject({ gapSeconds: 60, diffs: [{ field: "org_name", list: "가상기관", detail: "다른기관" }] });
  });

  it("목록·상세: 상세 쪽 값이 바뀌어도 지문이 달라진다", () => {
    const d1 = { ...GOOD, org_name: "다른기관" };
    const d2 = { ...GOOD, org_name: "또 다른기관" };
    expect(buildDetectionEvidence("LIST_DETAIL_MISMATCH", GOOD, d1, ld(GOOD, d1)).valueHash).not.toBe(buildDetectionEvidence("LIST_DETAIL_MISMATCH", GOOD, d2, ld(GOOD, d2)).valueHash);
  });

  it("아주 긴 값은 근거에서 잘라 담는다 (DB 근거 크기 제한 보호)", () => {
    const long = { ...GOOD, org_name: "가".repeat(5000) };
    const { evidence } = buildDetectionEvidence("LIST_DETAIL_MISMATCH", GOOD, long, ld(GOOD, long));
    expect(JSON.stringify(evidence).length).toBeLessThan(2000);
  });
});

describe("EMPTY_RESULT", () => {
  it("API 이름으로 근거와 지문을 만든다", () => {
    const a = buildEmptyResultEvidence("demo-list");
    expect(a.evidence).toEqual({ rule: "EMPTY_RESULT", endpoint: "demo-list", recordCount: 0 });
    expect(a.valueHash).toBe(buildEmptyResultEvidence("demo-list").valueHash);
    expect(a.valueHash).not.toBe(buildEmptyResultEvidence("demo-detail").valueHash);
  });
});

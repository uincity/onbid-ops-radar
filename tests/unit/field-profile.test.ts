// 출처별 필드 프로필 시험 (PLAN 작업 33): PUBLIC(온비드 부록 A) 규칙 적용과 날짜 형식 경계, 프로필 ↔ 설정값 일치
import { describe, expect, it } from "vitest";
import { detectDateOrder } from "@/lib/rules/date-order";
import { detectRequiredField } from "@/lib/rules/required-fields";
import { compareListDetail } from "@/lib/rules/list-detail";
import { detectItem } from "@/lib/rules/detect-item";
import { DEMO_PROFILE, PUBLIC_PROFILE } from "@/lib/rules/field-profile";
import { parseOnbidDateTime } from "@/lib/rules/iso-datetime";
import { DEFAULT_SETTING_VALUES } from "@/lib/settings/schema";

const GOOD = {
  cltrMngNo: "2024-1100-084555",
  pbctCdtnNo: "3621804",
  onbidCltrNm: "서울특별시 송파구 석촌동 242-15 대지",
  orgNm: "한국자산관리공사",
  cltrBidBgngDt: "202605180900",
  cltrBidEndDt: "202605201700",
  pbctStatCd: "0002",
};

describe("parseOnbidDateTime (yyyyMMddHHmm, 한국 시각)", () => {
  it("한국 시각을 순간으로 읽는다: 202603010900 KST = 2026-03-01T00:00Z", () => {
    expect(parseOnbidDateTime("202603010900")).toBe(Date.parse("2026-03-01T00:00:00Z"));
  });

  it("자정·하루 끝 경계: 0000과 2359는 올바르고, 2400·0060은 아니다", () => {
    expect(parseOnbidDateTime("202603010000")).not.toBeNull();
    expect(parseOnbidDateTime("202603012359")).not.toBeNull();
    expect(parseOnbidDateTime("202603012400")).toBeNull();
    expect(parseOnbidDateTime("202603010060")).toBeNull();
  });

  it.each([
    ["11자리", "20260301090"],
    ["13자리", "2026030109000"],
    ["14자리(초 포함)", "20260301090000"],
    ["존재하지 않는 날짜", "202602300900"],
    ["13월", "202613010900"],
    ["숫자가 아님", "2026-03-01 09:00"],
    ["빈 문자열", ""],
    ["숫자 타입", 202603010900],
    ["null", null],
  ])("올바르지 않은 값은 null: %s", (_label, value) => {
    expect(parseOnbidDateTime(value)).toBeNull();
  });
});

describe("PUBLIC 프로필로 규칙 적용", () => {
  it("날짜 정합성: 종료가 시작보다 1분 빠르면 이상, 같으면 정상, 1분 늦으면 정상", () => {
    expect(detectDateOrder({ ...GOOD, cltrBidBgngDt: "202605180900", cltrBidEndDt: "202605180859" }, PUBLIC_PROFILE)?.gapSeconds).toBe(60);
    expect(detectDateOrder({ ...GOOD, cltrBidEndDt: GOOD.cltrBidBgngDt }, PUBLIC_PROFILE)).toBeNull();
    expect(detectDateOrder({ ...GOOD, cltrBidEndDt: "202605180901" }, PUBLIC_PROFILE)).toBeNull();
  });

  it("날짜 정합성: 형식이 틀린 날짜는 판단하지 않는다 (필수정보 규칙의 몫)", () => {
    expect(detectDateOrder({ ...GOOD, cltrBidEndDt: "2026-05-18" }, PUBLIC_PROFILE)).toBeNull();
  });

  it("같은 입력도 프로필이 다르면 다르게 읽는다 (DEMO 프로필로는 PUBLIC 날짜를 판단하지 못한다)", () => {
    const reversed = { ...GOOD, cltrBidEndDt: "202605180859" };
    expect(detectDateOrder(reversed, PUBLIC_PROFILE)).not.toBeNull();
    expect(detectDateOrder(reversed, DEMO_PROFILE)).toBeNull();
  });

  it("필수정보: 정상 값은 통과 (물건관리번호는 형식을 따지지 않고 값이 있는지만 본다)", () => {
    expect(detectRequiredField(GOOD, PUBLIC_PROFILE)).toBeNull();
    expect(detectRequiredField({ ...GOOD, cltrMngNo: "임의의-번호" }, PUBLIC_PROFILE)).toBeNull();
    expect(detectRequiredField({ ...GOOD, pbctStatCd: undefined }, PUBLIC_PROFILE)).toBeNull(); // 상태는 필수가 아니다
  });

  it.each([
    ["물건관리번호 없음", { ...GOOD, cltrMngNo: undefined }, "cltrMngNo", "MISSING"],
    ["공매조건번호 공백", { ...GOOD, pbctCdtnNo: "  " }, "pbctCdtnNo", "MISSING"],
    ["물건명 null", { ...GOOD, onbidCltrNm: null }, "onbidCltrNm", "MISSING"],
    ["공고기관 없음", { ...GOOD, orgNm: undefined }, "orgNm", "MISSING"],
    ["시작일시 형식 오류", { ...GOOD, cltrBidBgngDt: "2026-05-18" }, "cltrBidBgngDt", "BAD_FORMAT"],
    ["종료일시 11자리", { ...GOOD, cltrBidEndDt: "20260520170" }, "cltrBidEndDt", "BAD_FORMAT"],
    ["종료일시 존재하지 않는 날짜", { ...GOOD, cltrBidEndDt: "202602300900" }, "cltrBidEndDt", "BAD_FORMAT"],
  ])("필수정보 이상: %s", (_label, input, field, reason) => {
    expect(detectRequiredField(input, PUBLIC_PROFILE)?.problems).toContainEqual({ field, reason });
  });

  it("목록·상세: 입찰시작이 표기만 다르고 같은 순간이면 같다, 진행상태만 달라도 정상이다", () => {
    const at = (fields: Record<string, unknown>, ms: number) => ({ fields, collectedAtMs: ms });
    const result = compareListDetail(at(GOOD, 0), at({ ...GOOD, pbctStatCd: "0003" }, 5_000), 600, PUBLIC_PROFILE);
    expect(result.outcome === "compared" && result.finding).toBeNull();
  });

  it("목록·상세: 물건명이 다르면 그 필드를 알려 주고, 600초를 넘으면 비교하지 않는다", () => {
    const at = (fields: Record<string, unknown>, ms: number) => ({ fields, collectedAtMs: ms });
    const different = compareListDetail(at(GOOD, 0), at({ ...GOOD, onbidCltrNm: "다른 물건" }, 600_000), 600, PUBLIC_PROFILE);
    expect(different.outcome === "compared" && different.finding?.diffs.map((d) => d.field)).toEqual(["onbidCltrNm"]);
    expect(compareListDetail(at(GOOD, 0), at(GOOD, 601_000), 600, PUBLIC_PROFILE)).toMatchObject({ outcome: "skipped", reason: "WINDOW_EXCEEDED" });
  });

  it("물건 1건 전체 판정: 정상은 아무것도 안 걸리고, 날짜 역전 + 물건명 불일치는 두 규칙이 걸린다", () => {
    const at = (fields: Record<string, unknown>) => ({ fields, collectedAtMs: 0 });
    expect(detectItem({ list: at(GOOD), detail: at(GOOD) }, 600, PUBLIC_PROFILE).rules).toEqual([]);
    const bad = detectItem({ list: at({ ...GOOD, cltrBidEndDt: "202605180859" }), detail: at({ ...GOOD, onbidCltrNm: "다름", cltrBidEndDt: "202605180859" }) }, 600, PUBLIC_PROFILE);
    expect(bad.rules).toEqual(["DATE_ORDER", "LIST_DETAIL_MISMATCH"]);
  });
});

describe("프로필의 필드 목록은 설정값(PRD 5-5)의 기본값과 같다", () => {
  for (const profile of [DEMO_PROFILE, PUBLIC_PROFILE]) {
    it(`${profile.source}: 필수 · 비교 · 제외 필드`, () => {
      expect([...profile.requiredFields]).toEqual(DEFAULT_SETTING_VALUES.required_fields[profile.source]);
      expect([...profile.compareFields]).toEqual(DEFAULT_SETTING_VALUES.compare_fields[profile.source]);
      expect([...profile.excludedFields]).toEqual(DEFAULT_SETTING_VALUES.excluded_fields[profile.source]);
    });
  }

  it("비교 필드와 제외 필드가 겹치지 않는다", () => {
    for (const profile of [DEMO_PROFILE, PUBLIC_PROFILE]) {
      expect(profile.compareFields.filter((f) => profile.excludedFields.includes(f))).toEqual([]);
    }
  });
});

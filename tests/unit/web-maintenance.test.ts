// 계획 점검 창 순수 판정·입력 검사 시험 (W15)
import { describe, expect, it } from "vitest";
import {
  isEffectiveWindow, isInsideWindow, kstLocalToIso, overlapsAny, parseWindowInput, windowErrorMessage, windowState, WINDOW_INVALID_TEXT,
  type MaintenanceWindow,
} from "@/lib/web-monitor/maintenance";

const w = (over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  id: 1, targetKey: "onbid-home", startsAt: "2026-11-09T14:00:00Z", endsAt: "2026-11-09T17:00:00Z", reason: "정기 점검", createdAt: "2026-11-05T00:00:00Z", cancelledAt: null, ...over,
});
const at = (iso: string) => new Date(iso);

describe("isInsideWindow — [시작, 종료) 경계", () => {
  const list = [w()];
  it("시작 시각 정확히는 안, 1ms 전은 밖", () => {
    expect(isInsideWindow(list, "onbid-home", at("2026-11-09T14:00:00.000Z"))).toBe(true);
    expect(isInsideWindow(list, "onbid-home", at("2026-11-09T13:59:59.999Z"))).toBe(false);
  });
  it("종료 1ms 전은 안, 종료 시각 정확히는 밖", () => {
    expect(isInsideWindow(list, "onbid-home", at("2026-11-09T16:59:59.999Z"))).toBe(true);
    expect(isInsideWindow(list, "onbid-home", at("2026-11-09T17:00:00.000Z"))).toBe(false);
  });
  it("다른 대상의 창은 보지 않는다", () => {
    expect(isInsideWindow(list, "other", at("2026-11-09T15:00:00Z"))).toBe(false);
  });
  it("시작 전에 취소된 창은 빠지고, 시작한 뒤 취소(종료 시각이 당겨짐)된 창은 당겨진 종료까지만 안이다", () => {
    const before = w({ cancelledAt: "2026-11-08T00:00:00Z" });
    expect(isEffectiveWindow(before)).toBe(false);
    expect(isInsideWindow([before], "onbid-home", at("2026-11-09T15:00:00Z"))).toBe(false);
    const pulled = w({ endsAt: "2026-11-09T15:00:00Z", cancelledAt: "2026-11-09T15:00:00Z" });
    expect(isEffectiveWindow(pulled)).toBe(true);
    expect(isInsideWindow([pulled], "onbid-home", at("2026-11-09T14:59:59.999Z"))).toBe(true);
    expect(isInsideWindow([pulled], "onbid-home", at("2026-11-09T15:00:00Z"))).toBe(false);
  });
  it("창이 이어 붙어 있으면 경계 시각은 다음 창 안이다", () => {
    const two = [w(), w({ id: 2, startsAt: "2026-11-09T17:00:00Z", endsAt: "2026-11-09T19:00:00Z" })];
    expect(isInsideWindow(two, "onbid-home", at("2026-11-09T17:00:00Z"))).toBe(true);
  });
});

describe("windowState", () => {
  it("예정·진행 중·끝남·취소됨", () => {
    expect(windowState(w(), at("2026-11-09T13:59:59Z"))).toBe("upcoming");
    expect(windowState(w(), at("2026-11-09T14:00:00Z"))).toBe("active");
    expect(windowState(w(), at("2026-11-09T17:00:00Z"))).toBe("ended");
    expect(windowState(w({ cancelledAt: "2026-11-08T00:00:00Z" }), at("2026-11-09T15:00:00Z"))).toBe("cancelled");
  });
});

describe("overlapsAny — 이어 붙이기는 겹침이 아니다", () => {
  const list = [w()];
  it("일부 겹침·포함·감쌈은 겹침", () => {
    expect(overlapsAny(list, "onbid-home", "2026-11-09T16:00:00Z", "2026-11-09T18:00:00Z")).toBe(true);
    expect(overlapsAny(list, "onbid-home", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z")).toBe(true);
    expect(overlapsAny(list, "onbid-home", "2026-11-09T13:00:00Z", "2026-11-09T18:00:00Z")).toBe(true);
  });
  it("앞뒤로 이어 붙이거나 다른 대상이거나 취소된 창이면 겹치지 않는다", () => {
    expect(overlapsAny(list, "onbid-home", "2026-11-09T17:00:00Z", "2026-11-09T18:00:00Z")).toBe(false);
    expect(overlapsAny(list, "onbid-home", "2026-11-09T12:00:00Z", "2026-11-09T14:00:00Z")).toBe(false);
    expect(overlapsAny(list, "other", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z")).toBe(false);
    expect(overlapsAny([w({ cancelledAt: "2026-11-08T00:00:00Z" })], "onbid-home", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z")).toBe(false);
  });
});

describe("kstLocalToIso — KST 입력에 +09:00만 붙인다 (시각 변환은 여기 한 곳)", () => {
  it("정상 입력: 9시간만 밀린다", () => {
    expect(kstLocalToIso("2026-11-09T23:00")).toBe("2026-11-09T23:00:00+09:00");
    expect(Date.parse(kstLocalToIso("2026-11-09T23:00")!)).toBe(Date.parse("2026-11-09T14:00:00Z"));
  });
  it("없는 날짜·시각·모양은 null", () => {
    for (const bad of ["2026-02-30T10:00", "2026-13-01T10:00", "2026-11-09T24:00", "2026-11-09T10:60", "2026-11-09 10:00", "2026-11-09T10:00:00", "", "abc"]) expect(kstLocalToIso(bad), bad).toBeNull();
  });
  it("윤일은 윤년에만 허용", () => {
    expect(kstLocalToIso("2028-02-29T00:00")).toBe("2028-02-29T00:00:00+09:00");
    expect(kstLocalToIso("2027-02-29T00:00")).toBeNull();
  });
});

describe("parseWindowInput", () => {
  const now = at("2026-11-05T03:00:00Z"); // KST 12:00
  const ok = { targetKey: "onbid-home", start: "2026-11-09T23:00", end: "2026-11-10T02:00", reason: " 시스템 정기 점검 " };
  const parse = (over: Partial<typeof ok> = {}, maxHours = 168) => parseWindowInput({ ...ok, ...over }, { now, maxHours });

  it("정상: 사유는 앞뒤 공백을 지우고 시각에 +09:00이 붙는다", () => {
    expect(parse()).toEqual({ ok: true, value: { targetKey: "onbid-home", startsAt: "2026-11-09T23:00:00+09:00", endsAt: "2026-11-10T02:00:00+09:00", reason: "시스템 정기 점검" } });
  });
  it("종료 ≤ 시작, 이미 끝난 창, 잘못된 시각은 같은 안내", () => {
    for (const bad of [{ end: ok.start }, { end: "2026-11-09T22:00" }, { start: "2026-11-01T10:00", end: "2026-11-01T11:00" }, { start: "x" }, { end: "2026-02-30T00:00" }]) {
      expect(parse(bad)).toEqual({ ok: false, message: WINDOW_INVALID_TEXT });
    }
  });
  it("지금 진행 중인(시작은 과거, 종료는 미래) 창은 허용", () => {
    expect(parse({ start: "2026-11-05T11:00", end: "2026-11-05T13:00" }).ok).toBe(true);
  });
  it("사유 1~200자 경계", () => {
    expect(parse({ reason: "" }).ok).toBe(false);
    expect(parse({ reason: "   " }).ok).toBe(false);
    expect(parse({ reason: "가".repeat(200) }).ok).toBe(true);
    expect(parse({ reason: "가".repeat(201) }).ok).toBe(false);
  });
  it("길이 경계: 최대 시간 정확히는 허용, 1분 넘으면 거부(길이 안내)", () => {
    expect(parse({ start: "2026-11-09T00:00", end: "2026-11-10T00:00" }, 24).ok).toBe(true);
    expect(parse({ start: "2026-11-09T00:00", end: "2026-11-10T00:01" }, 24)).toEqual({ ok: false, message: "점검 창은 최대 24시간까지 등록할 수 있습니다." });
  });
  it("대상 키 모양이 틀리거나 값이 문자열이 아니면 거부", () => {
    expect(parse({ targetKey: "Bad Key" }).ok).toBe(false);
    expect(parseWindowInput({ targetKey: null, start: 1, end: {}, reason: [] }, { now, maxHours: 168 }).ok).toBe(false);
  });
});

describe("windowErrorMessage — DB 오류 원문은 가린다", () => {
  it("우리 코드는 한국어로, 그 밖은 일반 문구로", () => {
    expect(windowErrorMessage("WINDOW_OVERLAP")).toContain("이미 등록된 점검 창");
    expect(windowErrorMessage("FORBIDDEN")).toContain("팀장만");
    expect(windowErrorMessage("WINDOW_NOT_FOUND")).toBe("해당 점검 창을 찾을 수 없습니다.");
    expect(windowErrorMessage("duplicate key value violates ... secret")).toBe("처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    expect(windowErrorMessage(null)).toBe("처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    expect(windowErrorMessage("toString")).toBe("처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  });
});

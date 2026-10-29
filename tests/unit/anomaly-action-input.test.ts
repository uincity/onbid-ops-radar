// 이상징후 처리 입력 검사(lib/anomalies/action-input.ts)와 사유 글자 수(reason-length.ts) 단위 테스트
// 사유 10자 경계(9자/10자), 공백·전각 공백, 잘못된 id·uuid·판정, 길이 상한, 화면에 보일 버튼 규칙을 채점한다.
import { describe, expect, it } from "vitest";
import { availableActions, parseActionInput, toRpcCall, type ParsedAction } from "@/lib/anomalies/action-input";
import { REASON_MAX_LENGTH, countReasonChars, isReasonLongEnough } from "@/lib/anomalies/reason-length";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const base = { id: "7", expectedVersion: "3" };
const TEN = "가나다라마바사아자차"; // 10자
const NINE = "가나다라마바사아자"; // 9자

describe("countReasonChars: 공백 제외 글자 수 (DB와 같은 규칙)", () => {
  it("스페이스·탭·줄바꿈·전각 공백은 세지 않는다", () => {
    expect(countReasonChars("a b\tc\nd\r\ne　f")).toBe(6);
    expect(countReasonChars(" \t\n　  ")).toBe(0);
  });
  it("한글은 한 글자를 1로 센다", () => {
    expect(countReasonChars("가 나 다")).toBe(3);
    expect(countReasonChars(TEN)).toBe(10);
  });
  it("경계: 9자는 부족, 10자는 충분 (공백이 섞여도 글자만 센다)", () => {
    expect(isReasonLongEnough(NINE)).toBe(false);
    expect(isReasonLongEnough(`${NINE}          `)).toBe(false); // 공백으로 길이를 채울 수 없다
    expect(isReasonLongEnough(TEN)).toBe(true);
    expect(isReasonLongEnough(` ${NINE.slice(0, 5)} \n ${NINE.slice(5)}가 `)).toBe(true);
  });
});

describe("parseActionInput: 입력 검사", () => {
  it("검토 시작: id와 버전만 있으면 통과, 문자열 숫자도 숫자로 바꾼다", () => {
    const r = parseActionInput({ intent: "start_review", ...base });
    expect(r).toEqual({ ok: true, action: { intent: "start_review", id: 7, expectedVersion: 3 } });
  });

  it("알 수 없는 동작·빠진 동작은 거부", () => {
    expect(parseActionInput({ ...base }).ok).toBe(false);
    expect(parseActionInput({ intent: "delete", ...base }).ok).toBe(false);
  });

  it("잘못된 id(0·음수·소수·글자·빈 값)는 거부", () => {
    for (const id of ["0", "-1", "1.5", "abc", ""]) {
      const r = parseActionInput({ intent: "start_review", id, expectedVersion: "1" });
      expect(r.ok, `id=${id}`).toBe(false);
    }
  });

  it("잘못된 버전(0·글자)은 거부", () => {
    expect(parseActionInput({ intent: "start_review", id: "1", expectedVersion: "0" }).ok).toBe(false);
    expect(parseActionInput({ intent: "start_review", id: "1", expectedVersion: "x" }).ok).toBe(false);
  });

  it("배정: uuid 모양이 아니면 거부, 맞으면 통과", () => {
    expect(parseActionInput({ intent: "assign", ...base, assigneeId: "not-a-uuid" }).ok).toBe(false);
    expect(parseActionInput({ intent: "assign", ...base }).ok).toBe(false);
    expect(parseActionInput({ intent: "assign", ...base, assigneeId: UUID }).ok).toBe(true);
  });

  it("판정 저장: 허용된 판정 값만 통과", () => {
    for (const verdict of ["undetermined", "confirmed_issue", "false_positive"]) {
      expect(parseActionInput({ intent: "save_verdict", ...base, verdict }).ok, verdict).toBe(true);
    }
    expect(parseActionInput({ intent: "save_verdict", ...base, verdict: "resolved" }).ok).toBe(false);
    expect(parseActionInput({ intent: "save_verdict", ...base }).ok).toBe(false);
  });

  it("사유: 공백만/9자는 REASON_TOO_SHORT, 10자는 통과 (종결 2종과 재개 모두)", () => {
    for (const intent of ["close_resolved", "close_dismissed", "reopen"]) {
      const blank = parseActionInput({ intent, ...base, note: "          \n\t　" });
      expect(blank, intent).toMatchObject({ ok: false, code: "REASON_TOO_SHORT" });
      expect(parseActionInput({ intent, ...base, note: NINE }), intent).toMatchObject({ ok: false, code: "REASON_TOO_SHORT" });
      expect(parseActionInput({ intent, ...base }), intent).toMatchObject({ ok: false }); // 사유 없음
      expect(parseActionInput({ intent, ...base, note: TEN }).ok, intent).toBe(true);
    }
  });

  it("사유 길이 상한: 2000자는 통과, 2001자는 거부", () => {
    expect(parseActionInput({ intent: "reopen", ...base, note: "가".repeat(REASON_MAX_LENGTH) }).ok).toBe(true);
    const over = parseActionInput({ intent: "reopen", ...base, note: "가".repeat(REASON_MAX_LENGTH + 1) });
    expect(over).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("사유의 앞뒤 공백은 정리해서 넘긴다", () => {
    const r = parseActionInput({ intent: "close_resolved", ...base, note: `  ${TEN}  \n` });
    expect(r.ok && r.action.intent === "close_resolved" ? r.action.note : null).toBe(TEN);
  });
});

describe("toRpcCall: 어떤 DB 함수를 어떤 인자로 부르나", () => {
  const a = (x: ParsedAction) => toRpcCall(x);
  it("조치 완료는 resolved + confirmed_issue, 정상 판정은 dismissed + false_positive로 짝을 자동으로 맞춘다", () => {
    expect(a({ intent: "close_resolved", id: 1, expectedVersion: 2, note: TEN })).toMatchObject({ fn: "status", toStatus: "resolved", verdict: "confirmed_issue", note: TEN });
    expect(a({ intent: "close_dismissed", id: 1, expectedVersion: 2, note: TEN })).toMatchObject({ fn: "status", toStatus: "dismissed", verdict: "false_positive", note: TEN });
  });
  it("검토 시작·재개는 investigating으로, 재개는 사유를 넘기고 판정은 넘기지 않는다", () => {
    expect(a({ intent: "start_review", id: 1, expectedVersion: 2 })).toEqual({ fn: "status", id: 1, toStatus: "investigating", expectedVersion: 2 });
    const reopen = a({ intent: "reopen", id: 1, expectedVersion: 2, note: TEN });
    expect(reopen).toMatchObject({ fn: "status", toStatus: "investigating", note: TEN });
    expect(reopen).not.toHaveProperty("verdict");
  });
  it("배정과 판정 저장은 각각 전용 함수를 부른다", () => {
    expect(a({ intent: "assign", id: 1, expectedVersion: 2, assigneeId: UUID })).toMatchObject({ fn: "assign", assigneeId: UUID });
    expect(a({ intent: "save_verdict", id: 1, expectedVersion: 2, verdict: "false_positive" })).toMatchObject({ fn: "verdict", verdict: "false_positive" });
  });
});

describe("availableActions: 화면에 보여 줄 조작 (권한 검사가 아닌 화면 편의)", () => {
  const op = { id: "op-1", role: "operator" as const };
  const admin = { id: "ad-1", role: "admin" as const };

  it("운영 담당자 + 담당자 없음: [내가 맡기]만 보이고 처리 버튼은 없다", () => {
    const r = availableActions({ status: "open", assigneeId: null }, op);
    expect(r).toMatchObject({ selfAssign: true, assignPicker: false, startReview: false, verdictAndClose: false, reopen: false });
    expect(r.blockedReason).toBeTruthy();
  });
  it("운영 담당자 + 본인 담당: 상태별 처리 버튼, 맡기기는 숨김", () => {
    expect(availableActions({ status: "open", assigneeId: "op-1" }, op)).toMatchObject({ selfAssign: false, startReview: true, verdictAndClose: false, reopen: false, blockedReason: null });
    expect(availableActions({ status: "investigating", assigneeId: "op-1" }, op)).toMatchObject({ startReview: false, verdictAndClose: true, reopen: false });
    expect(availableActions({ status: "resolved", assigneeId: "op-1" }, op)).toMatchObject({ verdictAndClose: false, reopen: true });
    expect(availableActions({ status: "dismissed", assigneeId: "op-1" }, op)).toMatchObject({ reopen: true });
  });
  it("운영 담당자 + 남의 담당 건: 아무 처리 버튼도 없고 이유를 안내한다", () => {
    const r = availableActions({ status: "investigating", assigneeId: "other" }, op);
    expect(r).toMatchObject({ selfAssign: false, startReview: false, verdictAndClose: false, reopen: false });
    expect(r.blockedReason).toBeTruthy();
  });
  it("팀장: 담당자 상관없이 담당자 선택과 상태별 처리 버튼이 보인다", () => {
    expect(availableActions({ status: "open", assigneeId: null }, admin)).toMatchObject({ assignPicker: true, selfAssign: false, startReview: true, blockedReason: null });
    expect(availableActions({ status: "investigating", assigneeId: "other" }, admin)).toMatchObject({ assignPicker: true, verdictAndClose: true });
    expect(availableActions({ status: "resolved", assigneeId: "other" }, admin)).toMatchObject({ reopen: true });
  });
});

// 이상징후 이력 표시 변환 시험 (PLAN 28번)
import { describe, expect, it } from "vitest";
import { NO_ASSIGNEE, UNKNOWN_USER, toEventView, type EventRow } from "@/lib/anomalies/event-view";
import { EVENT_TYPE_LABEL } from "@/lib/anomalies/labels";

const KIM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const names = new Map([
  [KIM, "김담당"],
  [LEE, "이팀장"],
]);

const row = (over: Partial<EventRow>): EventRow => ({
  id: 1,
  actor_type: "user",
  actor_id: KIM,
  actor_role: "operator",
  event_type: "status_changed",
  from_value: "open",
  to_value: "investigating",
  note: null,
  created_at: "2026-10-29T00:12:30Z",
  ...over,
});

describe("toEventView", () => {
  it("시각은 KST로 보여 준다 (UTC 00:12 → KST 09:12)", () => {
    expect(toEventView(row({}), names).timeText).toBe("2026-10-29 09:12:30");
  });

  it("시각을 읽을 수 없으면 원래 글자를 보여 준다", () => {
    expect(toEventView(row({ created_at: "엉터리" }), names).timeText).toBe("엉터리");
  });

  it("created: 시스템이 미확인 상태로 등록", () => {
    const v = toEventView(row({ actor_type: "system", actor_id: null, actor_role: null, event_type: "created", from_value: null, to_value: "open" }), names);
    expect(v.actorText).toBe("시스템");
    expect(v.typeLabel).toBe("최초 탐지");
    expect(v.changeText).toBe("미확인 상태로 등록");
  });

  it("detected_again: N회 → M회", () => {
    const v = toEventView(row({ actor_type: "system", actor_id: null, actor_role: null, event_type: "detected_again", from_value: "2", to_value: "3" }), names);
    expect(v.changeText).toBe("2회 → 3회");
  });

  it("assigned: uuid를 이름으로, 처음 배정은 담당자 없음에서", () => {
    expect(toEventView(row({ event_type: "assigned", from_value: null, to_value: KIM }), names).changeText).toBe(`${NO_ASSIGNEE} → 김담당`);
    expect(toEventView(row({ event_type: "assigned", from_value: KIM, to_value: LEE }), names).changeText).toBe("김담당 → 이팀장");
  });

  it("assigned: 이름을 찾지 못하면 알 수 없는 사용자 (uuid를 노출하지 않음)", () => {
    const stranger = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const v = toEventView(row({ event_type: "assigned", from_value: stranger, to_value: KIM }), names);
    expect(v.changeText).toBe(`${UNKNOWN_USER} → 김담당`);
    expect(v.changeText).not.toContain(stranger);
  });

  it("이름표가 일반 객체여도, 이상한 키(__proto__)에도 안전하다", () => {
    expect(toEventView(row({ event_type: "assigned", from_value: null, to_value: "__proto__" }), { [KIM]: "김담당" }).changeText).toBe(`${NO_ASSIGNEE} → ${UNKNOWN_USER}`);
    expect(toEventView(row({}), { [KIM]: "김담당" }).actorText).toBe("김담당 (운영 담당자)");
  });

  it("status_changed·verdict_changed는 한국어 라벨", () => {
    expect(toEventView(row({}), names).changeText).toBe("미확인 → 검토 중");
    expect(toEventView(row({ event_type: "verdict_changed", from_value: "undetermined", to_value: "confirmed_issue" }), names).changeText).toBe("미판정 → 실제 이상 확인");
  });

  it("행위자: 이름과 당시 역할 라벨, 사용자 정보가 없으면 알 수 없는 사용자", () => {
    expect(toEventView(row({ actor_id: LEE, actor_role: "admin" }), names).actorText).toBe("이팀장 (팀장)");
    expect(toEventView(row({ actor_id: "zzzz", actor_role: "operator" }), names).actorText).toBe(`${UNKNOWN_USER} (운영 담당자)`);
    expect(toEventView(row({ actor_id: null, actor_role: null }), names).actorText).toBe(UNKNOWN_USER);
  });

  it("사유(note): 공백뿐이면 없는 것으로 본다", () => {
    expect(toEventView(row({ note: "  \n " }), names).note).toBeNull();
    expect(toEventView(row({ note: "원본 시스템에서 수정 확인" }), names).note).toBe("원본 시스템에서 수정 확인");
  });

  it("모든 이벤트 종류에 이름이 있고, 모르는 종류도 멈추지 않는다", () => {
    for (const type of Object.keys(EVENT_TYPE_LABEL)) {
      expect(toEventView(row({ event_type: type, from_value: null, to_value: null }), names).typeLabel).toBe(EVENT_TYPE_LABEL[type]);
    }
    const unknown = toEventView(row({ event_type: "mystery", from_value: "a", to_value: null }), names);
    expect(unknown.typeLabel).toBe("mystery");
    expect(unknown.changeText).toBe("a → -");
    expect(toEventView(row({ event_type: "mystery", from_value: null, to_value: null }), names).changeText).toBeNull();
  });
});

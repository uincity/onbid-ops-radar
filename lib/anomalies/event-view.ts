// 이상징후 이력(anomaly_events) 한 줄을 화면에 보여 줄 한국어 글자로 바꾸는 순수 함수 (PLAN 28번)
// DB 값(open, uuid …)을 "미확인", "김담당" 같은 말로 바꾼다. 모르는 값이 와도 멈추지 않고 원래 값을 보여 준다.
import { EVENT_TYPE_LABEL, STATUS_LABEL, VERDICT_LABEL, labelOf } from "./labels";
import { formatKst } from "@/lib/time";

export type EventRow = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  actor_role: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

export type EventView = {
  id: number;
  timeText: string;
  actorText: string;
  typeLabel: string;
  changeText: string | null; // "무엇에서 무엇으로"
  note: string | null;
};

// 이력에 남는 "당시 역할" 이름 (lib/auth는 서버 전용이라 여기에 따로 둔다)
export const ACTOR_ROLE_LABEL: Record<string, string> = { operator: "운영 담당자", admin: "팀장" };

export const UNKNOWN_USER = "알 수 없는 사용자";
export const NO_ASSIGNEE = "담당자 없음";

export type NameMap = ReadonlyMap<string, string> | Record<string, string>;
const nameOf = (names: NameMap, id: string): string | undefined =>
  names instanceof Map ? names.get(id) : Object.hasOwn(names, id) ? (names as Record<string, string>)[id] : undefined;

function userName(names: NameMap, id: string | null): string {
  if (id == null) return NO_ASSIGNEE;
  return nameOf(names, id) ?? UNKNOWN_USER;
}

function timeText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatKst(d);
}

export function actorText(row: Pick<EventRow, "actor_type" | "actor_id" | "actor_role">, names: NameMap): string {
  if (row.actor_type === "system") return "시스템";
  const name = row.actor_id ? (nameOf(names, row.actor_id) ?? UNKNOWN_USER) : UNKNOWN_USER;
  return row.actor_role ? `${name} (${labelOf(ACTOR_ROLE_LABEL, row.actor_role)})` : name;
}

export function changeText(row: Pick<EventRow, "event_type" | "from_value" | "to_value">, names: NameMap): string | null {
  const { event_type: type, from_value: from, to_value: to } = row;
  switch (type) {
    case "created":
      return `${labelOf(STATUS_LABEL, to)} 상태로 등록`;
    case "detected_again":
      return `${from ?? "?"}회 → ${to ?? "?"}회`;
    case "assigned":
      return `${userName(names, from)} → ${userName(names, to)}`;
    case "status_changed":
      return `${labelOf(STATUS_LABEL, from)} → ${labelOf(STATUS_LABEL, to)}`;
    case "verdict_changed":
      return `${labelOf(VERDICT_LABEL, from)} → ${labelOf(VERDICT_LABEL, to)}`;
    default:
      // 모르는 이벤트 종류: 값이 있으면 그대로 보여 준다
      return from == null && to == null ? null : `${from ?? "-"} → ${to ?? "-"}`;
  }
}

export function toEventView(row: EventRow, names: NameMap): EventView {
  return {
    id: row.id,
    timeText: timeText(row.created_at),
    actorText: actorText(row, names),
    typeLabel: labelOf(EVENT_TYPE_LABEL, row.event_type),
    changeText: changeText(row, names),
    note: row.note && row.note.trim() !== "" ? row.note : null,
  };
}

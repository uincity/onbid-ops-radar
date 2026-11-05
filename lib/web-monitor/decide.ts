// Design Ref: docs/design-homepage-monitoring.md §5.3(상태 전환표·점검 문구 처리표·하루 상한)·§5.4(멱등 키) / PRD FR-4·FR-6·FR-7·FR-9·FR-12 / Plan W10
// 상태 전환 결정 — Next.js·Supabase·네트워크를 모르는 순수 함수. "무엇을 저장·알릴지"만 정하고, 저장은 DB 함수 record_web_transition이 한다.
//   입력: 점검 결과(확정 판정·신호), 현재 상태(버전 포함), 설정, 창 안인지, 시각    출력: 재확인 필요 / 계획 점검 제외 / 새 상태와 해야 할 일 목록(JSON)
// 출력의 `decision`은 record_web_transition(p_decision)이 받는 JSON 모양과 같다(칸 이름은 DB 칸 이름 그대로).
// 규칙의 근거: 정시 점검 1회당 연속 횟수를 1 센다(수동 점검은 이 함수에 들어오지 않는다). 재확인(retry)이 있으면 그 결과가 원래 정시 칸의 평가가 된다.
import { toKstDateString } from "@/lib/time";
import type { WebReason, WebVerdict } from "./classify";
import type { WebSettings } from "./settings";

// ----- 입출력 모양 -----

// DB의 web_target_state 줄과 같은 칸 이름(시각은 ISO 문자열). open_anomaly_id는 DB 함수가 정하므로 결정에는 넣지 않는다.
export type WebTargetStateRow = {
  current_verdict: WebVerdict;
  since: string;
  first_failure_at: string | null;
  incident_no: number;
  incident_open: boolean;
  incident_last_alert_at: string | null;
  ongoing_count: number;
  consecutive_degraded: number;
  degraded_start_run_id: number | null;
  consecutive_unverifiable: number;
  unverifiable_start_run_id: number | null;
  aux_state: Record<string, unknown>; // 프로브별 { count, start_run_id } + 내부 표시(__cert, __suppressed)
  unplanned_since_run_id: number | null;
  unplanned_since: string | null;
  alerts_today: number;
  alerts_today_date: string | null;
  version: number;
};
export type WebStateForDecision = WebTargetStateRow;

export type DecideSettings = Pick<
  WebSettings,
  "realertAfterHours" | "degradedAlertCount" | "unverifiableAlertCount" | "auxAlertCount" | "alertDailyCap" | "unplannedEscalateHours"
>;

export type DecideInput = {
  targetKey: string;
  runId: number; // 이번 평가의 근거가 된 실행(정시 실행 또는 재확인 실행)
  trigger: "scheduled" | "retry"; // 수동 점검은 상태를 바꾸지 않으므로 받지 않는다
  originRunId?: number | null; // 재확인이면 원래 정시 실행
  now: Date; // 이번 실행의 시작 시각(started_at). 창 판정·경과 시간 계산 기준
  verdict: WebVerdict; // 대표 판정 (재확인이면 재확인 실행의 판정)
  primaryReason?: WebReason | null; // 대표 판정을 만든 사유(메시지·근거용)
  maintenanceDetected?: boolean; // 점검 문구·점검 경로가 감지됨 (판정은 FAIL)
  certExpiring: boolean;
  certDaysLeft: number | null;
  aux: readonly { key: string; verdict: WebVerdict }[]; // 보조 확인 판정 (대표 판정에는 들어가지 않음)
  inWindow: boolean; // 점검의 started_at이 등록된 계획 점검 창 [시작, 종료) 안인가
  state: WebStateForDecision | null; // 현재 상태. 첫 정시 점검 전에는 null
  settings: DecideSettings;
};

export type DecidedNotification = {
  key: string;
  kind: "down" | "degraded" | "recovered" | "ongoing" | "cert" | "unverifiable" | "unplanned" | "aux" | "suppressed";
  incident_no: number | null;
  payload: Record<string, unknown>; // 메시지를 만들 재료. 비밀값·응답 본문 없음
};

export type TransitionDecision = {
  state: WebTargetStateRow; // 새 상태 (version은 DB가 올린다)
  detection: { evidence: Record<string, unknown>; value_hash: string } | null;
  recovery: { note: string; incident_no: number } | null;
  notifications: DecidedNotification[];
  confirm: { origin_run_id: number; confirmed_verdict: WebVerdict; flap: boolean };
};

export type DecideResult =
  | { kind: "defer" } // 정시 점검이 실패인데 열린 사건이 없다: 재확인 뒤에 평가한다 (상태·알림 변화 없음)
  | { kind: "planned" | "transition"; plannedMaintenance: boolean; decision: TransitionDecision };

// ----- 도우미 -----

const NORMAL = new Set<WebVerdict>(["PASS_DATA", "PASS_NO_DATA"]);
const UNVERIFIABLE = new Set<WebVerdict>(["UNVERIFIED", "NOT_RUN"]);
export const isNormalFamily = (v: WebVerdict): boolean => NORMAL.has(v);

// 분 단위로 맞춘 경과 분: 정시 점검의 시작 시각은 초 단위로 흔들리므로(05:07:03, 08:07:01) 분 아래는 버려서 "3시간 00분"이 안정적으로 맞게 한다
const minutesBetween = (fromIso: string, to: Date): number => Math.floor(to.getTime() / 60_000) - Math.floor(new Date(fromIso).getTime() / 60_000);

export function initialState(verdict: WebVerdict, now: Date): WebTargetStateRow {
  return {
    current_verdict: verdict,
    since: now.toISOString(),
    first_failure_at: null,
    incident_no: 0,
    incident_open: false,
    incident_last_alert_at: null,
    ongoing_count: 0,
    consecutive_degraded: 0,
    degraded_start_run_id: null,
    consecutive_unverifiable: 0,
    unverifiable_start_run_id: null,
    aux_state: {},
    unplanned_since_run_id: null,
    unplanned_since: null,
    alerts_today: 0,
    alerts_today_date: null,
    version: 0,
  };
}

const formatDuration = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`);

// ----- 결정 -----

export function decide(input: DecideInput): DecideResult {
  const { now, verdict, settings } = input;
  const prev = input.state;
  const flap = input.trigger === "retry" && verdict !== "FAIL"; // 재확인에서 실패가 아니면 일시 실패(또는 저하·검증 불가)로 표시한다
  const confirm = { origin_run_id: input.originRunId ?? input.runId, confirmed_verdict: verdict, flap };
  const normal = isNormalFamily(verdict);
  const incidentOpen = prev?.incident_open === true;

  // 상태 줄이 아직 없으면 이번 판정으로 시작하는 새 상태를 쓴다(복구 알림은 incident_open으로만 정해지므로 오알림이 없다)
  const s: WebTargetStateRow = structuredClone(prev ?? initialState(verdict, now));
  const kstDate = toKstDateString(now);
  if (s.alerts_today_date !== kstDate) {
    s.alerts_today = 0;
    s.alerts_today_date = kstDate;
  }
  const auxState = s.aux_state as Record<string, { count?: number; start_run_id?: number } | string | undefined>;

  // 1. 계획 점검 창 안
  if (input.inWindow && !normal) {
    // 알림·이상징후·가용률 제외, 재확인 안 함. 상태·사건·연속 횟수는 그대로 둔다
    return { kind: "planned", plannedMaintenance: true, decision: { state: s, detection: null, recovery: null, notifications: [], confirm: { ...confirm, flap: false } } };
  }

  // 2. 창 밖의 점검 문구
  let escalatedMaintenance = false;
  if (input.maintenanceDetected && verdict === "FAIL" && !input.inWindow && !incidentOpen) {
    if (s.unplanned_since === null) {
      // 처음 감지: 미등록 점검 알림 1회 (이상징후 없음, 재확인 안 함)
      s.unplanned_since = now.toISOString();
      s.unplanned_since_run_id = input.runId;
      const unplanned: DecidedNotification = {
        key: `unplanned:${input.targetKey}:${input.runId}`,
        kind: "unplanned",
        incident_no: null,
        payload: { run_id: input.runId, reason: input.primaryReason ?? "MAINTENANCE_DETECTED" },
      };
      return capped(s, kstDate, input.targetKey, [unplanned], settings, { kind: "transition", plannedMaintenance: false, detection: null, recovery: null, confirm: { ...confirm, flap: false } });
    }
    if (minutesBetween(s.unplanned_since, now) < settings.unplannedEscalateHours * 60) {
      return { kind: "transition", plannedMaintenance: false, decision: { state: s, detection: null, recovery: null, notifications: [], confirm: { ...confirm, flap: false } } };
    }
    escalatedMaintenance = true; // 6시간 넘게 이어짐 → 일반 확정 실패로 승격
  }

  // 3. 재확인이 필요한가: 정시 점검 실패 + 열린 사건 없음 (점검 문구·창 안은 위에서 이미 처리됨)
  if (input.trigger === "scheduled" && verdict === "FAIL" && !incidentOpen && !escalatedMaintenance) {
    return { kind: "defer" };
  }

  // 4. 상태 전환
  const candidates: DecidedNotification[] = [];
  const out: { detection: TransitionDecision["detection"]; recovery: TransitionDecision["recovery"] } = { detection: null, recovery: null };

  const startIncident = (kind: "down" | "degraded") => {
    s.incident_no += 1;
    s.incident_open = true;
    s.first_failure_at = now.toISOString();
    s.incident_last_alert_at = now.toISOString();
    s.ongoing_count = 0;
    out.detection = {
      evidence: { verdict, reason: input.primaryReason ?? null, incident_no: s.incident_no, started_at: now.toISOString(), trigger_run_id: input.runId },
      // 사건 시작 시각이 들어간다: 오탐으로 종결한 이전 건과 같은 값이 되어 새 장애가 억제되는 일을 막는다
      value_hash: `web:${input.targetKey}:${s.incident_no}:${now.toISOString()}`,
    };
    candidates.push({ key: `${kind}:${s.incident_no}`, kind, incident_no: s.incident_no, payload: { verdict, reason: input.primaryReason ?? null, run_id: input.runId } });
  };
  const maybeOngoing = () => {
    if (s.incident_open && s.incident_last_alert_at !== null && minutesBetween(s.incident_last_alert_at, now) >= settings.realertAfterHours * 60) {
      s.ongoing_count += 1;
      s.incident_last_alert_at = now.toISOString();
      candidates.push({
        key: `ongoing:${s.incident_no}:${s.ongoing_count}`,
        kind: "ongoing",
        incident_no: s.incident_no,
        payload: { verdict, minutes: s.first_failure_at ? minutesBetween(s.first_failure_at, now) : null, n: s.ongoing_count },
      });
    }
  };
  const setVerdict = (v: WebVerdict) => {
    if (s.current_verdict !== v) s.since = now.toISOString();
    s.current_verdict = v;
  };
  const resetDegraded = () => {
    s.consecutive_degraded = 0;
    s.degraded_start_run_id = null;
  };
  const resetUnverifiable = () => {
    s.consecutive_unverifiable = 0;
    s.unverifiable_start_run_id = null;
  };

  if (normal) {
    if (s.incident_open) {
      const minutes = s.first_failure_at ? minutesBetween(s.first_failure_at, now) : 0;
      // 복구는 창 안에서도 판정대로 처리한다
      out.recovery = { note: `지속 시간 ${formatDuration(minutes)}`, incident_no: s.incident_no };
      candidates.push({ key: `recovered:${s.incident_no}`, kind: "recovered", incident_no: s.incident_no, payload: { minutes, verdict } });
      s.incident_open = false;
      s.ongoing_count = 0;
      s.incident_last_alert_at = null;
      s.first_failure_at = null;
    }
    // 저하 1회만 있고 알림 전에 정상으로 돌아오면 알림·사건 없음
    resetDegraded();
    resetUnverifiable();
    s.unplanned_since = null;
    s.unplanned_since_run_id = null;
    setVerdict(verdict);
  } else if (verdict === "FAIL") {
    resetDegraded();
    resetUnverifiable();
    s.unplanned_since = null;
    s.unplanned_since_run_id = null;
    if (!s.incident_open) {
      startIncident("down");
    } else {
      if (s.current_verdict === "DEGRADED") {
        // 저하(사건) → 확정 실패: 같은 사건에서 장애 감지 (키 down:{사건})
        s.incident_last_alert_at = now.toISOString();
        candidates.push({ key: `down:${s.incident_no}`, kind: "down", incident_no: s.incident_no, payload: { verdict, reason: input.primaryReason ?? null, run_id: input.runId } });
      } else {
        maybeOngoing();
      }
    }
    setVerdict("FAIL");
  } else if (verdict === "DEGRADED") {
    resetUnverifiable();
    s.unplanned_since = null;
    s.unplanned_since_run_id = null;
    if (s.incident_open) {
      // 확정 실패 → 저하: 알림 없음, 사건 유지
      maybeOngoing();
    } else {
      if (s.consecutive_degraded === 0) s.degraded_start_run_id = input.runId;
      s.consecutive_degraded += 1;
      if (s.consecutive_degraded >= settings.degradedAlertCount) {
        startIncident("degraded");
        resetDegraded();
      }
    }
    setVerdict("DEGRADED");
  } else if (UNVERIFIABLE.has(verdict)) {
    resetDegraded();
    s.unplanned_since = null;
    s.unplanned_since_run_id = null;
    if (s.consecutive_unverifiable === 0) s.unverifiable_start_run_id = input.runId;
    s.consecutive_unverifiable += 1;
    if (s.consecutive_unverifiable === settings.unverifiableAlertCount) {
      candidates.push({
        key: `unverifiable:${s.unverifiable_start_run_id}`,
        kind: "unverifiable",
        incident_no: null,
        payload: { count: s.consecutive_unverifiable, verdict, start_run_id: s.unverifiable_start_run_id },
      });
    }
    // 사건 중에는 상태·사건을 유지한다(지속 알림 시계는 계속 간다)
    if (s.incident_open) maybeOngoing();
    else setVerdict(verdict);
  }

  // 5. 별도 신호 (대표 판정과 무관): 인증서 임박, 보조 확인 이상. 창 안(정상 판정)에서는 알리지 않는다
  if (!input.inWindow) {
    if (input.certExpiring) {
      const marker = auxState.__cert;
      if (marker !== kstDate) {
        auxState.__cert = kstDate; // 하루 1회
        candidates.push({ key: `cert:${input.targetKey}:${kstDate}`, kind: "cert", incident_no: null, payload: { days_left: input.certDaysLeft } });
      }
    }
    for (const a of input.aux) {
      const entry = auxState[a.key] as { count?: number; start_run_id?: number } | undefined;
      if (a.verdict === "NOT_RUN") continue; // 점검하지 못한 것은 연속 횟수에 넣지도 지우지도 않는다
      if (a.verdict === "FAIL" || a.verdict === "UNVERIFIED") {
        const count = (entry?.count ?? 0) + 1;
        const start = entry?.start_run_id ?? input.runId;
        auxState[a.key] = { count, start_run_id: start };
        if (count === settings.auxAlertCount) {
          candidates.push({ key: `aux:${input.targetKey}:${a.key}:${start}`, kind: "aux", incident_no: null, payload: { probe: a.key, count, verdict: a.verdict } });
        }
      } else {
        delete auxState[a.key]; // 정상으로 돌아오면 해제 알림 없이 기록만
      }
    }
  }

  if (escalatedMaintenance) {
    // 승격된 사건의 근거에 점검 문구가 이어졌음을 남긴다
    if (out.detection) out.detection.evidence.escalated_from = "MAINTENANCE_DETECTED";
  }

  return capped(s, kstDate, input.targetKey, candidates, settings, { kind: "transition", plannedMaintenance: input.inWindow, detection: out.detection, recovery: out.recovery, confirm });
}

// 하루 알림 상한: 상한 안의 알림만 내보내고, 넘치면 그날의 "알림 억제" 안내를 한 번만 보낸다(안내는 상한에 세지 않는다)
function capped(
  s: WebTargetStateRow,
  kstDate: string,
  targetKey: string,
  candidates: DecidedNotification[],
  settings: DecideSettings,
  rest: { kind: "planned" | "transition"; plannedMaintenance: boolean; detection: TransitionDecision["detection"]; recovery: TransitionDecision["recovery"]; confirm: TransitionDecision["confirm"] },
): DecideResult {
  const auxState = s.aux_state as Record<string, unknown>;
  const notifications: DecidedNotification[] = [];
  const dropped: string[] = [];
  for (const c of candidates) {
    if (s.alerts_today < settings.alertDailyCap) {
      notifications.push(c);
      s.alerts_today += 1;
    } else {
      dropped.push(c.kind);
    }
  }
  if (dropped.length > 0 && auxState.__suppressed !== kstDate) {
    auxState.__suppressed = kstDate;
    notifications.push({ key: `suppressed:${targetKey}:${kstDate}`, kind: "suppressed", incident_no: null, payload: { dropped_kinds: dropped, cap: settings.alertDailyCap } });
  }
  return { kind: rest.kind, plannedMaintenance: rest.plannedMaintenance, decision: { state: s, detection: rest.detection, recovery: rest.recovery, notifications, confirm: rest.confirm } };
}

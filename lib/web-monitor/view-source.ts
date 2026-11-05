// Design Ref: docs/design-homepage-monitoring.md §4.3·§10 / Plan W13 — `/web` 화면이 읽는 데이터의 약속과 DB 줄 → 화면 모델 변환
// 화면은 DB를 직접 모르고 이 약속(WebViewSource)만 안다. 운영에서는 로그인 사용자 권한(RLS)으로 읽는 Supabase 구현(view-supabase.ts)을, 화면 시험에서는
// 메모리 목 구현(view-mock.ts, WEB_MONITOR_STORE=mock)을 쓴다. 조회가 일부 실패해도 화면 전체가 깨지지 않도록 칸(section)별로 성공·실패를 따로 돌려준다.
import type { WebLayer, WebReason, WebVerdict } from "./classify";
import type { WebNotificationRow, WebProbeView, WebRunView, WebStateView } from "./view";

export type Section<T> = { ok: true; data: T } | { ok: false };

export type WebOverview = {
  targetKey: string;
  targetLabel: string;
  settings: Section<{ enabled: boolean; enabledSince: string | null; staleMin: number }>;
  state: Section<WebStateView | null>;
  runs: Section<WebRunView[]>; // 최근 점검(정시·재확인·수동·차단), 판정 줄 포함
  lastGoodFinishedAt: Section<string | null>; // 정시·재확인으로 정상 종료한 마지막 실행의 종료 시각
  notifications: Section<WebNotificationRow[]>; // 최근 7일의 알림 줄(대기·시도)
  anomalyByIncident: Section<Record<number, number>>; // 사건 번호 → 이상징후 번호
};

export type WebBannerInputs = {
  settings: Section<{ enabled: boolean; enabledSince: string | null; staleMin: number }>;
  lastGoodFinishedAt: Section<string | null>;
  notifications: Section<WebNotificationRow[]>;
};

export type WebRunDetail = { run: WebRunView; origin: WebRunView | null; followUps: WebRunView[] };

export interface WebViewSource {
  loadOverview(now: Date, targetKey: string, targetLabel: string): Promise<WebOverview>;
  loadBannerInputs(now: Date, targetKey: string): Promise<WebBannerInputs>;
  /** 점검 1회 상세. 없으면 null. 조회 실패는 예외로 던진다(화면이 "불러오지 못했습니다"로 바꾼다) */
  loadRun(id: number): Promise<WebRunDetail | null>;
}

// ----- DB 줄(snake_case) → 화면 모델 -----
type ProbeRow = {
  layer: WebLayer;
  counts_toward_overall: boolean;
  verdict: WebVerdict;
  reason: WebReason | null;
  http_status: number | null;
  duration_ms: number | null;
  final_url: string | null;
  cert_days_left: number | null;
  detail: Record<string, unknown> | null;
  run_id?: number;
};
export type RunRow = {
  id: number;
  target_key: string;
  trigger: WebRunView["trigger"];
  status: WebRunView["status"];
  slot_at: string | null;
  started_at: string;
  finished_at: string | null;
  origin_run_id: number | null;
  request_count: number;
  overall_verdict: WebVerdict | null;
  confirmed_verdict: WebVerdict | null;
  flap: boolean;
  planned_maintenance: boolean;
};
export const RUN_COLUMNS = "id, target_key, trigger, status, slot_at, started_at, finished_at, origin_run_id, request_count, overall_verdict, confirmed_verdict, flap, planned_maintenance";
export const PROBE_COLUMNS = "run_id, layer, counts_toward_overall, verdict, reason, http_status, duration_ms, final_url, cert_days_left, detail";

export const toProbeView = (p: ProbeRow): WebProbeView => ({
  layer: p.layer,
  countsTowardOverall: p.counts_toward_overall,
  verdict: p.verdict,
  reason: p.reason,
  httpStatus: p.http_status,
  durationMs: p.duration_ms,
  finalUrl: p.final_url,
  certDaysLeft: p.cert_days_left,
  detail: p.detail,
});

export function toRunView(r: RunRow, probes: readonly ProbeRow[]): WebRunView {
  return {
    id: Number(r.id),
    targetKey: r.target_key,
    trigger: r.trigger,
    status: r.status,
    slotAt: r.slot_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    originRunId: r.origin_run_id === null ? null : Number(r.origin_run_id),
    requestCount: r.request_count,
    overall: r.overall_verdict,
    confirmed: r.confirmed_verdict,
    flap: r.flap,
    planned: r.planned_maintenance,
    probes: probes.map(toProbeView),
  };
}

export type StateRow = { current_verdict: WebVerdict; since: string; incident_no: number; incident_open: boolean; open_anomaly_id: number | null };
export const toStateView = (s: StateRow): WebStateView => ({ currentVerdict: s.current_verdict, since: s.since, incidentNo: s.incident_no, incidentOpen: s.incident_open, openAnomalyId: s.open_anomaly_id === null ? null : Number(s.open_anomaly_id) });

export type NotificationDbRow = { key: string; kind: string; target_key: string; attempt: number; status: "queued" | "sent" | "failed"; response_code: number | null; error_class: string | null; created_at: string };
export const toNotificationRow = (n: NotificationDbRow): WebNotificationRow => ({ key: n.key, kind: n.kind, targetKey: n.target_key, attempt: n.attempt, status: n.status, responseCode: n.response_code, errorClass: n.error_class, createdAt: n.created_at });

/** 이상징후 evidence에서 사건 번호를 뽑아 사건 번호 → 이상징후 번호 표를 만든다(같은 사건의 가장 최근 이상징후) */
export function mapAnomaliesByIncident(rows: readonly { id: number; evidence: Record<string, unknown> | null }[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const n = r.evidence && typeof r.evidence.incident_no === "number" ? r.evidence.incident_no : null;
    if (n !== null) out[n] = Number(r.id);
  }
  return out;
}

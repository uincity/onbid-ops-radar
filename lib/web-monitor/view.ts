// Design Ref: docs/design-homepage-monitoring.md §4.2·§4.3·§4.4·§4.8 / Plan W13 — `/web` 화면이 쓰는 값 계산 (순수 함수: Next.js·Supabase·네트워크를 모른다)
// 하는 일: DB에서 읽은 줄 → 화면에 그릴 모델. 24시간 띠 칸, 점검 이력 줄, 알림 기록(시도를 한 줄로), 경고 띠 두 종류의 켜짐 조건.
// 화면 컴포넌트는 이 모델을 받아 그리기만 한다. 그래서 규칙(확인 중·미등록 점검 칸, 띠 조건)을 DB·브라우저 없이 시험할 수 있다.
import { formatKst } from "@/lib/time";
import type { WebLayer, WebReason, WebVerdict } from "./classify";

export const HOUR_MS = 60 * 60 * 1000;
export const NOTIFY_RECOVERY_MINUTES = 15; // 이만큼 지나도 sent가 없으면 "미발송" (발송 흐름의 회수 기준과 같다)

// ----- 화면에 올리는 줄(DB 줄을 화면에 필요한 칸만) -----
export type WebProbeView = {
  layer: WebLayer;
  countsTowardOverall: boolean;
  verdict: WebVerdict;
  reason: WebReason | null;
  httpStatus: number | null;
  durationMs: number | null;
  finalUrl: string | null;
  certDaysLeft: number | null;
  detail: Record<string, unknown> | null;
};

export type WebRunView = {
  id: number;
  targetKey: string;
  trigger: "scheduled" | "retry" | "manual";
  status: "running" | "succeeded" | "partial" | "failed" | "blocked";
  slotAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  originRunId: number | null;
  requestCount: number;
  overall: WebVerdict | null;
  confirmed: WebVerdict | null;
  flap: boolean;
  planned: boolean;
  probes: WebProbeView[];
};

export type WebStateView = {
  currentVerdict: WebVerdict;
  since: string;
  incidentNo: number;
  incidentOpen: boolean;
  openAnomalyId: number | null;
};

export type WebNotificationRow = { key: string; kind: string; targetKey: string; attempt: number; status: "queued" | "sent" | "failed"; responseCode: number | null; errorClass: string | null; createdAt: string };

// ----- 4.8 상태를 쉬운 말로 -----
export type Tone = "green" | "greenSoft" | "amber" | "red" | "gray" | "grayLight" | "blue";
export const VERDICT_VIEW: Record<WebVerdict, { label: string; tone: Tone }> = {
  PASS_DATA: { label: "정상", tone: "green" },
  PASS_NO_DATA: { label: "정상(데이터 없음)", tone: "greenSoft" },
  DEGRADED: { label: "성능 저하", tone: "amber" },
  FAIL: { label: "실패", tone: "red" },
  UNVERIFIED: { label: "확인 불가", tone: "gray" },
  NOT_RUN: { label: "미점검", tone: "grayLight" },
};
export const TRIGGER_LABEL: Record<WebRunView["trigger"], string> = { scheduled: "정시", retry: "재확인", manual: "수동" };
export const RUN_STATUS_LABEL: Record<WebRunView["status"], string> = { running: "실행 중", succeeded: "완료", partial: "일부 완료", failed: "실패", blocked: "차단됨" };
export const LAYER_LABEL: Record<WebLayer, string> = { L1_CONNECT: "L1 접속", L2_HTTP: "L2 HTTP", L3_CONTENT: "L3 내용", AUX_STUB: "보조: 진입 스텁", AUX_QUEUE: "보조: 대기열 설정", L4_FILES: "L4 파일 서버" };
export const NOTIFY_KIND_LABEL: Record<string, string> = {
  down: "🔴 장애 감지",
  degraded: "🟠 성능 저하",
  recovered: "🟢 복구",
  ongoing: "⏳ 장애 지속",
  cert: "🟡 인증서 만료 임박",
  unverifiable: "⚪ 점검 불가 지속",
  unplanned: "🔧 미등록 점검 감지",
  aux: "🟡 보조 점검 이상",
  suppressed: "🔕 알림 억제",
  stale: "⚫ 모니터 정지",
  resumed: "🟢 모니터 재개",
};

// ----- KST 표시 도우미 -----
export const kstDateTime = (iso: string | Date): string => formatKst(new Date(iso)).slice(0, 16); // 2026-11-05 14:07
export const kstHm = (iso: string | Date): string => formatKst(new Date(iso)).slice(11, 16); // 14:07
export const kstHour = (iso: string | Date): string => formatKst(new Date(iso)).slice(11, 13); // 14

export function formatSpan(fromIso: string, to: Date): string {
  const minutes = Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`;
  return `${minutes}분`;
}

// ----- 24시간 띠 -----
export type StripKind = VerdictCell | "checking" | "planned" | "unplanned" | "missing";
type VerdictCell = WebVerdict;
export type StripCell = { slotAt: string; hour: string; kind: StripKind; flap: boolean; label: string; runId: number | null; detail: string };

export const STRIP_LABEL: Record<StripKind, string> = {
  PASS_DATA: "정상", PASS_NO_DATA: "정상(데이터 없음)", DEGRADED: "성능 저하", FAIL: "실패", UNVERIFIED: "확인 불가", NOT_RUN: "미점검",
  checking: "확인 중", planned: "계획 점검", unplanned: "미등록 점검", missing: "기록 없음",
};

const hasMaintenance = (run: WebRunView) => run.probes.some((p) => p.reason === "MAINTENANCE_DETECTED");
const l2Ms = (run: WebRunView) => run.probes.find((p) => p.layer === "L2_HTTP")?.durationMs ?? null;

/** 정시 점검(매시) 24칸. 마지막 칸이 지금이 속한 정시 칸이다. 같은 칸에 정시 실행이 여럿이면(대체 실행 등) 정상 종료된 것을 우선한다 */
export function buildStrip(runs: readonly WebRunView[], now: Date): StripCell[] {
  const currentSlot = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const bySlot = new Map<number, WebRunView>();
  for (const r of runs) {
    if (r.trigger !== "scheduled" || r.status === "blocked" || r.status === "running" || !r.slotAt) continue;
    const slot = new Date(r.slotAt).getTime();
    const prev = bySlot.get(slot);
    if (!prev || (prev.status !== "succeeded" && r.status === "succeeded")) bySlot.set(slot, r);
  }
  const cells: StripCell[] = [];
  for (let i = 23; i >= 0; i--) {
    const slot = currentSlot - i * HOUR_MS;
    const slotAt = new Date(slot).toISOString();
    const hour = kstHour(slotAt);
    const run = bySlot.get(slot);
    if (!run) {
      cells.push({ slotAt, hour, kind: "missing", flap: false, label: STRIP_LABEL.missing, runId: null, detail: i === 0 ? "이번 정시 점검 전입니다" : "이 시간의 점검 기록이 없습니다" });
      continue;
    }
    let kind: StripKind;
    if (run.status === "failed") kind = "NOT_RUN";
    else if (run.planned) kind = "planned";
    else if (hasMaintenance(run)) kind = "unplanned";
    else if (run.confirmed === null && run.overall === "FAIL") kind = "checking"; // 재확인을 기다리는 칸
    else kind = run.confirmed ?? run.overall ?? "NOT_RUN";
    const ms = l2Ms(run);
    cells.push({ slotAt, hour, kind, flap: run.flap, label: STRIP_LABEL[kind], runId: run.id, detail: `${STRIP_LABEL[kind]}${run.flap ? " · 일시 실패(재확인에서 정상)" : ""}${ms !== null ? ` · 응답 ${ms.toLocaleString("ko-KR")}ms` : ""}` });
  }
  return cells;
}

// ----- 점검 이력 한 줄 -----
export type LayerMark = "ok" | "fail" | "warn" | "skip" | "none";
export type HistoryRow = {
  id: number;
  at: string; // KST 표시용
  triggerLabel: string;
  resultLabel: string;
  resultTone: Tone;
  layers: Record<"L1_CONNECT" | "L2_HTTP" | "L3_CONTENT", LayerMark>;
  responseMs: number | null;
  note: string;
};

const markOf = (v: WebVerdict | undefined): LayerMark => (v === undefined ? "none" : v === "PASS_DATA" || v === "PASS_NO_DATA" ? "ok" : v === "DEGRADED" ? "warn" : v === "FAIL" ? "fail" : "skip");

export function historyRow(run: WebRunView): HistoryRow {
  const counting = (layer: WebLayer) => run.probes.find((p) => p.layer === layer && p.countsTowardOverall)?.verdict;
  const shown = run.status === "blocked" ? null : (run.confirmed ?? run.overall);
  const notes: string[] = [];
  if (run.trigger === "manual") notes.push("수동(상태에 반영 안 됨)");
  if (run.planned) notes.push("계획 점검");
  if (run.flap) notes.push("일시 실패 해소");
  if (run.status === "blocked") notes.push("다른 점검이 실행 중이라 건너뜀");
  if (run.status === "failed") notes.push("점검 자체가 실패함");
  if (run.status === "running") notes.push("실행 중");
  const reason = run.probes.find((p) => p.countsTowardOverall && p.reason && p.verdict !== "PASS_DATA" && p.verdict !== "PASS_NO_DATA")?.reason;
  if (reason) notes.push(`사유: ${reason}`);
  return {
    id: run.id,
    at: kstDateTime(run.startedAt),
    triggerLabel: TRIGGER_LABEL[run.trigger],
    resultLabel: shown ? VERDICT_VIEW[shown].label : run.status === "blocked" ? "차단됨" : RUN_STATUS_LABEL[run.status],
    resultTone: shown ? VERDICT_VIEW[shown].tone : "gray",
    layers: { L1_CONNECT: markOf(counting("L1_CONNECT")), L2_HTTP: markOf(counting("L2_HTTP")), L3_CONTENT: markOf(counting("L3_CONTENT")) },
    responseMs: l2Ms(run),
    note: notes.join(" · "),
  };
}

// ----- 알림 기록: 시도를 모아 알림 1건에 한 줄 -----
export type NotificationGroup = {
  key: string;
  kind: string;
  kindLabel: string;
  targetKey: string;
  createdAt: string;
  attempts: number; // 시도 횟수(대기만 있으면 0)
  lastStatus: "queued" | "sent" | "failed";
  lastResponseCode: number | null;
  lastErrorClass: string | null;
  resultLabel: string;
  problem: boolean; // 화면에서 붉게 표시할 알림(발송 실패·미발송)
};

export function groupNotifications(rows: readonly WebNotificationRow[], now: Date): NotificationGroup[] {
  const byKey = new Map<string, WebNotificationRow[]>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  const groups: NotificationGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.attempt - b.attempt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const sent = sorted.some((r) => r.status === "sent");
    const lastStatus = sent ? "sent" : last.status;
    const ageMin = (now.getTime() - new Date(first.createdAt).getTime()) / 60_000;
    const failedOut = !sent && last.status === "failed" && last.attempt >= 3;
    const unsent = !sent && last.status === "queued" && ageMin > NOTIFY_RECOVERY_MINUTES;
    groups.push({
      key,
      kind: first.kind,
      kindLabel: NOTIFY_KIND_LABEL[first.kind] ?? first.kind,
      targetKey: first.targetKey,
      createdAt: first.createdAt,
      attempts: last.attempt,
      lastStatus,
      lastResponseCode: last.responseCode,
      lastErrorClass: last.errorClass,
      resultLabel: sent ? "발송됨" : failedOut ? "발송 실패" : last.status === "failed" ? "재시도 대기" : unsent ? "미발송" : "발송 대기",
      problem: failedOut || unsent,
    });
  }
  return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.key.localeCompare(a.key));
}

// ----- 경고 띠 두 종류 (4.2) -----
export type WebBanner = { id: "stale" | "notify" | "off"; level: "warning" | "info"; title: string; detail: string; href?: string };

/** 띠 ①: 점검 정지. 점검이 꺼져 있으면 띄우지 않는다. 기준 시각 = max(마지막 정상 종료, 점검을 다시 켠 시각) */
export function evaluateStaleBanner(input: { now: Date; enabled: boolean; lastGoodFinishedAt: string | null; enabledSince: string | null; staleMin: number }): WebBanner | null {
  if (!input.enabled || input.lastGoodFinishedAt === null) return null;
  const last = new Date(input.lastGoodFinishedAt).getTime();
  const since = input.enabledSince ? new Date(input.enabledSince).getTime() : 0;
  const base = Math.max(last, since);
  const idleMin = Math.floor((input.now.getTime() - base) / 60_000);
  if (idleMin <= input.staleMin) return null;
  return {
    id: "stale",
    level: "warning",
    title: "홈페이지 점검이 멈춘 것 같습니다",
    detail: `마지막으로 정상 종료된 점검은 ${kstDateTime(input.lastGoodFinishedAt)} KST이고, ${idleMin}분째 새 점검 결과가 없습니다 (기준 ${input.staleMin}분). 스케줄러와 배포 상태를 확인해 주세요.`,
    href: "/web",
  };
}

/** 띠 ②: 알림 미발송·발송 실패. 최근 24시간 안에, 마지막 시도가 실패(3회 모두 실패)이거나 만든 지 15분 넘게 미발송인 알림이 있을 때. 이후 sent가 생기면 꺼진다 */
export function evaluateNotifyBanner(groups: readonly NotificationGroup[], now: Date): WebBanner | null {
  const since = now.getTime() - 24 * HOUR_MS;
  const bad = groups.filter((g) => g.problem && new Date(g.createdAt).getTime() >= since);
  if (bad.length === 0) return null;
  return {
    id: "notify",
    level: "warning",
    title: "홈페이지 알림이 발송되지 않았습니다",
    detail: `최근 24시간 안에 ${bad.length}건의 알림이 발송 실패 또는 미발송 상태입니다. 텔레그램 설정(봇·대화방)과 알림 기록을 확인해 주세요.`,
    href: "/web#web-notifications",
  };
}

export function offBanner(): WebBanner {
  return { id: "off", level: "info", title: "홈페이지 점검이 꺼져 있습니다(설정)", detail: "web_monitor_enabled 설정이 꺼져 있어 점검·재확인·알림이 멈춰 있습니다. 이 화면은 이전 기록만 보여 줍니다." };
}

// ----- 현재 상태 카드 -----
export type StatusCardModel = {
  verdictLabel: string;
  tone: Tone;
  since: string | null; // 지속 계산 기준
  spanText: string | null;
  lastCheckAt: string | null;
  lastResponseMs: number | null;
  certDaysLeft: number | null;
  monitorText: string;
  incident: { no: number; anomalyId: number | null } | null;
  source: "state" | "latest-run" | "none";
};

export function buildStatusCard(input: { now: Date; state: WebStateView | null; runs: readonly WebRunView[]; lastGoodFinishedAt: string | null; staleBanner: WebBanner | null; enabled: boolean }): StatusCardModel {
  const real = input.runs.filter((r) => r.trigger !== "manual" && r.status !== "blocked" && r.status !== "running");
  const latest = [...real].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const certSource = [...input.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).find((r) => r.probes.some((p) => p.certDaysLeft !== null));
  const cert = certSource?.probes.find((p) => p.certDaysLeft !== null)?.certDaysLeft ?? null;
  const verdict = input.state?.currentVerdict ?? latest?.confirmed ?? latest?.overall ?? null;
  const monitorText = !input.enabled
    ? "점검이 꺼져 있습니다"
    : input.staleBanner
      ? "정지 의심 (위 경고 참고)"
      : input.lastGoodFinishedAt
        ? `정상 작동 (마지막 정상 종료 ${kstHm(input.lastGoodFinishedAt)})`
        : "아직 정상 종료된 점검이 없습니다";
  return {
    verdictLabel: verdict ? VERDICT_VIEW[verdict].label : "기록 없음",
    tone: verdict ? VERDICT_VIEW[verdict].tone : "gray",
    since: input.state?.since ?? null,
    spanText: input.state ? formatSpan(input.state.since, input.now) : null,
    lastCheckAt: latest ? latest.startedAt : null,
    lastResponseMs: latest ? l2Ms(latest) : null,
    certDaysLeft: cert,
    monitorText,
    incident: input.state?.incidentOpen ? { no: input.state.incidentNo, anomalyId: input.state.openAnomalyId } : null,
    source: input.state ? "state" : latest ? "latest-run" : "none",
  };
}

// Design Ref: docs/design-homepage-monitoring.md §10(WEB_MONITOR_STORE=mock) / Plan W13 — `/web` 화면 시험용 메모리 목 데이터
// 운영 DB를 건드리지 않고 화면을 시험하려고 쓴다(개발 서버를 WEB_MONITOR_STORE=mock으로 띄울 때만). 현재 시각 기준으로 24시간 시나리오를 만든다:
//   정상 대부분 + 확인 중 1칸 + 일시 실패 1칸(재확인 정상) + 계획 점검 1칸 + 미등록 점검 1칸 + 성능 저하 1칸 + 수동 점검·차단된 실행,
//   알림: 장애 감지(발송됨) · 복구(3회 모두 실패 → 경고 띠) · 인증서(발송됨).
import { base, out, type ProbeResult, type WebVerdict } from "./classify";
import { HOUR_MS, type WebNotificationRow, type WebProbeView, type WebRunView } from "./view";
import type { WebBannerInputs, WebOverview, WebRunDetail, WebViewSource } from "./view-source";

const MIN = 60_000;
const probeView = (p: ProbeResult, detail: Record<string, unknown> | null = null): WebProbeView => ({
  layer: p.layer, countsTowardOverall: p.countsTowardOverall, verdict: p.verdict, reason: p.reason, httpStatus: p.httpStatus, durationMs: p.durationMs, finalUrl: p.finalUrl, certDaysLeft: p.certDaysLeft, detail,
});

function probesFor(kind: "ok" | "fail" | "degraded" | "maintenance", ms: number): WebProbeView[] {
  const l1: ProbeResult = { ...base("L1_CONNECT", true), certDaysLeft: 38 };
  const okL3 = base("L3_CONTENT", true);
  const aux = [{ ...base("AUX_STUB", false), httpStatus: 200, durationMs: 36 }, { ...base("AUX_QUEUE", false), httpStatus: 200, durationMs: 45 }];
  const home = "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
  if (kind === "fail") return [l1, out({ ...base("L2_HTTP", true), httpStatus: 503, durationMs: ms, finalUrl: home }, "FAIL", "HTTP_5XX"), out(base("L3_CONTENT", true), "NOT_RUN", "UPSTREAM_FAILED"), ...aux].map((p) => probeView(p));
  if (kind === "maintenance") return [l1, out({ ...base("L2_HTTP", true), httpStatus: 200, durationMs: ms, finalUrl: home }, "FAIL", "MAINTENANCE_DETECTED"), out(base("L3_CONTENT", true), "NOT_RUN", "UPSTREAM_FAILED"), ...aux].map((p) => probeView(p));
  if (kind === "degraded") return [l1, out({ ...base("L2_HTTP", true), httpStatus: 200, durationMs: ms, finalUrl: home }, "DEGRADED", "SLOW_RESPONSE"), okL3, ...aux].map((p) => probeView(p));
  return [l1, { ...base("L2_HTTP", true), httpStatus: 200, durationMs: ms, finalUrl: home }, okL3, ...aux].map((p) => probeView(p));
}

export function buildMockData(now: Date, targetKey: string) {
  const currentSlot = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const runs: WebRunView[] = [];
  let nextId = 5000;
  const push = (r: Omit<WebRunView, "id" | "targetKey" | "requestCount">): WebRunView => {
    const run: WebRunView = { id: nextId++, targetKey, requestCount: 5, ...r };
    runs.push(run);
    return run;
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  for (let i = 23; i >= 0; i--) {
    const slot = currentSlot - i * HOUR_MS;
    const startedMs = slot + 7 * MIN + 2_000;
    if (startedMs > now.getTime()) continue; // 아직 오지 않은 정시 점검(현재 시각이 :07 전)
    const common = { trigger: "scheduled" as const, slotAt: iso(slot), startedAt: iso(startedMs), finishedAt: iso(startedMs + 1_600), originRunId: null };
    const normal = { ...common, status: "succeeded" as const, overall: "PASS_DATA" as WebVerdict, confirmed: "PASS_DATA" as WebVerdict, flap: false, planned: false, probes: probesFor("ok", 1_100 + (i % 5) * 40) };
    if (i === 3) push({ ...common, status: "succeeded", overall: "FAIL", confirmed: null, flap: false, planned: false, probes: probesFor("fail", 10_000) }); // 재확인 대기(확인 중)
    else if (i === 6) {
      const first = push({ ...common, status: "succeeded", overall: "FAIL", confirmed: "PASS_DATA", flap: true, planned: false, probes: probesFor("fail", 10_000) });
      push({ trigger: "retry", slotAt: null, startedAt: iso(startedMs + 2 * MIN), finishedAt: iso(startedMs + 2 * MIN + 1_500), originRunId: first.id, status: "succeeded", overall: "PASS_DATA", confirmed: null, flap: false, planned: false, probes: probesFor("ok", 1_250) });
    } else if (i === 9) push({ ...common, status: "succeeded", overall: "FAIL", confirmed: "FAIL", flap: false, planned: true, probes: probesFor("maintenance", 900) });
    else if (i === 12) push({ ...common, status: "succeeded", overall: "FAIL", confirmed: "FAIL", flap: false, planned: false, probes: probesFor("maintenance", 900) });
    else if (i === 15) push({ ...common, status: "succeeded", overall: "DEGRADED", confirmed: "DEGRADED", flap: false, planned: false, probes: probesFor("degraded", 4_200) });
    else push(normal);
    if (i === 1) push({ trigger: "manual", slotAt: null, startedAt: iso(slot + 30 * MIN), finishedAt: iso(slot + 30 * MIN + 1_400), originRunId: null, status: "succeeded", overall: "PASS_DATA", confirmed: null, flap: false, planned: false, probes: probesFor("ok", 1_090) });
    if (i === 18) push({ trigger: "scheduled", slotAt: iso(slot), startedAt: iso(slot + 7 * MIN), finishedAt: iso(slot + 7 * MIN), originRunId: null, status: "blocked", overall: null, confirmed: null, flap: false, planned: false, probes: [] });
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id - a.id);

  const good = runs.filter((r) => r.trigger !== "manual" && (r.status === "succeeded" || r.status === "partial")).sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
  const settings = { ok: true as const, data: { enabled: true, enabledSince: iso(now.getTime() - 3 * 24 * HOUR_MS), staleMin: 130 } };
  const mk = (key: string, kind: string, attempt: number, status: WebNotificationRow["status"], createdMs: number, code: number | null = null, cls: string | null = null): WebNotificationRow =>
    ({ key, kind, targetKey, attempt, status, responseCode: code, errorClass: cls, createdAt: iso(createdMs) });
  const notifications: WebNotificationRow[] = [
    mk("down:1", "down", 0, "queued", now.getTime() - 26 * HOUR_MS), mk("down:1", "down", 1, "sent", now.getTime() - 26 * HOUR_MS + 1_000, 200),
    mk("recovered:1", "recovered", 0, "queued", now.getTime() - 5 * HOUR_MS), mk("recovered:1", "recovered", 1, "failed", now.getTime() - 5 * HOUR_MS + 1_000, 500, "http_5xx"),
    mk("recovered:1", "recovered", 2, "failed", now.getTime() - 5 * HOUR_MS + 3_000, 500, "http_5xx"), mk("recovered:1", "recovered", 3, "failed", now.getTime() - 5 * HOUR_MS + 5_000, null, "timeout"),
    mk(`cert:${targetKey}:2026-11-05`, "cert", 0, "queued", now.getTime() - 3 * HOUR_MS), mk(`cert:${targetKey}:2026-11-05`, "cert", 1, "sent", now.getTime() - 3 * HOUR_MS + 1_000, 200),
  ];
  return { runs, good, settings, notifications };
}

export function createMockViewSource(): WebViewSource {
  return {
    async loadBannerInputs(now, targetKey): Promise<WebBannerInputs> {
      const d = buildMockData(now, targetKey);
      return { settings: d.settings, lastGoodFinishedAt: { ok: true, data: d.good?.finishedAt ?? null }, notifications: { ok: true, data: d.notifications } };
    },
    async loadOverview(now, targetKey, targetLabel): Promise<WebOverview> {
      const d = buildMockData(now, targetKey);
      return {
        targetKey,
        targetLabel,
        settings: d.settings,
        state: { ok: true, data: { currentVerdict: "PASS_DATA", since: new Date(now.getTime() - 20 * HOUR_MS).toISOString(), incidentNo: 1, incidentOpen: false, openAnomalyId: null } },
        runs: { ok: true, data: d.runs },
        lastGoodFinishedAt: { ok: true, data: d.good?.finishedAt ?? null },
        notifications: { ok: true, data: d.notifications },
        anomalyByIncident: { ok: true, data: { 1: 123 } },
      };
    },
    async loadRun(id): Promise<WebRunDetail | null> {
      const { runs } = buildMockData(new Date(), "onbid-home");
      const run = runs.find((r) => r.id === id);
      if (!run) return null;
      return { run, origin: runs.find((r) => r.id === run.originRunId) ?? null, followUps: runs.filter((r) => r.originRunId === run.id) };
    },
  };
}

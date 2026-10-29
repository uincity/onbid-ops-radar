// 일일 점검보고서 집계: DB에서 읽은 행 배열 → 보고서 모델 (순수 함수, PRD 5-4)
// 집계 범위는 KST 하루 [00:00, 끝)이고, 끝은 "다음 날 00:00" 또는 "생성 시각 중 빠른 쪽"이다. 끝 시각은 포함하지 않는다.
// 입력 행에 이미 DB가 범위를 걸었더라도, 여기서 한 번 더 범위를 걸러 경계(00:00 포함, 24:00 제외)를 확실히 지킨다.
import { RULE_IDS, STATUSES } from "@/lib/anomalies/labels";
import { kstDayRange } from "@/lib/time";
import { UNRESOLVED_LIMIT, type ReportModel, type UnresolvedRow } from "./model";

export type RunRow = { id: number; status: string; started_at: string };
export type ApiCheckRow = { run_id: number; outcome: string; duration_ms: number };
export type LogRow = { run_id: number | null; code: string; message: string };
export type NewAnomalyRow = { rule_id: string; first_detected_at: string; previous_anomaly_id: number | null };
export type ClosedEventRow = { to_value: string | null; created_at: string };
export type UnresolvedAnomalyRow = {
  id: number;
  rule_id: string;
  item_key: string;
  status: string;
  assignee_name: string | null;
  first_detected_at: string;
  last_detected_at: string;
};

export type AggregateInput = {
  reportDate: string; // KST 날짜
  source: "DEMO" | "PUBLIC";
  generatedAt: Date;
  coversUntil: Date; // 집계 끝(포함하지 않음)
  baselineAt: Date | null;
  runs: RunRow[];
  apiChecks: ApiCheckRow[];
  logs: LogRow[];
  collectedCount: number; // 그날 수집·검사한 데이터 건수 (DB 집계)
  newAnomalies: NewAnomalyRow[];
  closedEvents: ClosedEventRow[];
  statusCounts: Record<string, number>; // 현재 처리상태별 이상징후 수 (DB 집계)
  unresolved: UnresolvedAnomalyRow[]; // open·investigating 전체
  unresolvedLimit?: number;
};

const KEY_MAX = 40;
const NAME_MAX = 20;
const SAMPLE_MAX = 120;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// 인증키가 보고서에 그대로 남지 않게 한다 (reports 테이블도 'servicekey=' 뒤에 값이 오면 거부한다)
const maskKey = (text: string) => text.replace(/servicekey\s*=\s*[^\s&)]*/gi, "serviceKey=***");

const timeOf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function aggregateReport(input: AggregateInput): ReportModel {
  const dayRange = kstDayRange(input.reportDate);
  const startMs = dayRange.start.getTime();
  // 하루를 넘겨 집계하지 않는다
  const endMs = Math.min(input.coversUntil.getTime(), dayRange.end.getTime());
  const inRange = (iso: string) => {
    const t = timeOf(iso);
    return t !== null && t >= startMs && t < endMs;
  };

  // 점검 실행
  const runs = input.runs.filter((r) => inRange(r.started_at));
  const runIds = new Set(runs.map((r) => r.id));
  const runsByStatus: Record<string, number> = {};
  for (const r of runs) runsByStatus[r.status] = (runsByStatus[r.status] ?? 0) + 1;

  // API 호출 (범위 안 실행에 속한 것만)
  const checks = input.apiChecks.filter((c) => runIds.has(c.run_id));
  const outcomeCount = (name: string) => checks.filter((c) => c.outcome === name).length;
  const durations = checks.map((c) => c.duration_ms);
  const api = {
    total: checks.length,
    success: outcomeCount("success"),
    httpError: outcomeCount("http_error"),
    timeout: outcomeCount("timeout"),
    authOrQuota: outcomeCount("auth_or_quota"),
    emptyResult: outcomeCount("empty_result"),
    avgMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    maxMs: durations.length > 0 ? Math.max(...durations) : null,
  };

  // 실행 로그: 코드별로 묶어 건수와 예시 한 줄
  const logGroups = new Map<string, { count: number; sample: string }>();
  for (const log of input.logs) {
    if (log.run_id === null || !runIds.has(log.run_id)) continue;
    const group = logGroups.get(log.code);
    if (group) group.count += 1;
    else logGroups.set(log.code, { count: 1, sample: clip(maskKey(log.message.replace(/\s+/g, " ").trim()), SAMPLE_MAX) });
  }
  const skipReasons = [...logGroups.entries()]
    .map(([code, g]) => ({ code, count: g.count, sample: g.sample }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // 이상징후
  const fresh = input.newAnomalies.filter((a) => inRange(a.first_detected_at));
  const newByRule: Record<string, number> = Object.fromEntries(RULE_IDS.map((id) => [id, 0]));
  for (const a of fresh) newByRule[a.rule_id] = (newByRule[a.rule_id] ?? 0) + 1;

  const closed = input.closedEvents.filter((e) => inRange(e.created_at));
  const resolvedCount = closed.filter((e) => e.to_value === "resolved").length;
  const dismissedCount = closed.filter((e) => e.to_value === "dismissed").length;

  const byStatus: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, input.statusCounts[s] ?? 0]));

  // 미처리: 처음 탐지된 시각이 오래된 순서 (같으면 번호 순)
  const pending = input.unresolved
    .filter((a) => (a.status === "open" || a.status === "investigating") && (timeOf(a.first_detected_at) ?? Infinity) < endMs)
    .sort((a, b) => (timeOf(a.first_detected_at) ?? 0) - (timeOf(b.first_detected_at) ?? 0) || a.id - b.id);
  const limit = Math.max(0, input.unresolvedLimit ?? UNRESOLVED_LIMIT);
  const rows: UnresolvedRow[] = pending.slice(0, limit).map((a) => ({
    id: a.id,
    ruleId: a.rule_id,
    itemKey: clip(a.item_key, KEY_MAX),
    status: a.status,
    assignee: a.assignee_name ? clip(a.assignee_name, NAME_MAX) : null,
    firstDetectedAt: a.first_detected_at,
    lastDetectedAt: a.last_detected_at,
  }));

  const hasActivity = runs.length > 0 || checks.length > 0 || input.collectedCount > 0 || fresh.length > 0 || closed.length > 0;

  return {
    version: 1,
    reportDate: input.reportDate,
    source: input.source,
    generatedAt: input.generatedAt.toISOString(),
    coversUntil: new Date(endMs).toISOString(),
    partialDay: endMs < dayRange.end.getTime(),
    baselineAt: input.baselineAt ? input.baselineAt.toISOString() : null,
    hasActivity,
    api,
    runs: { total: runs.length, byStatus: runsByStatus },
    validation: { collectedCount: input.collectedCount, newByRule },
    anomalies: {
      newCount: fresh.length,
      recurredCount: fresh.filter((a) => a.previous_anomaly_id !== null).length,
      closedCount: closed.length,
      resolvedCount,
      dismissedCount,
      byStatus,
    },
    unresolved: { total: pending.length, omitted: pending.length - rows.length, rows },
    skipReasons,
  };
}

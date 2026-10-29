// 통합 대시보드 숫자 집계 (순수 함수: DB 행 배열 → 화면용 요약). DB·시계에 의존하지 않아 단위 테스트가 쉽다.
// Design Ref: DESIGN §4.3, PRD 5-6
// - 점검 성공/실패와 규칙별 신규 건수는 KST 오늘 [00:00, 24:00) 기준(24:00은 포함하지 않음)
// - 미배정·미처리·상태별 건수는 날짜와 관계없는 "현재" 건수
// 날짜 계산은 lib/time.ts를 쓴다(new Date()로 날짜를 직접 자르지 않는다).
import { RULE_IDS, SOURCES, STATUSES, type RuleId, type Source, type AnomalyStatus } from "@/lib/anomalies/labels";
import { formatKst, kstDayRange, toKstDateString } from "@/lib/time";

// ── 입력: DB에서 읽은 행(필요한 열만) ──
export type RunRow = {
  id: number;
  trigger: string;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
};

export type AnomalyRow = {
  source: string;
  status: string;
  rule_id: string;
  assignee_id: string | null;
  first_detected_at: string;
};

// ── 출력: 화면용 요약 ──
// 모든 수치는 출처별로 나눠 담는다 (PRD 5-6: 모든 수치에 출처 구분)
export type SourceCount = { total: number; DEMO: number; PUBLIC: number };

export const RUN_STATUSES = ["succeeded", "partial", "failed", "blocked", "running"] as const;
export type RunStatusKey = (typeof RUN_STATUSES)[number];

export type RecentRun = {
  id: number;
  trigger: string;
  source: Source;
  status: string;
  startedAt: string; // 화면용 KST "2026-10-29 09:00:12"
};

export type DashboardSummary = {
  date: string; // KST 오늘 "YYYY-MM-DD"
  today: {
    runCount: SourceCount;
    byStatus: Record<RunStatusKey, SourceCount>;
    lastRun: { id: number; status: string; source: Source; startedAt: string } | null;
    // 오늘 마지막으로 끝난 성공 실행의 종료 시각 (점검 기준 시각)
    lastSuccessAt: string | null;
  };
  backlog: {
    unresolved: SourceCount; // open + investigating
    unassigned: SourceCount; // 미처리 중 담당자 없음
    mine: SourceCount | null; // 내 담당 미처리 (userId 없으면 null)
    byStatus: Record<AnomalyStatus, SourceCount>;
  };
  newToday: Record<RuleId, SourceCount>;
  recentRuns: RecentRun[];
  isEmpty: boolean; // 점검 기록도 이상징후도 하나도 없음
};

export const RECENT_RUN_LIMIT = 5;

const emptyCount = (): SourceCount => ({ total: 0, DEMO: 0, PUBLIC: 0 });
const isSource = (v: string): v is Source => (SOURCES as readonly string[]).includes(v);
const isStatus = (v: string): v is AnomalyStatus => (STATUSES as readonly string[]).includes(v);
const isRule = (v: string): v is RuleId => (RULE_IDS as readonly string[]).includes(v);
const isRunStatus = (v: string): v is RunStatusKey => (RUN_STATUSES as readonly string[]).includes(v);

function add(count: SourceCount, source: string) {
  if (!isSource(source)) return; // DB 제약상 없는 값이지만, 모르는 출처는 세지 않는다
  count[source] += 1;
  count.total += 1;
}

// 두 개수를 더한 새 개수 (미처리 = 미확인 + 검토 중)
function sum(a: SourceCount, b: SourceCount): SourceCount {
  return { total: a.total + b.total, DEMO: a.DEMO + b.DEMO, PUBLIC: a.PUBLIC + b.PUBLIC };
}

export function summarizeDashboard(input: {
  now: Date;
  runs: RunRow[]; // 오늘 실행 + 최근 실행이 섞여 있어도 된다(같은 번호는 한 번만 센다)
  anomalies: AnomalyRow[];
  userId: string | null;
}): DashboardSummary {
  const date = toKstDateString(input.now);
  const { start, end } = kstDayRange(date);

  // 같은 번호 중복 제거 + 최신순 (시작 시각이 같으면 번호가 큰 쪽이 먼저)
  const uniqueRuns = [...new Map(input.runs.map((r) => [r.id, r])).values()].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime() || b.id - a.id,
  );

  // ── 오늘 점검 ──
  const runCount = emptyCount();
  const runByStatus = Object.fromEntries(RUN_STATUSES.map((s) => [s, emptyCount()])) as Record<RunStatusKey, SourceCount>;
  let lastRun: DashboardSummary["today"]["lastRun"] = null;
  let lastSuccessAt: Date | null = null;

  for (const run of uniqueRuns) {
    const startedMs = new Date(run.started_at).getTime();
    if (!(startedMs >= start.getTime() && startedMs < end.getTime())) continue; // [00:00, 24:00)
    add(runCount, run.source);
    if (isRunStatus(run.status)) add(runByStatus[run.status], run.source);
    if (lastRun === null && isSource(run.source)) {
      lastRun = { id: run.id, status: run.status, source: run.source, startedAt: formatKst(new Date(run.started_at)) };
    }
    if (run.status === "succeeded" && run.finished_at) {
      const finished = new Date(run.finished_at);
      if (lastSuccessAt === null || finished > lastSuccessAt) lastSuccessAt = finished;
    }
  }

  // ── 이상징후 현재 건수 / 오늘 신규 ──
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, emptyCount()])) as Record<AnomalyStatus, SourceCount>;
  const unassigned = emptyCount();
  const mine = input.userId ? emptyCount() : null;
  const newToday = Object.fromEntries(RULE_IDS.map((r) => [r, emptyCount()])) as Record<RuleId, SourceCount>;

  for (const a of input.anomalies) {
    if (isStatus(a.status)) {
      add(byStatus[a.status], a.source);
      if (a.status === "open" || a.status === "investigating") {
        if (a.assignee_id === null) add(unassigned, a.source);
        if (mine && a.assignee_id === input.userId) add(mine, a.source);
      }
    }
    const firstMs = new Date(a.first_detected_at).getTime();
    if (isRule(a.rule_id) && firstMs >= start.getTime() && firstMs < end.getTime()) add(newToday[a.rule_id], a.source);
  }

  const recentRuns: RecentRun[] = uniqueRuns
    .filter((r) => isSource(r.source))
    .slice(0, RECENT_RUN_LIMIT)
    .map((r) => ({
      id: r.id,
      trigger: r.trigger,
      source: r.source as Source,
      status: r.status,
      startedAt: formatKst(new Date(r.started_at)),
    }));

  return {
    date,
    today: { runCount, byStatus: runByStatus, lastRun, lastSuccessAt: lastSuccessAt ? formatKst(lastSuccessAt) : null },
    backlog: { unresolved: sum(byStatus.open, byStatus.investigating), unassigned, mine, byStatus },
    newToday,
    recentRuns,
    isEmpty: uniqueRuns.length === 0 && input.anomalies.length === 0,
  };
}

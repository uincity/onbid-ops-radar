// 통합 운영 대시보드 화면 (요약 모델을 받아 그리기만 한다. 데이터 읽기는 app/(app)/page.tsx)
// Design Ref: DESIGN §4.3, PRD 5-6 — 좁은 화면에서는 카드가 세로로 쌓인다.
import Link from "next/link";
import { RunStatusBadge, SourceBadge } from "@/components/ui/badges";
import { RULE_IDS, RULE_LABEL, RUN_STATUS_LABEL, RUN_TRIGGER_LABEL, STATUSES, STATUS_LABEL, labelOf } from "@/lib/anomalies/labels";
import { RUN_STATUSES, type DashboardSummary } from "@/lib/dashboard/summary";
import { CountCard, SourceBreakdown } from "./count-card";

const sectionTitle = "text-base font-semibold text-zinc-950 dark:text-zinc-50";
const panel = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

export function DashboardView({ summary, isOperator }: { summary: DashboardSummary; isOperator: boolean }) {
  const { today, backlog, newToday, recentRuns } = summary;
  const maxNew = Math.max(1, ...RULE_IDS.map((r) => newToday[r].total));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">대시보드</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400" data-testid="dashboard-basis">
          기준: {summary.date} 00:00~24:00 KST · 점검 기준 시각 {today.lastSuccessAt ?? "오늘 성공한 점검 없음"}
        </p>
      </header>

      {summary.isEmpty ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300" data-testid="dashboard-empty">
          아직 점검 기록과 이상징후가 없습니다. 매일 09:00(KST) 예약 점검이 실행되거나 팀장이 수동 점검을 실행하면 이곳에 결과가 나타납니다.
        </div>
      ) : null}

      {/* 오늘(KST) 점검 결과 */}
      <section aria-labelledby="today-runs" className={panel} data-testid="today-runs">
        <h2 id="today-runs" className={sectionTitle}>
          오늘(KST) 점검
        </h2>
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              오늘 실행 <strong className="text-xl tabular-nums" data-testid="today-run-total">{today.runCount.total}</strong>건
            </p>
            <SourceBreakdown count={today.runCount} />
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {RUN_STATUSES.map((status) => (
              <li key={status} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{labelOf(RUN_STATUS_LABEL, status)}</span>
                <span className="text-2xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">{today.byStatus[status].total}건</span>
                <SourceBreakdown count={today.byStatus[status]} />
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300" data-testid="last-run">
            마지막 실행:
            {today.lastRun ? (
              <>
                <Link href={`/runs/${today.lastRun.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                  #{today.lastRun.id}
                </Link>
                <RunStatusBadge status={today.lastRun.status} />
                <SourceBadge source={today.lastRun.source} />
                <span className="tabular-nums">{today.lastRun.startedAt}</span>
              </>
            ) : (
              <span>오늘 실행 기록 없음</span>
            )}
          </p>
        </div>
      </section>

      {/* 현재 처리 현황 (누적) */}
      <section aria-labelledby="backlog" data-testid="backlog">
        <h2 id="backlog" className={sectionTitle}>
          현재 처리 현황 (누적)
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CountCard testId="card-unassigned" title="미배정 이상징후" count={backlog.unassigned} href="/anomalies?assignee=unassigned" hint="미확인·검토 중 중 담당자가 없는 건" />
          <CountCard testId="card-unresolved" title="미처리 이상징후" count={backlog.unresolved} href="/anomalies" hint="미확인 + 검토 중 (전체 목록으로 이동)" />
          {isOperator && backlog.mine ? (
            <CountCard testId="card-mine" title="내 담당 미처리" count={backlog.mine} href="/anomalies?assignee=me" hint="내게 배정된 미확인·검토 중 건" />
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STATUSES.map((status) => (
            <CountCard key={status} testId={`card-status-${status}`} title={STATUS_LABEL[status]} count={backlog.byStatus[status]} href={`/anomalies?status=${status}`} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 규칙별 신규 이상징후 (오늘) */}
        <section aria-labelledby="new-by-rule" className={panel} data-testid="new-by-rule">
          <h2 id="new-by-rule" className={sectionTitle}>
            규칙별 신규 이상징후 (오늘)
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {RULE_IDS.map((rule) => (
              <li key={rule}>
                <Link href={`/anomalies?rule=${rule}`} className="flex flex-col gap-1 rounded-lg p-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <span className="flex items-baseline justify-between gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                    <span>{RULE_LABEL[rule]}</span>
                    <strong className="tabular-nums">{newToday[rule].total}건</strong>
                  </span>
                  <span className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                    <span className="block h-2 rounded-full bg-blue-600 dark:bg-blue-400" style={{ width: `${(newToday[rule].total / maxNew) * 100}%` }} />
                  </span>
                  <SourceBreakdown count={newToday[rule]} />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* 최근 점검 실행 5건 */}
        <section aria-labelledby="recent-runs" className={panel} data-testid="recent-runs">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="recent-runs" className={sectionTitle}>
              최근 점검 실행
            </h2>
            <Link href="/runs" className="text-xs font-medium text-blue-700 underline dark:text-blue-300">
              전체 보기
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">점검 실행 기록이 아직 없습니다.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
              {recentRuns.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <Link href={`/runs/${run.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                    #{run.id}
                  </Link>
                  <span className="tabular-nums">{run.startedAt}</span>
                  <span>{labelOf(RUN_TRIGGER_LABEL, run.trigger)}</span>
                  <SourceBadge source={run.source} />
                  <RunStatusBadge status={run.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

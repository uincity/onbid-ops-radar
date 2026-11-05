// Design Ref: docs/design-homepage-monitoring.md §4.3 — 현재 상태 카드 (그리기만 한다)
import Link from "next/link";
import { kstDateTime, type StatusCardModel } from "@/lib/web-monitor/view";
import { panel, ToneBadge } from "./tone";

export function StatusCard({ model, targetLabel }: { model: StatusCardModel; targetLabel: string }) {
  return (
    <section aria-labelledby="web-status-title" className={panel} data-testid="web-status-card">
      <h2 id="web-status-title" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        현재 상태 — {targetLabel}
      </h2>
      <p className="mt-2 flex flex-wrap items-center gap-3">
        <ToneBadge tone={model.tone} testId="web-status-verdict">
          {model.verdictLabel}
        </ToneBadge>
        {model.spanText && model.since ? (
          <span className="text-sm text-zinc-700 dark:text-zinc-300" data-testid="web-status-span">
            지속 {model.spanText} ({kstDateTime(model.since)}부터)
          </span>
        ) : null}
        {model.incident ? (
          model.incident.anomalyId ? (
            <Link href={`/anomalies/${model.incident.anomalyId}`} className="text-sm font-medium text-red-700 underline dark:text-red-300" data-testid="web-status-incident">
              장애 #{model.incident.anomalyId} 보기
            </Link>
          ) : (
            <span className="text-sm text-red-700 dark:text-red-300">장애 진행 중 (사건 {model.incident.no})</span>
          )
        ) : null}
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
        <div className="flex gap-2">
          <dt className="text-zinc-500">마지막 점검</dt>
          <dd data-testid="web-status-last">{model.lastCheckAt ? `${kstDateTime(model.lastCheckAt)} KST` : "아직 없음"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500">응답 시간</dt>
          <dd>{model.lastResponseMs !== null ? `${model.lastResponseMs.toLocaleString("ko-KR")}ms` : "-"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500">인증서 만료까지</dt>
          <dd>{model.certDaysLeft !== null ? `${model.certDaysLeft}일` : "-"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500">모니터</dt>
          <dd data-testid="web-status-monitor">{model.monitorText}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">※ 단일 지점, 1시간 간격 외부 관측입니다. 간격 사이의 짧은 장애는 알 수 없고, 이 결과가 모든 이용자의 상태를 뜻하지 않습니다.</p>
    </section>
  );
}

// Design Ref: docs/design-homepage-monitoring.md §4.3 — 알림 기록 (발송 시도를 모아 알림 1건에 한 줄, 실패·미발송은 붉게)
import Link from "next/link";
import { kstDateTime, type NotificationGroup } from "@/lib/web-monitor/view";
import { panel, sectionTitle } from "./tone";

export function NotificationList({ groups, anomalyByIncident }: { groups: readonly NotificationGroup[]; anomalyByIncident: Record<number, number> }) {
  const incidentOf = (key: string): number | null => {
    const m = /^(?:down|degraded|recovered|ongoing):(\d+)/.exec(key);
    return m ? Number(m[1]) : null;
  };
  return (
    <section id="web-notifications" aria-labelledby="web-notifications-title" className={panel} data-testid="web-notifications">
      <h2 id="web-notifications-title" className={sectionTitle}>
        알림 기록 <span className="text-xs font-normal text-zinc-500">(최근 7일)</span>
      </h2>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="web-notifications-empty">
          최근 7일 동안 보낸 알림이 없습니다.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {groups.map((g) => {
            const incident = incidentOf(g.key);
            const anomalyId = incident !== null ? (anomalyByIncident[incident] ?? null) : null;
            return (
              <li key={g.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid="web-notification" data-problem={g.problem ? "true" : "false"}>
                <span className="whitespace-nowrap text-zinc-600 dark:text-zinc-400">{kstDateTime(g.createdAt)}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{g.kindLabel}</span>
                <span className={g.problem ? "font-semibold text-red-700 dark:text-red-300" : g.lastStatus === "sent" ? "text-emerald-800 dark:text-emerald-300" : "text-zinc-700 dark:text-zinc-300"}>
                  {g.problem ? "⚠ " : ""}
                  {g.resultLabel}
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">시도 {g.attempts}회{g.lastErrorClass && g.lastStatus !== "sent" ? ` (${g.lastErrorClass})` : ""}</span>
                {anomalyId ? (
                  <Link href={`/anomalies/${anomalyId}`} className="text-blue-700 underline dark:text-blue-300">
                    이상징후 #{anomalyId}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

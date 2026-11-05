// Design Ref: docs/design-homepage-monitoring.md §4.3 / Plan W15 — 계획 점검 창 구역 (목록은 모두에게, 등록·취소는 팀장에게만 보인다)
// 지금 진행 중인 창은 강조한다. 시간은 KST. 취소된 창도 줄은 남기고 "취소됨"으로 표시한다.
import { windowState, WINDOW_STATE_LABEL, type MaintenanceWindow, type WindowState } from "@/lib/web-monitor/maintenance";
import { kstDateTime } from "@/lib/web-monitor/view";
import type { Tone } from "@/lib/web-monitor/view";
import { WindowCancelButton, WindowForm } from "./window-form";
import { panel, sectionTitle, ToneBadge } from "./tone";

const STATE_TONE: Record<WindowState, Tone> = { active: "blue", upcoming: "grayLight", ended: "gray", cancelled: "grayLight" };

export function MaintenanceSection({ windows, now, isAdmin, maxHours }: { windows: readonly MaintenanceWindow[]; now: Date; isAdmin: boolean; maxHours: number | null }) {
  // 진행 중 → 예정(가까운 순) → 끝남·취소됨(최근 순)
  const rows = windows.map((w) => ({ w, state: windowState(w, now) }));
  const order: Record<WindowState, number> = { active: 0, upcoming: 1, ended: 2, cancelled: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.state === "upcoming" ? a.w.startsAt.localeCompare(b.w.startsAt) : b.w.startsAt.localeCompare(a.w.startsAt)));

  return (
    <section id="web-windows" aria-labelledby="web-windows-title" className={panel} data-testid="web-windows">
      <h2 id="web-windows-title" className={sectionTitle}>
        계획 점검 창 <span className="text-xs font-normal text-zinc-500">(KST)</span>
      </h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">등록한 시간 안의 점검은 알림·가용률·이상징후에서 제외되고, 띠에 “계획 점검”으로 표시됩니다.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400" data-testid="web-windows-empty">
          등록된 점검 창이 없습니다.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {rows.map(({ w, state }) => (
            <li
              key={w.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2 ${state === "active" ? "-mx-2 rounded-md bg-blue-50 px-2 dark:bg-blue-950/40" : ""}`}
              data-testid="web-window"
              data-state={state}
            >
              <ToneBadge tone={STATE_TONE[state]}>{WINDOW_STATE_LABEL[state]}</ToneBadge>
              <span className={`tabular-nums ${state === "cancelled" ? "text-zinc-500 line-through" : "text-zinc-900 dark:text-zinc-100"}`}>
                {kstDateTime(w.startsAt)} ~ {kstDateTime(w.endsAt)}
              </span>
              <span className="min-w-0 break-words text-zinc-700 dark:text-zinc-300">{w.reason}</span>
              {isAdmin && (state === "active" || state === "upcoming") ? <WindowCancelButton id={w.id} active={state === "active"} /> : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? <WindowForm maxHours={maxHours} /> : <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">창 등록·취소는 팀장만 할 수 있습니다.</p>}
    </section>
  );
}

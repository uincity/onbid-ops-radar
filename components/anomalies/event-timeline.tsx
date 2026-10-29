// 이상징후 이벤트 이력(PLAN 28번): 오래된 것이 위, 최신이 아래. 이력은 추가만 되는 장부라 고치거나 지우는 버튼이 없다.
import { toEventView, type EventRow, type NameMap } from "@/lib/anomalies/event-view";

export function EventTimeline({ events, names, omitted }: { events: EventRow[]; names: NameMap; omitted: number }) {
  return (
    <section aria-labelledby="events-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 id="events-title" className="text-base font-semibold">
        이벤트 이력
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">이력은 추가만 되는 장부입니다. 한번 남은 줄은 고치거나 지울 수 없습니다. (시각은 KST)</p>
      {omitted > 0 ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">오래된 이력 {omitted}줄은 생략하고 최근 200줄만 보여 줍니다.</p> : null}
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">남은 이력이 없습니다.</p>
      ) : (
        <ol className="mt-4 space-y-3" data-testid="event-timeline">
          {events.map((row) => {
            const v = toEventView(row, names);
            return (
              <li key={v.id} className="border-l-2 border-zinc-300 pl-4 text-sm dark:border-zinc-700" data-testid="event-item">
                <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {v.timeText} · {v.actorText}
                </p>
                <p className="mt-0.5">
                  <span className="font-medium">{v.typeLabel}</span>
                  {v.changeText ? <span className="ml-2 text-zinc-700 dark:text-zinc-300">{v.changeText}</span> : null}
                </p>
                {v.note ? <p className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">사유·조치 내용: {v.note}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

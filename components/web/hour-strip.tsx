// Design Ref: docs/design-homepage-monitoring.md §4.3 — 최근 24시간 띠 (정시 점검의 확정 판정 24칸)
// 색만으로 뜻을 전하지 않는다: 칸 안에 시각, 칸마다 표시 글자(기호)와 title, 아래에 글자 목록(접근성)을 함께 둔다. 칸을 누르면 그 점검 상세로 간다.
import Link from "next/link";
import { kstDateTime, STRIP_LABEL, type StripCell, type StripKind } from "@/lib/web-monitor/view";
import { panel, sectionTitle } from "./tone";

export const CELL: Record<StripKind, string> = {
  PASS_DATA: "bg-emerald-500 text-white",
  PASS_NO_DATA: "bg-emerald-300 text-emerald-950",
  DEGRADED: "bg-amber-400 text-amber-950",
  FAIL: "bg-red-600 text-white",
  UNVERIFIED: "bg-zinc-400 text-white",
  NOT_RUN: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  planned: "bg-[repeating-linear-gradient(45deg,#d4d4d8_0,#d4d4d8_4px,#fafafa_4px,#fafafa_8px)] text-zinc-900",
  unplanned: "bg-blue-500 text-white",
  checking: "bg-white text-zinc-700 ring-2 ring-inset ring-zinc-500 dark:bg-zinc-900 dark:text-zinc-200",
  missing: "border border-dashed border-zinc-300 bg-transparent text-zinc-400 dark:border-zinc-600",
};
export const SYMBOL: Record<StripKind, string> = { PASS_DATA: "■", PASS_NO_DATA: "■", DEGRADED: "▲", FAIL: "✕", UNVERIFIED: "?", NOT_RUN: "□", planned: "▨", unplanned: "◆", checking: "◇", missing: "·" };
const LEGEND: StripKind[] = ["PASS_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "planned", "checking", "unplanned"];

/** 대시보드 카드용 작은 띠: 24칸, 누를 수 없는 표시 전용(카드 전체가 /web 링크). 색만으로 뜻을 전하지 않도록 칸마다 기호와 읽을 글자를 둔다 */
export function MiniStrip({ cells }: { cells: readonly StripCell[] }) {
  return (
    <ol className="grid grid-cols-12 gap-0.5 sm:grid-cols-[repeat(24,minmax(0,1fr))]" aria-label="최근 24시간 정시 점검 결과" data-testid="web-card-strip">
      {cells.map((c) => (
        <li
          key={c.slotAt}
          title={`${c.hour}시 · ${c.detail}`}
          aria-label={`${c.hour}시 ${c.detail}`}
          data-testid="web-card-cell"
          data-kind={c.kind}
          className={`flex h-6 items-center justify-center rounded-sm text-[10px] leading-none ${CELL[c.kind]}`}
        >
          <span aria-hidden="true">
            {SYMBOL[c.kind]}
            {c.flap ? "●" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function HourStrip({ cells }: { cells: readonly StripCell[] }) {
  return (
    <section aria-labelledby="web-strip-title" className={panel} data-testid="web-strip">
      <h2 id="web-strip-title" className={sectionTitle}>
        최근 24시간 (정시 점검 {"·"} KST)
      </h2>
      <ol className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-12 lg:grid-cols-[repeat(24,minmax(0,1fr))]">
        {cells.map((c) => {
          const inner = (
            <>
              <span className="text-[10px] leading-none opacity-80">{c.hour}</span>
              <span aria-hidden="true" className="text-sm leading-none">
                {SYMBOL[c.kind]}
                {c.flap ? "●" : ""}
              </span>
            </>
          );
          const cls = `flex h-10 flex-col items-center justify-center gap-0.5 rounded ${CELL[c.kind]}`;
          return (
            <li key={c.slotAt} data-testid="web-strip-cell" data-kind={c.kind} data-flap={c.flap ? "true" : "false"}>
              {c.runId ? (
                <Link href={`/web/runs/${c.runId}`} title={`${c.hour}시 · ${c.detail}`} aria-label={`${c.hour}시 ${c.detail}`} className={`${cls} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100`}>
                  {inner}
                </Link>
              ) : (
                <span title={`${c.hour}시 · ${c.detail}`} aria-label={`${c.hour}시 ${c.detail}`} className={cls}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" aria-label="범례">
        {LEGEND.map((k) => (
          <span key={k}>
            {SYMBOL[k]} {STRIP_LABEL[k]}
          </span>
        ))}
        <span>● 일시 실패(재확인에서 정상)</span>
        <span>· 기록 없음</span>
      </p>
      {/* 색을 구분하기 어려운 사용자를 위한 글자 목록 */}
      <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer">글자로 보기</summary>
        <ul className="mt-2 grid gap-0.5 sm:grid-cols-2" data-testid="web-strip-text">
          {cells.map((c) => (
            <li key={c.slotAt}>
              {kstDateTime(c.slotAt)} — {c.detail}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

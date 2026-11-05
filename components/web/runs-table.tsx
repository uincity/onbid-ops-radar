// Design Ref: docs/design-homepage-monitoring.md §4.3 — 점검 이력 (정시·재확인·수동 구분, 최근 50건). 넓은 화면은 표, 좁은 화면은 카드 목록
import Link from "next/link";
import type { HistoryRow, LayerMark } from "@/lib/web-monitor/view";
import { panel, sectionTitle, ToneBadge } from "./tone";

const MARK: Record<LayerMark, { text: string; label: string }> = {
  ok: { text: "✓", label: "정상" },
  fail: { text: "✗", label: "실패" },
  warn: { text: "△", label: "저하" },
  skip: { text: "-", label: "점검 못 함" },
  none: { text: "-", label: "기록 없음" },
};
const LAYERS = [
  ["L1_CONNECT", "L1"],
  ["L2_HTTP", "L2"],
  ["L3_CONTENT", "L3"],
] as const;

const Mark = ({ mark }: { mark: LayerMark }) => (
  <span title={MARK[mark].label} aria-label={MARK[mark].label}>
    {MARK[mark].text}
  </span>
);

export function RunsTable({ rows }: { rows: readonly HistoryRow[] }) {
  return (
    <section aria-labelledby="web-runs-title" className={panel} data-testid="web-runs">
      <h2 id="web-runs-title" className={sectionTitle}>
        점검 이력 <span className="text-xs font-normal text-zinc-500">(최근 {rows.length}건)</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="web-runs-empty">
          아직 점검 기록이 없습니다(첫 점검은 매시 7분).
        </p>
      ) : (
        <>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm" data-testid="web-runs-table">
              <caption className="sr-only">홈페이지 점검 이력</caption>
              <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {["시각(KST)", "구분", "결과", "L1", "L2", "L3", "응답시간", "비고"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((r) => (
                  <tr key={r.id} data-testid="web-runs-row">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/web/runs/${r.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                        {r.at}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{r.triggerLabel}</td>
                    <td className="px-3 py-2">
                      <ToneBadge tone={r.resultTone}>{r.resultLabel}</ToneBadge>
                    </td>
                    {LAYERS.map(([layer, name]) => (
                      <td key={layer} className="px-3 py-2" data-layer={name}>
                        <Mark mark={r.layers[layer]} />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2">{r.responseMs !== null ? `${r.responseMs.toLocaleString("ko-KR")}ms` : "-"}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 flex flex-col gap-2 md:hidden" data-testid="web-runs-cards">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/web/runs/${r.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                    {r.at}
                  </Link>
                  <span>{r.triggerLabel}</span>
                  <ToneBadge tone={r.resultTone}>{r.resultLabel}</ToneBadge>
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  L1 <Mark mark={r.layers.L1_CONNECT} /> · L2 <Mark mark={r.layers.L2_HTTP} /> · L3 <Mark mark={r.layers.L3_CONTENT} /> · {r.responseMs !== null ? `${r.responseMs.toLocaleString("ko-KR")}ms` : "응답 -"}
                </p>
                {r.note ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{r.note}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

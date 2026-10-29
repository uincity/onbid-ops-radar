// 점검 실행 목록 표 (번호를 누르면 상세로 이동)
import Link from "next/link";
import { RunStatusBadge, SourceBadge } from "@/components/ui/badges";
import { RUN_TRIGGER_LABEL, labelOf } from "@/lib/anomalies/labels";
import { durationText, kstText, triggeredByName, type RunRow } from "./format";

export function RunsTable({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400" data-testid="runs-empty">
        아직 점검 실행 기록이 없습니다. 팀장이 수동 점검을 실행하거나 예약 점검이 돌면 여기에 쌓입니다.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm" data-testid="runs-table">
        <caption className="sr-only">최근 점검 실행 30건</caption>
        <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {["번호", "시작(KST)", "방식", "출처", "상태", "소요 시간", "API 호출", "실행한 사람"].map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="px-3 py-2">
                <Link href={`/runs/${run.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                  #{run.id}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2">{kstText(run.started_at)}</td>
              <td className="px-3 py-2">{labelOf(RUN_TRIGGER_LABEL, run.trigger)}</td>
              <td className="px-3 py-2">
                <SourceBadge source={run.source} />
              </td>
              <td className="px-3 py-2">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">{durationText(run.started_at, run.finished_at)}</td>
              <td className="px-3 py-2">{run.api_call_count}회</td>
              <td className="px-3 py-2">{triggeredByName(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

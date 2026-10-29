// 대시보드 숫자 카드: 제목 + 숫자 + 출처별 건수 (색만으로 뜻을 전하지 않고 항상 글자를 함께 쓴다)
import Link from "next/link";
import { SourceBadge } from "@/components/ui/badges";
import { SOURCES } from "@/lib/anomalies/labels";
import type { SourceCount } from "@/lib/dashboard/summary";

// "DEMO 3  PUBLIC 0" 처럼 출처별 건수를 보여 준다
export function SourceBreakdown({ count }: { count: SourceCount }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {SOURCES.map((source) => (
        <span key={source} className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          <SourceBadge source={source} />
          <span className="tabular-nums">{count[source]}건</span>
        </span>
      ))}
    </span>
  );
}

type Props = {
  title: string;
  count: SourceCount;
  href: string;
  hint?: string;
  testId: string;
};

export function CountCard({ title, count, href, hint, testId }: Props) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</h3>
      <p className="text-3xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">
        {count.total}
        <span className="ml-1 text-base font-normal text-zinc-500">건</span>
      </p>
      <SourceBreakdown count={count} />
      {hint ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
      <p className="text-xs font-medium text-blue-700 dark:text-blue-300">목록 보기 →</p>
    </Link>
  );
}

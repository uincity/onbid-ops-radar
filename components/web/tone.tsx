// `/web` 화면 공통 작은 부품: 색 배지·패널·구역 제목 (색만으로 뜻을 전하지 않도록 항상 글자를 함께 쓴다)
import type { ReactNode } from "react";
import type { Tone } from "@/lib/web-monitor/view";

export const panel = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
export const sectionTitle = "text-base font-semibold text-zinc-950 dark:text-zinc-50";

const BADGE: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  greenSoft: "bg-emerald-50/60 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900",
  amber: "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  red: "bg-red-50 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600",
  grayLight: "bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700",
  blue: "bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800",
};

export function ToneBadge({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** 칸 조회가 실패했을 때: 화면 전체가 아니라 그 칸만 이 문구로 바뀐다 */
export function SectionError({ what }: { what: string }) {
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-testid="section-error">
      {what}을(를) 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
    </p>
  );
}

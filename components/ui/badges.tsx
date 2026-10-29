// 여러 화면이 함께 쓰는 작은 배지들 (상태 · 판정 · 출처 · 규칙 · 점검 결과)
// 색만으로 뜻을 전하지 않도록 항상 글자를 함께 보여 준다.
import { RULE_LABEL, STATUS_LABEL, VERDICT_LABEL, RUN_STATUS_LABEL, labelOf } from "@/lib/anomalies/labels";

const base = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

const TONE = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600",
  blue: "bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800",
  amber: "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  red: "bg-red-50 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
  violet: "bg-violet-50 text-violet-800 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800",
} as const;

type Tone = keyof typeof TONE;
const Badge = ({ tone, children, testId }: { tone: Tone; children: React.ReactNode; testId?: string }) => (
  <span className={`${base} ${TONE[tone]}`} data-testid={testId}>
    {children}
  </span>
);

const STATUS_TONE: Record<string, Tone> = { open: "red", investigating: "amber", resolved: "green", dismissed: "gray" };
export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TONE[status] ?? "gray"} testId="status-badge">
    {labelOf(STATUS_LABEL, status)}
  </Badge>
);

const VERDICT_TONE: Record<string, Tone> = { undetermined: "gray", confirmed_issue: "red", false_positive: "green" };
export const VerdictBadge = ({ verdict }: { verdict: string }) => (
  <Badge tone={VERDICT_TONE[verdict] ?? "gray"} testId="verdict-badge">
    {labelOf(VERDICT_LABEL, verdict)}
  </Badge>
);

export const SourceBadge = ({ source }: { source: string }) => (
  <Badge tone={source === "DEMO" ? "violet" : "blue"} testId="row-source">
    {source}
  </Badge>
);

export const RuleBadge = ({ rule }: { rule: string }) => <Badge tone="gray">{labelOf(RULE_LABEL, rule)}</Badge>;

const RUN_TONE: Record<string, Tone> = { running: "blue", succeeded: "green", partial: "amber", failed: "red", blocked: "gray" };
export const RunStatusBadge = ({ status }: { status: string }) => <Badge tone={RUN_TONE[status] ?? "gray"}>{labelOf(RUN_STATUS_LABEL, status)}</Badge>;

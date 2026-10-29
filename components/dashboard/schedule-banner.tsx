// 오늘의 예약 점검 상태 띠 (대시보드 맨 위). 상태 모델을 받아 그리기만 한다. 읽기 전용: 화면을 그리면서 아무것도 기록하지 않는다 (DESIGN §5.4)
import Link from "next/link";
import type { ScheduleStatus } from "@/lib/schedule/status";

const TONE = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  info: "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  warning: "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
} as const;

// 색만으로 뜻을 전하지 않도록 글자 표시를 함께 둔다
const MARK = { ok: "정상", info: "안내", warning: "경고" } as const;

export function ScheduleBanner({ status }: { status: ScheduleStatus }) {
  return (
    <section
      role={status.level === "warning" ? "alert" : "status"}
      aria-label="오늘의 예약 점검"
      className={`flex flex-col gap-1 rounded-xl border p-3 text-sm ${TONE[status.level]}`}
      data-testid="schedule-banner"
      data-state={status.state}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current">{MARK[status.level]}</span>
        <strong>{status.title}</strong>
        {status.runId !== null ? (
          <Link href={`/runs/${status.runId}`} className="underline">
            #{status.runId}
          </Link>
        ) : null}
      </p>
      <p>{status.detail}</p>
      <p className="text-xs opacity-80">예정 {status.scheduledAt} KST · 시작 확인 기한 {status.deadlineAt} KST (이 기한은 점검 완료 기한이 아닙니다)</p>
    </section>
  );
}

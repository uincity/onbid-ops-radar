"use client";
// 팀장 전용 [보고서 생성] 폼. 실제 권한 확인은 서버 액션이 다시 한다. (이 화면은 보여 주기만 한다)
import { useActionState } from "react";
import { generateReportAction, type GenerateReportState } from "@/app/(app)/reports/actions";

const initial: GenerateReportState = { status: "idle" };

const field =
  "mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";

export function GenerateReportForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(generateReportAction, initial);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4" data-testid="report-form">
      <div>
        <label htmlFor="report-date" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          보고 날짜 (KST)
        </label>
        <input id="report-date" name="date" type="date" required defaultValue={today} max={today} className={field} />
      </div>
      <div>
        <label htmlFor="report-source" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          데이터 출처
        </label>
        <select id="report-source" name="source" defaultValue="DEMO" className={field}>
          <option value="DEMO">DEMO (가상 데이터)</option>
          <option value="PUBLIC">PUBLIC (공개 API)</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "생성 중…" : "보고서 생성"}
      </button>
      <div className="w-full" aria-live="polite">
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-testid="report-error">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

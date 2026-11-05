"use client";
// Design Ref: docs/design-homepage-monitoring.md §4.3·§5.6 / Plan W15 — 계획 점검 창 등록 폼·취소 버튼 (팀장에게만 보인다. 실제 권한 검사는 서버 액션과 DB 함수가 한다)
// 시간은 KST로 입력한다(브라우저 시간대와 관계없이 서버가 +09:00을 붙인다).
import { useActionState } from "react";
import { cancelWindowAction, createWindowAction, type WindowActionState } from "@/app/(app)/web/actions";

const idle: WindowActionState = { status: "idle" };
const field = "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function Message({ state, testId }: { state: WindowActionState; testId: string }) {
  if (state.status === "idle") return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-800 dark:text-emerald-300"}`} data-testid={testId}>
      {state.message}
    </p>
  );
}

export function WindowForm({ maxHours }: { maxHours: number | null }) {
  const [state, action, pending] = useActionState(createWindowAction, idle);
  return (
    <form action={action} className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800" data-testid="web-window-form">
      <h3 className="text-sm font-semibold sm:col-span-2">창 등록 (팀장)</h3>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        시작 (KST)
        <input type="datetime-local" name="start" required className={field} data-testid="web-window-start" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        종료 (KST)
        <input type="datetime-local" name="end" required className={field} data-testid="web-window-end" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 sm:col-span-2 dark:text-zinc-400">
        사유 (1~200자)
        <input type="text" name="reason" required maxLength={200} className={field} data-testid="web-window-reason" />
      </label>
      <p className="text-xs text-zinc-600 sm:col-span-2 dark:text-zinc-400">
        이 시간 안의 점검은 알림·가용률·이상징후에서 제외됩니다. 같은 시간대에 창을 겹쳐 등록할 수 없고{maxHours ? `, 한 창은 최대 ${maxHours}시간까지입니다` : ""}.
      </p>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300" data-testid="web-window-submit">
          {pending ? "등록 중…" : "창 등록"}
        </button>
        <Message state={state} testId="web-window-message" />
      </div>
    </form>
  );
}

export function WindowCancelButton({ id, active }: { id: number; active: boolean }) {
  const [state, action, pending] = useActionState(cancelWindowAction, idle);
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        data-testid="web-window-cancel"
        aria-label={active ? "진행 중인 점검 창 취소(종료 시각을 지금으로 당김)" : "예정된 점검 창 취소"}
      >
        {pending ? "취소 중…" : "취소"}
      </button>
      <Message state={state} testId="web-window-cancel-message" />
    </form>
  );
}

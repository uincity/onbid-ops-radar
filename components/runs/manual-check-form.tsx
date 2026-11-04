"use client";
// 수동 점검 패널 (팀장에게만 보인다). 실제 권한 확인은 서버 액션이 다시 한다.
import { useActionState } from "react";
import { startManualCheck, type ManualCheckState } from "@/app/(app)/runs/actions";

const TONE_CLASS = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

export function ManualCheckForm() {
  const [state, formAction, pending] = useActionState<ManualCheckState, FormData>(startManualCheck, null);

  return (
    <form action={formAction} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950" data-testid="manual-check-panel">
      <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">수동 점검 실행</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">팀장만 실행할 수 있습니다. 실행하면 점검 이력에 기록이 남습니다.</p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {/* 출처는 PUBLIC만 쓴다. 서버 검사가 출처·응답 모드 값을 요구하므로 숨은 칸으로 함께 보낸다 */}
        <input type="hidden" name="source" value="PUBLIC" />
        <input type="hidden" name="mode" value="normal" />
        <p className="text-sm text-zinc-800 dark:text-zinc-200">
          출처 <span className="ml-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200">PUBLIC</span>
        </p>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "실행 중…" : "수동 점검 실행"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">공공데이터포털의 온비드 OpenAPI(부동산 물건목록·상세)를 읽기 전용으로 실제 호출하며, 설정값(실행당 호출 상한, 하루 호출 예산) 안에서만 부릅니다.</p>

      <div aria-live="polite">
        {state && (
          <p role={state.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-md border px-3 py-2 text-sm ${TONE_CLASS[state.tone]}`} data-testid="manual-check-result">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

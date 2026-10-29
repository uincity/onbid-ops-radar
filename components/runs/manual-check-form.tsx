"use client";
// 수동 점검 패널 (팀장에게만 보인다). 실제 권한 확인은 서버 액션이 다시 한다.
import { useActionState, useState } from "react";
import { startManualCheck, type ManualCheckState } from "@/app/(app)/runs/actions";

const MODE_OPTIONS = [
  { value: "normal", label: "정상 응답" },
  { value: "http_error", label: "HTTP 오류" },
  { value: "timeout", label: "타임아웃" },
  { value: "empty", label: "빈 결과(0건)" },
];

const TONE_CLASS = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

const field = "mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function ManualCheckForm() {
  const [state, formAction, pending] = useActionState<ManualCheckState, FormData>(startManualCheck, null);
  const [source, setSource] = useState("DEMO");

  return (
    <form action={formAction} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950" data-testid="manual-check-panel">
      <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">수동 점검 실행</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">팀장만 실행할 수 있습니다. 실행하면 점검 이력에 기록이 남습니다.</p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          출처
          <select name="source" value={source} onChange={(e) => setSource(e.target.value)} className={field}>
            <option value="DEMO">DEMO</option>
            <option value="PUBLIC" disabled>
              PUBLIC (준비 중)
            </option>
          </select>
        </label>

        <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          응답 시뮬레이션
          <select name="mode" defaultValue="normal" className={field}>
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "실행 중…" : "수동 점검 실행"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">PUBLIC 조회기는 아직 없습니다(PLAN 33번). 응답 시뮬레이션은 DEMO 점검에서만 쓰입니다.</p>

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

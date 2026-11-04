"use client";

// 비밀번호 설정 폼 — 새 비밀번호와 확인을 입력받아 서버 액션(setPassword)으로 보낸다. 비밀번호는 다시 돌려받지 않는다.
import { useActionState } from "react";
import { setPassword, type SetPasswordState } from "@/lib/auth/actions";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";

const initialState: SetPasswordState = {};

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(setPassword, initialState);

  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 shadow-sm " +
    "focus-visible:border-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 " +
    "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-200 dark:focus-visible:outline-zinc-200";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">비밀번호 설정</h2>
        {email ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{email}</p> : null}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          사용할 비밀번호를 {PASSWORD_MIN_LENGTH}자 이상 {PASSWORD_MAX_LENGTH}자 이하로 정해 주세요.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          새 비밀번호
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          새 비밀번호 확인
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className={inputClass} />
      </div>

      <p
        role="alert"
        aria-live="polite"
        className={state.message ? "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" : "sr-only"}
      >
        {state.message ?? ""}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:outline-zinc-50"
      >
        {pending ? "저장 중…" : "비밀번호 저장"}
      </button>
    </form>
  );
}

"use client";

// Design Ref: DESIGN §4.1(/login 로그인 화면) — 이메일·비밀번호 입력 폼
// 서버 액션(signIn)의 결과(오류 문구)를 화면에 보여 준다. 비밀번호는 서버로 보내기만 하고 다시 받지 않는다.
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/safe-next";

const initialState: SignInState = {};

// 로그인 뒤 돌아갈 주소(?next=...)를 숨은 입력칸에 담는다.
// 주소의 값은 요청마다 달라서 Suspense가 필요한데, "입력칸 전체"가 아니라 이 숨은 칸만 감싼다.
// (폼 전체를 Suspense로 감싸면 처음 그린 폼이 나중에 다른 폼으로 통째로 교체되어, 그 사이에 입력한 값이 사라진다)
function NextField() {
  const searchParams = useSearchParams();
  // 서버(signIn)도 같은 규칙으로 한 번 더 다듬는다. 여기서 다듬는 것은 편의일 뿐이다.
  return <input type="hidden" name="next" value={safeNextPath(searchParams.get("next"))} />;
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 shadow-sm " +
    "placeholder:text-zinc-400 focus-visible:border-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 " +
    "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-200 dark:focus-visible:outline-zinc-200";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <Suspense fallback={<input type="hidden" name="next" value="/" />}>
        <NextField />
      </Suspense>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email ?? ""}
          className={inputClass}
          placeholder="name@example.com"
          aria-describedby={state.message ? "login-error" : undefined}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          aria-describedby={state.message ? "login-error" : undefined}
        />
      </div>

      {/* 오류 문구: 스크린 리더도 읽을 수 있게 aria-live를 붙인다 */}
      <p
        id="login-error"
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
        {pending ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}

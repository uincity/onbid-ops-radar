// 로그인은 했지만 역할(profiles)이 부여되지 않은 계정이 보는 화면
// 공개 회원가입이 켜져 있을 때 누군가 스스로 만든 계정이 운영 화면을 쓰지 못하게 하는 앱 쪽 안전장치다.
// 로그인한 사용자만 열 수 있다(proxy.ts). 역할이 있는 사용자는 첫 화면으로 보낸다.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getAuthState } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";

export default function NoAccessPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-sm text-zinc-500">확인 중…</p>}>
        <NoAccessContent />
      </Suspense>
    </AuthShell>
  );
}

async function NoAccessContent() {
  const state = await getAuthState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "member") redirect("/");

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" role="alert">
        이 계정에는 사용 권한(역할)이 부여되지 않았습니다. 담당자에게 역할 부여를 요청해 주세요.
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}

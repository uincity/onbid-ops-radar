// 로그인 뒤 처음 보는 임시 화면 (PLAN 작업 14번: 로그인·로그아웃과 비로그인 차단을 눈으로 확인하는 용도)
// 통합 운영 대시보드는 PLAN 15번(공통 화면 틀)과 19번에서 이 자리에 만들어진다.
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { ROLE_LABEL, requireUser } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";

export default function Home() {
  return (
    <AuthShell>
      {/* 로그인 정보(쿠키)를 읽는 부분은 <Suspense>로 감싼다. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <UserHome />
      </Suspense>
    </AuthShell>
  );
}

async function UserHome() {
  // 서버에서 한 번 더 확인한다: 로그인하지 않았으면 /login, 역할이 없으면 /no-access로 보낸다.
  const user = await requireUser();

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">로그인한 사용자</p>
        <p className="mt-0.5 text-lg font-semibold text-zinc-950 dark:text-zinc-50" data-testid="user-name">
          {user.displayName}
        </p>
        <p className="mt-1 inline-block rounded-full bg-zinc-950 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950" data-testid="user-role">
          {ROLE_LABEL[user.role]}
        </p>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        로그인되었습니다. 대시보드와 이상징후 화면은 다음 작업에서 이 자리에 만들어집니다.
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

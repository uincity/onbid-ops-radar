// 로그인 전후의 단순한 화면(로그인, 사용 권한 없음, 임시 첫 화면)이 함께 쓰는 가운데 정렬 카드
// 공통 화면 틀(메뉴·사용자 표시)은 PLAN 15번에서 따로 만든다.
import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      {/* break-keep: 한글이 단어 중간에서 줄바꿈되지 않게 한다 */}
      <div className="w-full max-w-md break-keep rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">온비드 운영·품질 통합 모니터링</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">OnBid Ops Radar</h1>
        <div className="mt-8">{children}</div>
        <p className="mt-8 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          교육용 PoC · 공개 데이터와 가상 데이터만 사용합니다.
        </p>
      </div>
    </main>
  );
}

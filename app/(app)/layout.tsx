// Design Ref: DESIGN §4.2 — 로그인 뒤 모든 화면이 함께 쓰는 공통 화면 틀 (위쪽 막대 + 본문)
// (app) 폴더는 주소에 나타나지 않는 묶음이다. 로그인 화면(/login)과 사용 권한 없음(/no-access)은 이 틀 밖에 있다.
//
// 주의: 레이아웃은 화면을 옮겨 다닐 때 다시 그려지지 않는다(Next.js 부분 렌더링). 그래서 이 틀의 로그인 확인만 믿지 않고
//       각 화면(page)이 requireUser()로 직접 다시 확인한다.
import { Suspense, type ReactNode } from "react";
import { AppHeader, AppHeaderFallback } from "@/components/app-header";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-black">
      {/* 키보드 사용자를 위한 "본문으로 건너뛰기" 링크: 평소에는 숨겨져 있다가 Tab 키로 포커스가 오면 보인다 */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-30 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow dark:focus:bg-zinc-900"
      >
        본문으로 건너뛰기
      </a>

      <Suspense fallback={<AppHeaderFallback />}>
        <AppHeader />
      </Suspense>

      {/* 여기에 "예약 점검 누락" 경고 띠가 들어갈 자리가 있다. (PLAN 32번) */}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 break-keep px-4 py-8">
        {children}
      </main>
    </div>
  );
}

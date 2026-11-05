// Design Ref: docs/design-homepage-monitoring.md §4.3 / Plan W13 — 홈페이지 모니터링 `/web` (현재 상태 · 24시간 띠 · 보조 확인 · 점검 이력 · 알림 기록)
// 읽기 전용: 로그인한 두 역할이 같은 화면을 본다. 지금 점검·계획 점검 창은 뒤 작업(W17·W15)에서 더한다.
// 로그인 정보와 DB를 읽는 부분은 요청이 들어온 뒤에 실행되어야 하므로 <Suspense> 안에 둔다. (Cache Components)
import type { Metadata } from "next";
import { Suspense } from "react";
import { WebOverviewView } from "@/components/web/web-overview";
import { requireUser } from "@/lib/auth/current-user";
import { WEB_TARGETS } from "@/lib/web-monitor/registry";
import { getWebViewSource, isMockStore } from "@/lib/web-monitor/view-load";

export const metadata: Metadata = { title: "홈페이지 모니터링" };

export default function WebPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">홈페이지 모니터링</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">온비드 홈페이지가 외부에서 열리는지 매시 7분에 확인한 결과입니다.</p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">불러오는 중…</p>}>
        <WebContent />
      </Suspense>
    </section>
  );
}

async function WebContent() {
  // 로그인과 역할을 이 화면에서 직접 다시 확인한다
  await requireUser();
  const now = new Date(); // requireUser 뒤라 요청 시점의 시각이다
  const target = WEB_TARGETS.targets[0];
  const source = await getWebViewSource();
  const overview = await source.loadOverview(now, target.key, target.label);
  return (
    <>
      {/* 화면 시험용 목 저장소일 때만: 가짜 데이터가 진짜처럼 보이지 않게 표시한다 (운영에서는 켜지지 않는다) */}
      {isMockStore() ? (
        <p className="mt-4 rounded-lg border border-violet-300 bg-violet-50 p-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200" data-testid="web-mock-notice">
          시험용 목 데이터입니다. 실제 점검 기록이 아닙니다.
        </p>
      ) : null}
      <WebOverviewView overview={overview} now={now} />
    </>
  );
}

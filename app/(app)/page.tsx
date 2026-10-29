// 통합 운영 대시보드 (DESIGN §4.3, PRD 5-6)
// 로그인 정보와 DB를 읽는 부분은 요청이 들어온 뒤에 실행되어야 하므로 <Suspense> 안에 둔다. (Cache Components)
import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireUser } from "@/lib/auth/current-user";
import { loadDashboardRows } from "@/lib/dashboard/queries";
import { summarizeDashboard } from "@/lib/dashboard/summary";

export const metadata: Metadata = { title: "대시보드" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  // 이 화면에서도 로그인과 역할을 직접 다시 확인한다.
  const user = await requireUser();
  const now = new Date(); // requireUser 뒤라 요청 시점의 시각이다
  const { runs, anomalies } = await loadDashboardRows(now);
  const summary = summarizeDashboard({ now, runs, anomalies, userId: user.id });

  return <DashboardView summary={summary} isOperator={user.role === "operator"} />;
}

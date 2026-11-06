// 통합 운영 대시보드 (DESIGN §4.3, PRD 5-6)
// 로그인 정보와 DB를 읽는 부분은 요청이 들어온 뒤에 실행되어야 하므로 <Suspense> 안에 둔다. (Cache Components)
import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { WebBanners } from "@/components/web/web-banners";
import { WebDashboardCard } from "@/components/web/dashboard-card";
import { requireUser } from "@/lib/auth/current-user";
import { loadAvailabilityRows } from "@/lib/availability/queries";
import { summarizeAvailability } from "@/lib/availability/summary";
import { loadScheduleMissedRecorded } from "@/lib/schedule/queries";
import { evaluateSchedule } from "@/lib/schedule/status";
import { loadSettings } from "@/lib/settings/load";
import { createClient } from "@/lib/supabase/server";
import { toKstDateString } from "@/lib/time";
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
  const supabase = await createClient();
  const availability = summarizeAvailability(await loadAvailabilityRows(supabase));
  const settings = await loadSettings(supabase);
  const schedule = evaluateSchedule({ now, runs, missedRecorded: await loadScheduleMissedRecorded(supabase, toKstDateString(now)), graceMinutes: settings.scheduleMissedGraceMinutes });

  return (
    <div className="flex flex-col gap-6">
      {/* 홈페이지 점검 경고 띠(점검 정지·알림 미발송). 조건이 꺼져 있으면 아무것도 그리지 않고, 조회가 실패해도 대시보드는 그대로 보인다 */}
      <WebBanners />
      {/* 홈페이지 카드(상태·24시간 띠·응답·인증서). 읽기만 하고, 조회가 실패하면 이 카드만 안내 문구로 바뀐다 */}
      <WebDashboardCard />
      <DashboardView summary={summary} availability={availability} schedule={schedule} isOperator={user.role === "operator"} />
    </div>
  );
}

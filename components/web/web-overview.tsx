// Design Ref: docs/design-homepage-monitoring.md §4.3 / Plan W13 — `/web` 화면 본문 조립 (읽은 값 → 화면 모델 → 구역들). 칸별 조회 실패는 그 칸만 "불러오지 못했습니다"로 바꾼다.
import {
  buildStatusCard, buildStrip, evaluateStaleBanner, groupNotifications, historyRow,
} from "@/lib/web-monitor/view";
import { bannersFrom } from "@/lib/web-monitor/view-banners";
import type { WebOverview } from "@/lib/web-monitor/view-source";
import { AuxSection } from "./aux-section";
import { BannerList } from "./banner-list";
import { HourStrip } from "./hour-strip";
import { ManualCheckPanel } from "./manual-check-panel";
import { MaintenanceSection } from "./maintenance-section";
import { NotificationList } from "./notification-list";
import { RunsTable } from "./runs-table";
import { StatusCard } from "./status-card";
import { SectionError } from "./tone";

const HISTORY_LIMIT = 50;

export function WebOverviewView({ overview, now, isAdmin }: { overview: WebOverview; now: Date; isAdmin: boolean }) {
  const { settings, state, runs, lastGoodFinishedAt, notifications, anomalyByIncident, windows } = overview;
  const banners = bannersFrom({ settings, lastGoodFinishedAt, notifications }, now, true);

  const enabled = settings.ok ? settings.data.enabled : true;
  const stale =
    settings.ok && lastGoodFinishedAt.ok
      ? evaluateStaleBanner({ now, enabled: settings.data.enabled, lastGoodFinishedAt: lastGoodFinishedAt.data, enabledSince: settings.data.enabledSince, staleMin: settings.data.staleMin })
      : null;

  const runList = runs.ok ? runs.data : [];
  const latestReal = [...runList].filter((r) => r.trigger !== "manual" && r.status !== "blocked" && r.status !== "running").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <BannerList banners={banners} />

      {/* 현재 상태: 상태·점검 이력 중 하나라도 읽었으면 보여 주고, 둘 다 못 읽었을 때만 오류 */}
      {state.ok || runs.ok ? (
        <StatusCard
          targetLabel={overview.targetLabel}
          model={buildStatusCard({ now, state: state.ok ? state.data : null, runs: runList, lastGoodFinishedAt: lastGoodFinishedAt.ok ? lastGoodFinishedAt.data : null, staleBanner: stale, enabled })}
        />
      ) : (
        <SectionError what="현재 상태" />
      )}

      {isAdmin ? <ManualCheckPanel /> : null}

      {runs.ok ? <HourStrip cells={buildStrip(runList, now)} /> : <SectionError what="최근 24시간 점검 결과" />}
      {runs.ok ? <AuxSection latestRun={latestReal} /> : null}
      {runs.ok ? <RunsTable rows={runList.slice(0, HISTORY_LIMIT).map(historyRow)} /> : <SectionError what="점검 이력" />}
      {notifications.ok ? (
        <NotificationList groups={groupNotifications(notifications.data, now)} anomalyByIncident={anomalyByIncident.ok ? anomalyByIncident.data : {}} />
      ) : (
        <SectionError what="알림 기록" />
      )}
      {windows.ok ? <MaintenanceSection windows={windows.data} now={now} isAdmin={isAdmin} maxHours={null} /> : <SectionError what="계획 점검 창" />}
    </div>
  );
}

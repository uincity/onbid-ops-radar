// Design Ref: docs/design-homepage-monitoring.md §4.3 / Plan W13 — `/web` 화면의 데이터 읽기 (로그인 사용자 권한(RLS)으로 읽는다. 서버 관리용 키는 쓰지 않는다)
// 칸(section)별로 따로 읽고 따로 실패 처리한다: 한 칸의 조회 오류가 다른 칸과 화면 전체를 깨뜨리지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOUR_MS } from "./view";
import {
  mapAnomaliesByIncident, PROBE_COLUMNS, RUN_COLUMNS, toNotificationRow, toRunView, toStateView,
  type NotificationDbRow, type RunRow, type Section, type StateRow, type WebBannerInputs, type WebOverview, type WebRunDetail, type WebViewSource,
} from "./view-source";
import { loadWebSettings } from "./settings-load";

const RUN_LIMIT = 100;
const NOTIFICATION_DAYS = 7;

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch {
    return { ok: false }; // 오류 문구는 화면에 내지 않는다
  }
}

export function createSupabaseViewSource(supabase: SupabaseClient): WebViewSource {
  const loadSettingsSection = (): Promise<Section<{ enabled: boolean; enabledSince: string | null; staleMin: number }>> =>
    section(async () => {
      const settings = await loadWebSettings(supabase);
      const { data, error } = await supabase.from("web_settings").select("updated_at").eq("key", "web_monitor_enabled").maybeSingle();
      if (error) throw new Error("설정 시각 조회 실패");
      return { enabled: settings.monitorEnabled, enabledSince: (data as { updated_at: string } | null)?.updated_at ?? null, staleMin: settings.heartbeatStaleMin };
    });

  const loadLastGood = (): Promise<Section<string | null>> =>
    section(async () => {
      const { data, error } = await supabase
        .from("web_check_runs")
        .select("finished_at")
        .in("trigger", ["scheduled", "retry"])
        .in("status", ["succeeded", "partial"])
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("마지막 정상 종료 조회 실패");
      return (data as { finished_at: string } | null)?.finished_at ?? null;
    });

  const loadNotifications = (now: Date): Promise<Section<ReturnType<typeof toNotificationRow>[]>> =>
    section(async () => {
      const since = new Date(now.getTime() - NOTIFICATION_DAYS * 24 * HOUR_MS).toISOString();
      const { data, error } = await supabase
        .from("web_notifications")
        .select("key, kind, target_key, attempt, status, response_code, error_class, created_at")
        .gte("created_at", since)
        .order("id", { ascending: false })
        .limit(500);
      if (error) throw new Error("알림 기록 조회 실패");
      return ((data ?? []) as NotificationDbRow[]).map(toNotificationRow);
    });

  return {
    async loadBannerInputs(now) {
      const [settings, lastGoodFinishedAt, notifications] = await Promise.all([loadSettingsSection(), loadLastGood(), loadNotifications(now)]);
      return { settings, lastGoodFinishedAt, notifications } satisfies WebBannerInputs;
    },

    async loadOverview(now, targetKey, targetLabel) {
      const [settings, state, runs, lastGoodFinishedAt, notifications, anomalyByIncident] = await Promise.all([
        loadSettingsSection(),
        section(async () => {
          const { data, error } = await supabase.from("web_target_state").select("current_verdict, since, incident_no, incident_open, open_anomaly_id").eq("target_key", targetKey).maybeSingle();
          if (error) throw new Error("상태 조회 실패");
          return data ? toStateView(data as StateRow) : null;
        }),
        section(async () => {
          const { data: runRows, error } = await supabase.from("web_check_runs").select(RUN_COLUMNS).eq("target_key", targetKey).order("started_at", { ascending: false }).order("id", { ascending: false }).limit(RUN_LIMIT);
          if (error) throw new Error("점검 이력 조회 실패");
          const rows = (runRows ?? []) as RunRow[];
          if (rows.length === 0) return [];
          const { data: probeRows, error: probeError } = await supabase.from("web_probe_results").select(PROBE_COLUMNS).in("run_id", rows.map((r) => r.id)).order("id");
          if (probeError) throw new Error("판정 조회 실패");
          const byRun = new Map<number, NonNullable<typeof probeRows>>();
          for (const p of probeRows ?? []) byRun.set(Number((p as { run_id: number }).run_id), [...(byRun.get(Number((p as { run_id: number }).run_id)) ?? []), p]);
          return rows.map((r) => toRunView(r, (byRun.get(Number(r.id)) ?? []) as never));
        }),
        loadLastGood(),
        loadNotifications(now),
        section(async () => {
          const { data, error } = await supabase.from("anomalies").select("id, evidence").eq("source", "WEB").eq("item_key", targetKey).order("id", { ascending: false }).limit(100);
          if (error) throw new Error("이상징후 조회 실패");
          return mapAnomaliesByIncident((data ?? []) as { id: number; evidence: Record<string, unknown> | null }[]);
        }),
      ]);
      return { targetKey, targetLabel, settings, state, runs, lastGoodFinishedAt, notifications, anomalyByIncident } satisfies WebOverview;
    },

    async loadRun(id): Promise<WebRunDetail | null> {
      const fetchRun = async (runId: number) => {
        const { data, error } = await supabase.from("web_check_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
        if (error) throw new Error("점검 조회 실패");
        if (!data) return null;
        const { data: probes, error: pe } = await supabase.from("web_probe_results").select(PROBE_COLUMNS).eq("run_id", runId).order("id");
        if (pe) throw new Error("판정 조회 실패");
        return toRunView(data as RunRow, (probes ?? []) as never);
      };
      const run = await fetchRun(id);
      if (!run) return null;
      const origin = run.originRunId !== null ? await fetchRun(run.originRunId) : null;
      const { data: follow, error } = await supabase.from("web_check_runs").select("id").eq("origin_run_id", id).order("id");
      if (error) throw new Error("후속 점검 조회 실패");
      const followUps: Awaited<ReturnType<typeof fetchRun>>[] = [];
      for (const f of (follow ?? []) as { id: number }[]) followUps.push(await fetchRun(Number(f.id)));
      return { run, origin, followUps: followUps.filter((x): x is NonNullable<typeof x> => x !== null) };
    },
  };
}

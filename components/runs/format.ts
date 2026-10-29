// 점검 이력 화면이 함께 쓰는 표시 도우미
import { formatKst } from "@/lib/time";

// 시각 문자열(DB) → KST 표시. 값이 없거나 이상하면 "-"
export function kstText(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : formatKst(d);
}

// 시작~종료 사이를 "1.2초" 형태로. 아직 끝나지 않았으면 "-"
export function durationText(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "-";
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`;
}

export type RunRow = {
  id: number;
  trigger: string;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  api_call_count: number;
  triggered_by: string | null;
  profiles?: { display_name: string } | { display_name: string }[] | null;
};

export function triggeredByName(run: RunRow): string {
  if (run.trigger !== "manual") return "-";
  const p = Array.isArray(run.profiles) ? run.profiles[0] : run.profiles;
  return p?.display_name ?? "-";
}

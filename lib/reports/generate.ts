// 보고서 만들기: 날짜와 출처를 받아 DB에서 직접 읽고 계산해 보고서 모델을 돌려준다. (PRD 5-4 규칙 1: 모든 수치는 DB 기준)
// 화면에서 보낸 숫자는 쓰지 않는다. 받는 것은 날짜·출처뿐이다.
// 읽기는 로그인한 사용자의 연결(RLS)로 한다. 저장(reports 추가)은 서버 액션이 팀장 확인 뒤에 따로 한다.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayRange } from "@/lib/time";
import {
  aggregateReport,
  type ApiCheckRow,
  type ClosedEventRow,
  type LogRow,
  type NewAnomalyRow,
  type RunRow,
  type UnresolvedAnomalyRow,
} from "./aggregate";
import { SUMMARY_MAX_BYTES, UNRESOLVED_LIMIT, jsonBytes, type ReportModel } from "./model";

export class ReportError extends Error {}

const PAGE = 1000; // Supabase가 한 번에 돌려주는 최대 줄 수
const MAX_PAGES = 10; // 너무 큰 날도 멈추도록 상한을 둔다 (최대 1만 줄)
const IN_CHUNK = 100; // .in()에 한 번에 넣는 번호 수 (주소가 너무 길어지지 않게)

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(build: (from: number, to: number) => Page<T>, what: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new ReportError(`${what}을(를) 읽지 못했습니다.`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count, error } = await query;
  if (error) throw new ReportError(`${what}을(를) 읽지 못했습니다.`);
  return count ?? 0;
}

// 어떤 값이 객체 하나이든 배열 하나이든 첫 번째 객체를 꺼낸다 (Supabase 조인 결과 모양 차이 흡수)
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function generateReportModel(
  supabase: SupabaseClient,
  options: { date: string; source: "DEMO" | "PUBLIC"; now: Date },
): Promise<ReportModel> {
  const { date, source, now } = options;
  const day = kstDayRange(date);
  // 오늘이면 생성 시각까지, 지난 날짜면 그날 끝(다음 날 00:00)까지
  const end = new Date(Math.min(day.end.getTime(), now.getTime()));
  if (end.getTime() < day.start.getTime()) throw new ReportError("아직 오지 않은 날짜의 보고서는 만들 수 없습니다.");
  const startIso = day.start.toISOString();
  const endIso = end.toISOString();

  // 1) 그날 시작한 점검 실행
  const runs = await fetchAll<RunRow & { finished_at: string | null }>(
    (from, to) =>
      supabase
        .from("check_runs")
        .select("id, status, started_at, finished_at")
        .eq("source", source)
        .gte("started_at", startIso)
        .lt("started_at", endIso)
        .order("id")
        .range(from, to),
    "점검 실행 기록",
  );
  const runIds = runs.map((r) => r.id);

  const byRunIds = async <T>(table: string, columns: string, what: string): Promise<T[]> => {
    const result: T[] = [];
    for (let i = 0; i < runIds.length; i += IN_CHUNK) {
      const chunk = runIds.slice(i, i + IN_CHUNK);
      result.push(
        ...(await fetchAll<T>(
          (from, to) =>
            supabase
              .from(table)
              .select(columns)
              .in("run_id", chunk)
              .order("id")
              .range(from, to) as unknown as Page<T>,
          what,
        )),
      );
    }
    return result;
  };

  const [apiChecks, logs, collectedCount, newAnomalies, closedRaw, unresolvedRaw] = await Promise.all([
    byRunIds<ApiCheckRow>("api_checks", "run_id, outcome, duration_ms", "API 점검 기록"),
    byRunIds<LogRow>("run_logs", "run_id, code, message", "점검 실행 로그"),
    countRows(
      supabase
        .from("collected_items")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .gte("collected_at", startIso)
        .lt("collected_at", endIso),
      "수집 데이터",
    ),
    fetchAll<NewAnomalyRow>(
      (from, to) =>
        supabase
          .from("anomalies")
          .select("rule_id, first_detected_at, previous_anomaly_id")
          .eq("source", source)
          .gte("first_detected_at", startIso)
          .lt("first_detected_at", endIso)
          .order("id")
          .range(from, to),
      "신규 이상징후",
    ),
    fetchAll<{ to_value: string | null; created_at: string; anomalies: unknown }>(
      (from, to) =>
        supabase
          .from("anomaly_events")
          .select("to_value, created_at, anomalies!inner(source)")
          .eq("anomalies.source", source)
          .eq("event_type", "status_changed")
          .in("to_value", ["resolved", "dismissed"])
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("id")
          .range(from, to),
      "종결 이력",
    ),
    fetchAll<{
      id: number;
      rule_id: string;
      item_key: string;
      status: string;
      first_detected_at: string;
      last_detected_at: string;
      assignee: { display_name: string } | { display_name: string }[] | null;
    }>(
      (from, to) =>
        supabase
          .from("anomalies")
          .select("id, rule_id, item_key, status, first_detected_at, last_detected_at, assignee:profiles!assignee_id(display_name)")
          .eq("source", source)
          .in("status", ["open", "investigating"])
          .lt("first_detected_at", endIso)
          .order("id")
          .range(from, to),
      "미처리 이상징후",
    ),
  ]);

  const closedEvents: ClosedEventRow[] = closedRaw.map((e) => ({ to_value: e.to_value, created_at: e.created_at }));
  const unresolved: UnresolvedAnomalyRow[] = unresolvedRaw.map((a) => ({
    id: a.id,
    rule_id: a.rule_id,
    item_key: a.item_key,
    status: a.status,
    assignee_name: firstOf(a.assignee)?.display_name ?? null,
    first_detected_at: a.first_detected_at,
    last_detected_at: a.last_detected_at,
  }));

  // 현재 처리상태별 건수 (보고 시점 기준)
  const statusCounts: Record<string, number> = {};
  for (const status of ["open", "investigating", "resolved", "dismissed"]) {
    statusCounts[status] = await countRows(
      supabase.from("anomalies").select("id", { count: "exact", head: true }).eq("source", source).eq("status", status).lt("first_detected_at", endIso),
      "처리상태별 건수",
    );
  }

  // 점검 기준 시각: 그날 마지막으로 성공한 실행이 데이터를 수집한 시각 (수집 기록이 없으면 그 실행의 끝난 시각)
  let baselineAt: Date | null = null;
  const lastSucceeded = [...runs].reverse().find((r) => r.status === "succeeded");
  if (lastSucceeded) {
    const { data, error } = await supabase
      .from("collected_items")
      .select("collected_at")
      .eq("run_id", lastSucceeded.id)
      .order("collected_at", { ascending: false })
      .limit(1);
    if (error) throw new ReportError("점검 기준 시각을 읽지 못했습니다.");
    const iso = (data?.[0]?.collected_at as string | undefined) ?? lastSucceeded.finished_at ?? lastSucceeded.started_at;
    baselineAt = new Date(iso);
  }

  const build = (limit: number) =>
    aggregateReport({
      reportDate: date,
      source,
      generatedAt: now,
      coversUntil: end,
      baselineAt,
      runs,
      apiChecks,
      logs,
      collectedCount,
      newAnomalies,
      closedEvents,
      statusCounts,
      unresolved,
      unresolvedLimit: limit,
    });

  // reports.summary에는 크기 제한이 있으므로, 너무 크면 미처리 목록을 줄여 "외 N건"으로 보여 준다
  let limit = UNRESOLVED_LIMIT;
  let model = build(limit);
  while (jsonBytes(model) > SUMMARY_MAX_BYTES && limit > 0) {
    limit = Math.max(0, limit - 5);
    model = build(limit);
  }
  return model;
}

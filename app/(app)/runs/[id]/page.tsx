// Design Ref: DESIGN §4.6 — 점검 실행 상세 (요약 · API 호출 · 실행 메모)
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { RunStatusBadge, SourceBadge } from "@/components/ui/badges";
import { durationText, kstText, triggeredByName, type RunRow } from "@/components/runs/format";
import { API_OUTCOME_LABEL, RUN_TRIGGER_LABEL, labelOf } from "@/lib/anomalies/labels";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "점검 실행 상세" };

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <section>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <RunDetail params={params} />
      </Suspense>
    </section>
  );
}

type ApiCheckRow = {
  id: number;
  endpoint_name: string;
  outcome: string;
  http_status: number | null;
  duration_ms: number;
  record_count: number | null;
  data_valid: boolean | null;
};
type LogRow = { id: number; logged_at: string; level: string; code: string; message: string };

const LEVEL_LABEL: Record<string, string> = { info: "정보", warn: "주의", error: "오류" };
const th = "whitespace-nowrap px-3 py-2 font-medium";
const box = "overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
const thead = "bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400";

async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  // 숫자가 아니거나 너무 큰 번호는 없는 번호로 본다
  if (!/^\d{1,15}$/.test(id)) notFound();
  const runId = Number(id);

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("check_runs")
    .select("id, trigger, source, status, started_at, finished_at, api_call_count, triggered_by, profiles(display_name)")
    .eq("id", runId)
    .maybeSingle();
  if (!run) notFound();
  const row = run as unknown as RunRow;

  const [checks, logs] = await Promise.all([
    supabase.from("api_checks").select("id, endpoint_name, outcome, http_status, duration_ms, record_count, data_valid").eq("run_id", runId).order("id"),
    supabase.from("run_logs").select("id, logged_at, level, code, message").eq("run_id", runId).order("logged_at").order("id"),
  ]);
  const apiChecks = (checks.data ?? []) as ApiCheckRow[];
  const runLogs = (logs.data ?? []) as LogRow[];

  const summary: [string, ReactNode][] = [
    ["방식", labelOf(RUN_TRIGGER_LABEL, row.trigger)],
    ["출처", <SourceBadge key="s" source={row.source} />],
    ["상태", <RunStatusBadge key="st" status={row.status} />],
    ["시작(KST)", kstText(row.started_at)],
    ["종료(KST)", kstText(row.finished_at)],
    ["소요 시간", durationText(row.started_at, row.finished_at)],
    ["API 호출 수", `${row.api_call_count}회`],
    ["실행한 사람", triggeredByName(row)],
  ];

  return (
    <>
      <p className="text-sm">
        <Link href="/runs" className="text-blue-700 underline dark:text-blue-300">
          ← 점검 이력으로
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">점검 실행 #{row.id}</h1>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-950" data-testid="run-summary">
        {summary.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950 dark:text-zinc-50">API 호출</h2>
      <div className={`mt-3 ${box}`}>
        {apiChecks.length === 0 ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">이 실행에는 API 호출 기록이 없습니다.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="api-checks-table">
            <thead className={thead}>
              <tr>
                {["조회 이름", "결과", "HTTP 상태", "응답시간", "건수", "데이터 유효"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {apiChecks.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono text-xs">{c.endpoint_name}</td>
                  <td className="px-3 py-2">{labelOf(API_OUTCOME_LABEL, c.outcome)}</td>
                  <td className="px-3 py-2">{c.http_status ?? "-"}</td>
                  <td className="px-3 py-2">{c.duration_ms.toLocaleString("ko-KR")}ms</td>
                  <td className="px-3 py-2">{c.record_count ?? "-"}</td>
                  <td className="px-3 py-2">{c.data_valid === null ? "-" : c.data_valid ? "유효" : "유효하지 않음"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950 dark:text-zinc-50">실행 메모</h2>
      <div className={`mt-3 ${box}`}>
        {runLogs.length === 0 ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">남긴 실행 메모가 없습니다.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="run-logs-table">
            <thead className={thead}>
              <tr>
                {["시각(KST)", "수준", "코드", "메시지"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {runLogs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap px-3 py-2">{kstText(l.logged_at)}</td>
                  <td className="px-3 py-2">{labelOf(LEVEL_LABEL, l.level)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.code}</td>
                  <td className="px-3 py-2">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

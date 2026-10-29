// 보고서 목록과 생성 화면 (DESIGN §4.7, PLAN 30번)
// 팀장에게만 생성 폼을 보여 주고, 운영 담당자에게는 안내만 보여 준다. (실제 권한 확인은 서버 액션이 한다)
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SourceBadge } from "@/components/ui/badges";
import { GenerateReportForm } from "@/components/reports/generate-form";
import { requireUser } from "@/lib/auth/current-user";
import { parseReportModel } from "@/lib/reports/model";
import { createClient } from "@/lib/supabase/server";
import { formatKst, toKstDateString } from "@/lib/time";

export const metadata: Metadata = { title: "보고서" };

export default function ReportsPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">보고서</h1>
      <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
        일일 점검보고서입니다. 만들 때마다 그 시점의 결과가 그대로 저장되며, 저장된 보고서는 고칠 수 없습니다.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">불러오는 중…</p>}>
        <ReportsContent />
      </Suspense>
    </section>
  );
}

type ReportRow = {
  id: number;
  report_date: string;
  source: string;
  generated_at: string;
  summary: unknown;
  generator: { display_name: string } | { display_name: string }[] | null;
};

async function ReportsContent() {
  const user = await requireUser(); // 로그인·역할을 이 화면에서 다시 확인한다
  const today = toKstDateString(new Date()); // requireUser가 요청 시점을 확정한 뒤라 현재 시각을 읽어도 된다

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select("id, report_date, source, generated_at, summary, generator:profiles!generated_by(display_name)")
    .order("generated_at", { ascending: false })
    .limit(30);
  const reports = (data ?? []) as unknown as ReportRow[];

  return (
    <>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-base font-semibold text-zinc-950 dark:text-zinc-50">보고서 만들기</h2>
        {user.role === "admin" ? (
          <GenerateReportForm today={today} />
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-300" data-testid="report-admin-only">
            보고서 생성은 팀장만 할 수 있습니다.
          </p>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold text-zinc-950 dark:text-zinc-50">저장된 보고서 (최근 30건)</h2>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          보고서 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.
        </p>
      ) : reports.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300" data-testid="report-list-empty">
          아직 저장된 보고서가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full min-w-[34rem] text-sm" data-testid="report-list">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                {["번호", "보고 날짜", "출처", "생성 시각", "생성자", "요약"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {reports.map((r) => {
                const model = parseReportModel(r.summary);
                const generator = Array.isArray(r.generator) ? r.generator[0] : r.generator;
                return (
                  <tr key={r.id} data-testid="report-row">
                    <td className="px-3 py-2">
                      <Link href={`/reports/${r.id}`} className="font-medium text-blue-700 underline dark:text-blue-300">
                        #{r.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/reports/${r.id}`} className="text-blue-700 underline dark:text-blue-300">
                        {r.report_date}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <SourceBadge source={r.source} />
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{formatKst(new Date(r.generated_at))}</td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{generator?.display_name ?? "-"}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {model ? `신규 ${model.anomalies.newCount} · 미처리 ${model.unresolved.total}` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

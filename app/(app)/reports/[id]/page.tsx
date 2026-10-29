// 보고서 미리보기 (DESIGN §4.7): 저장된 스냅샷을 그대로 읽어 보여 준다. 다시 계산하지 않는다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReportView } from "@/components/reports/report-view";
import { SourceBadge } from "@/components/ui/badges";
import { requireUser } from "@/lib/auth/current-user";
import { parseReportModel } from "@/lib/reports/model";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "보고서 미리보기" };

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
      <ReportDetail params={params} />
    </Suspense>
  );
}

async function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, report_date, source, summary, generator:profiles!generated_by(display_name)")
    .eq("id", Number(id))
    .maybeSingle();
  if (!data) notFound();

  const model = parseReportModel(data.summary);
  const generator = Array.isArray(data.generator) ? data.generator[0] : data.generator;

  return (
    <section>
      <Link href="/reports" className="text-sm text-blue-700 underline dark:text-blue-300">
        ← 보고서 목록
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
          일일 점검보고서 {data.report_date}
        </h1>
        <SourceBadge source={data.source} />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          #{data.id} · 생성자 {generator?.display_name ?? "-"}
        </span>
        <a
          href={`/reports/${data.id}/download`}
          className="ml-auto rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Markdown 다운로드
        </a>
      </div>
      <div className="mt-6">
        {model ? (
          <ReportView model={model} />
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            이 보고서의 요약 정보를 화면에 그릴 수 없습니다. Markdown 파일로 내려받아 확인해 주세요.
          </p>
        )}
      </div>
    </section>
  );
}

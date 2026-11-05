// Design Ref: docs/design-homepage-monitoring.md §4.4 / Plan W13 — 홈페이지 점검 1회 상세 (읽기 전용)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RunDetailView } from "@/components/web/run-detail";
import { SectionError } from "@/components/web/tone";
import { requireUser } from "@/lib/auth/current-user";
import { getWebViewSource } from "@/lib/web-monitor/view-load";
import type { WebRunDetail } from "@/lib/web-monitor/view-source";

export const metadata: Metadata = { title: "홈페이지 점검 상세" };

export default function WebRunPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">홈페이지 점검 상세</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">불러오는 중…</p>}>
        <WebRunContent params={params} />
      </Suspense>
    </section>
  );
}

async function WebRunContent({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  // 숫자가 아니거나 너무 큰 번호는 없는 번호로 본다
  if (!/^\d{1,15}$/.test(id)) notFound();

  let detail: WebRunDetail | null;
  try {
    detail = await (await getWebViewSource()).loadRun(Number(id));
  } catch {
    return (
      <div className="mt-6">
        <SectionError what="점검 상세" />
      </div>
    );
  }
  if (!detail) notFound();
  return <RunDetailView detail={detail} />;
}

// 이상징후 목록 (DESIGN §4.4, PLAN 25번): 로그인 사용자 권한(RLS)으로 읽고, 주소 쿼리로 걸러 보여 준다.
// 쿼리 이름: status · rule · source · assignee · page (잘못된 값은 무시한다)
import { Suspense } from "react";
import type { Metadata } from "next";
import { AnomalyTable, DetailFilters, Pager, QuickFilters } from "@/components/anomalies/anomaly-list";
import { requireUser } from "@/lib/auth/current-user";
import { parseListQuery } from "@/lib/anomalies/list-query";
import { fetchAnomalyList } from "@/lib/anomalies/queries";

export const metadata: Metadata = { title: "이상징후" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AnomaliesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">이상징후</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">탐지된 이상징후 목록입니다. 최근 탐지된 건이 위에 보입니다.</p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">불러오는 중…</p>}>
        <AnomaliesContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function AnomaliesContent({ searchParams }: { searchParams: SearchParams }) {
  // 화면에서도 로그인·역할을 다시 확인한다
  const user = await requireUser();
  const query = parseListQuery(await searchParams);
  const { rows, total, page, names } = await fetchAnomalyList(query, user.id);

  return (
    <div className="mt-5 space-y-4">
      <QuickFilters query={query} />
      <DetailFilters query={query} />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400" data-testid="anomaly-empty">
          조건에 맞는 이상징후가 없습니다. 필터를 바꾸거나 [전체]를 눌러 보세요.
        </div>
      ) : (
        <AnomalyTable rows={rows} names={names} />
      )}
      <Pager query={query} page={page} total={total} />
    </div>
  );
}

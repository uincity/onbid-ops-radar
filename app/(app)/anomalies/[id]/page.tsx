// 이상징후 상세 (DESIGN §4.5, PLAN 25·28번): 머리 · 탐지 정보 · 탐지 근거 · 원본 데이터 · 처리 버튼 · 이벤트 이력
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnomalyActions } from "@/components/anomalies/anomaly-actions";
import { EventTimeline } from "@/components/anomalies/event-timeline";
import { EvidenceSummary, RawValuesTable } from "@/components/anomalies/evidence-panel";
import { RuleBadge, SourceBadge, StatusBadge, VerdictBadge } from "@/components/ui/badges";
import { requireUser } from "@/lib/auth/current-user";
import { fetchAnomalyDetail } from "@/lib/anomalies/queries";
import { formatKst } from "@/lib/time";

export const metadata: Metadata = { title: "이상징후 상세" };

type Params = Promise<{ id: string }>;

// 양의 정수 모양(최대 18자리)만 번호로 인정한다
const ID_PATTERN = /^[1-9]\d{0,17}$/;

export default function AnomalyDetailPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
      <DetailContent params={params} />
    </Suspense>
  );
}

const kst = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatKst(d);
};

async function DetailContent({ params }: { params: Params }) {
  const user = await requireUser();
  const { id } = await params;
  if (!ID_PATTERN.test(id)) notFound();

  const detail = await fetchAnomalyDetail(id);
  if (!detail) notFound();
  const { anomaly: a, events, omittedEvents, profiles, names } = detail;

  const assigneeName = a.assignee_id ? (names.get(a.assignee_id) ?? "알 수 없는 사용자") : "담당자 없음";

  return (
    <article className="space-y-5">
      <p>
        <Link href="/anomalies" className="text-sm text-blue-700 underline underline-offset-2 dark:text-blue-300">
          ← 이상징후 목록
        </Link>
      </p>

      <header className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-bold tracking-tight">
          이상징후 #{a.id} <span className="ml-1 font-mono text-base font-medium text-zinc-600 dark:text-zinc-400">{a.item_key}</span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SourceBadge source={a.source} />
          <RuleBadge rule={a.rule_id} />
          <StatusBadge status={a.status} />
          <VerdictBadge verdict={a.verdict} />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-zinc-500">담당자</dt>
            <dd data-testid="assignee-name">{assigneeName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-500">버전</dt>
            <dd className="tabular-nums">{a.version}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="detect-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 id="detect-title" className="text-base font-semibold">
          탐지 정보
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-zinc-500">최초 탐지 (KST)</dt>
            <dd className="tabular-nums">{kst(a.first_detected_at)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">최근 탐지 (KST)</dt>
            <dd className="tabular-nums">{kst(a.last_detected_at)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">탐지 횟수</dt>
            <dd className="tabular-nums">{a.detect_count}회</dd>
          </div>
        </dl>
        {a.previous_anomaly_id != null ? (
          <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-200" data-testid="recurrence-note">
            이 건은 <strong>재발</strong>한 이상징후입니다. 이전 종결 건:{" "}
            <Link href={`/anomalies/${a.previous_anomaly_id}`} className="font-medium underline underline-offset-2">
              이전 이상징후 #{a.previous_anomaly_id}
            </Link>
          </p>
        ) : null}
      </section>

      <EvidenceSummary ruleId={a.rule_id} evidence={a.evidence} />
      <RawValuesTable evidence={a.evidence} />

      <AnomalyActions
        anomaly={{ id: a.id, status: a.status, verdict: a.verdict, version: a.version, assigneeId: a.assignee_id }}
        currentUser={{ id: user.id, role: user.role }}
        assignees={profiles.map((p) => ({ id: p.id, displayName: p.displayName, role: p.role }))}
      />

      <EventTimeline events={events} names={names} omitted={omittedEvents} />
    </article>
  );
}

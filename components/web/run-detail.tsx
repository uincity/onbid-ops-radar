// Design Ref: docs/design-homepage-monitoring.md §4.4 — 점검 1회 상세 (윗부분 요약 · 층별 결과 표 · 근거 · 원래/후속 점검 링크)
import Link from "next/link";
import { REASON_LABEL } from "@/lib/web-monitor/notify/messages";
import { kstDateTime, LAYER_LABEL, RUN_STATUS_LABEL, TRIGGER_LABEL, VERDICT_VIEW, type WebRunView } from "@/lib/web-monitor/view";
import type { WebRunDetail } from "@/lib/web-monitor/view-source";
import { panel, sectionTitle, ToneBadge } from "./tone";

const th = "whitespace-nowrap px-3 py-2 font-medium";

const dateOrDash = (iso: string | null) => (iso ? `${kstDateTime(iso)} KST` : "-");

function RunLink({ run }: { run: WebRunView }) {
  return (
    <Link href={`/web/runs/${run.id}`} className="text-blue-700 underline dark:text-blue-300">
      #{run.id} ({TRIGGER_LABEL[run.trigger]} {kstDateTime(run.startedAt)})
    </Link>
  );
}

export function RunDetailView({ detail }: { detail: WebRunDetail }) {
  const { run, origin, followUps } = detail;
  const shown = run.confirmed ?? run.overall;
  return (
    <div className="mt-6 flex flex-col gap-6">
      <section aria-labelledby="run-summary-title" className={panel} data-testid="web-run-summary">
        <h2 id="run-summary-title" className={sectionTitle}>
          요약
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ["시작", dateOrDash(run.startedAt)],
            ["종료", dateOrDash(run.finishedAt)],
            ["구분", TRIGGER_LABEL[run.trigger]],
            ["요청 수", `${run.requestCount}회`],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-zinc-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <dt className="text-zinc-500">실행 상태</dt>
            <dd>{RUN_STATUS_LABEL[run.status]}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-zinc-500">결과</dt>
            <dd>{shown ? <ToneBadge tone={VERDICT_VIEW[shown].tone}>{VERDICT_VIEW[shown].label}</ToneBadge> : "-"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-zinc-500">이 실행의 판정</dt>
            <dd>{run.overall ? VERDICT_VIEW[run.overall].label : "-"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-zinc-500">확정 판정</dt>
            <dd>{run.trigger !== "scheduled" ? "해당 없음" : run.confirmed ? VERDICT_VIEW[run.confirmed].label : run.overall === "FAIL" ? "확인 중(재확인 대기)" : "-"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-500">일시 실패</dt>
            <dd>{run.flap ? "예 (재확인에서 정상)" : "아니오"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-500">계획 점검</dt>
            <dd>{run.planned ? "예 (알림·가용률 제외)" : "아니오"}</dd>
          </div>
        </dl>
        {run.trigger === "manual" ? <p className="mt-3 text-xs text-zinc-500">수동 점검은 기록만 남기고 상태·알림에는 반영되지 않습니다.</p> : null}
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {origin ? (
            <p data-testid="web-run-origin">
              원래 실행: <RunLink run={origin} />
            </p>
          ) : null}
          {followUps.map((f) => (
            <p key={f.id} data-testid="web-run-followup">
              재확인 결과: <RunLink run={f} />
            </p>
          ))}
        </div>
      </section>

      <section aria-labelledby="run-layers-title" className={panel} data-testid="web-run-layers">
        <h2 id="run-layers-title" className={sectionTitle}>
          층별 결과
        </h2>
        {run.probes.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">이 점검에는 층별 결과가 없습니다{run.status === "blocked" ? " (다른 점검이 실행 중이라 건너뜀)" : ""}.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">점검 층별 결과</caption>
              <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {["층", "판정", "사유", "HTTP", "응답", "최종 주소", "인증서", "대표 판정 반영"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {run.probes.map((p, i) => (
                  <tr key={`${p.layer}-${i}`} data-testid="web-run-layer-row">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{LAYER_LABEL[p.layer]}</td>
                    <td className="px-3 py-2">
                      <ToneBadge tone={VERDICT_VIEW[p.verdict].tone}>{VERDICT_VIEW[p.verdict].label}</ToneBadge>
                    </td>
                    <td className="px-3 py-2">{p.reason ? `${REASON_LABEL[p.reason] ?? p.reason} (${p.reason})` : "-"}</td>
                    <td className="px-3 py-2">{p.httpStatus ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{p.durationMs !== null ? `${p.durationMs.toLocaleString("ko-KR")}ms` : "-"}</td>
                    <td className="max-w-xs break-all px-3 py-2 text-xs">{p.finalUrl ?? "-"}</td>
                    <td className="px-3 py-2">{p.certDaysLeft !== null ? `${p.certDaysLeft}일` : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{p.countsTowardOverall ? "반영함" : "반영 안 됨"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500">인증서 임박 신호와 보조 확인(진입 스텁·대기열)은 별도 알림으로만 다루며 대표 판정에는 반영되지 않습니다. 응답 본문은 저장하지 않으므로 보여 주지 않습니다.</p>
        {run.probes.some((p) => p.detail && Object.keys(p.detail).length > 0) ? (
          <ul className="mt-2 text-xs text-zinc-600 dark:text-zinc-400" data-testid="web-run-detail-evidence">
            {run.probes
              .filter((p) => p.detail && Object.keys(p.detail).length > 0)
              .map((p, i) => (
                <li key={i}>
                  {LAYER_LABEL[p.layer]}: {Object.entries(p.detail ?? {}).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ")}
                </li>
              ))}
          </ul>
        ) : null}
      </section>

      <p>
        <Link href="/web" className="text-sm text-blue-700 underline dark:text-blue-300">
          ← 홈페이지 모니터링으로 돌아가기
        </Link>
      </p>
    </div>
  );
}

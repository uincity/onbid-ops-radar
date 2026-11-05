// Design Ref: docs/design-homepage-monitoring.md §4.3 — 보조 확인 구역 (홈페이지 판정에는 반영되지 않는 진입 스텁·대기열 설정의 최근 결과)
import { VERDICT_VIEW, type WebRunView } from "@/lib/web-monitor/view";
import { panel, sectionTitle, ToneBadge } from "./tone";

const AUX = [
  { layer: "AUX_STUB", label: "진입 스텁(/)", hint: "이동 코드가 기대한 화면으로 보내는지" },
  { layer: "AUX_QUEUE", label: "대기열 서비스 설정", hint: "설정 파일이 정상 응답하는지" },
] as const;

export function AuxSection({ latestRun }: { latestRun: WebRunView | null }) {
  return (
    <section aria-labelledby="web-aux-title" className={panel} data-testid="web-aux">
      <h2 id="web-aux-title" className={sectionTitle}>
        보조 확인 <span className="text-xs font-normal text-zinc-500">(홈페이지 판정에는 반영되지 않습니다)</span>
      </h2>
      {latestRun === null ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">아직 점검 기록이 없습니다.</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {AUX.map((a) => {
            const p = latestRun.probes.find((x) => x.layer === a.layer);
            return (
              <li key={a.layer} className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300" data-testid={`web-aux-${a.layer}`}>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{a.label}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {p ? <ToneBadge tone={VERDICT_VIEW[p.verdict].tone}>{VERDICT_VIEW[p.verdict].label}</ToneBadge> : <ToneBadge tone="grayLight">기록 없음</ToneBadge>}
                  {p?.durationMs != null ? <span>{p.durationMs.toLocaleString("ko-KR")}ms</span> : null}
                </span>
                <span className="text-xs text-zinc-500">{a.hint}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

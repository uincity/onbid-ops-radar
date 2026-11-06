// Design Ref: docs/design-homepage-monitoring.md §4.5 / Plan W22 — 대시보드 "홈페이지" 카드 (서버 컴포넌트, 읽기 전용)
// 상태·마지막 점검·최근 24시간 띠·응답 시간·인증서 남은 일수·한계 문구를 한 카드에 담고, 카드를 누르면 /web으로 간다.
// 기존 "오늘 점검" 카드·처리 현황 카드는 바뀌지 않는다. 읽기는 로그인 사용자 권한(RLS)이며, 조회가 실패해도 대시보드 전체를 깨지 않고 이 카드만 안내 문구로 바뀐다.
// 점검·판정·알림에는 어떤 영향도 주지 않는다(데이터를 읽어 보여 주기만 한다).
import Link from "next/link";
import { connection } from "next/server";
import { buildStatusCard, buildStrip, evaluateStaleBanner, kstDateTime, type StatusCardModel, type StripCell } from "@/lib/web-monitor/view";
import { WEB_TARGETS } from "@/lib/web-monitor/registry";
import { getWebViewSource } from "@/lib/web-monitor/view-load";
import { MiniStrip } from "./hour-strip";
import { ToneBadge } from "./tone";

type CardData = { label: string; model: StatusCardModel; cells: StripCell[]; recorded: boolean };

const box = "block rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

export async function WebDashboardCard() {
  await connection(); // 현재 시각을 쓰므로 요청이 들어온 뒤에만 실행한다 (try 밖: Next.js 신호를 삼키지 않기 위해)
  let data: CardData | null = null;
  try {
    const target = WEB_TARGETS.targets[0];
    const now = new Date();
    const overview = await (await getWebViewSource()).loadOverview(now, target.key, target.label);
    // 상태와 점검 이력을 둘 다 못 읽었으면 보여 줄 값이 없다. 하나라도 읽었으면 읽은 만큼 보여 준다
    if (overview.state.ok || overview.runs.ok) {
      const runs = overview.runs.ok ? overview.runs.data : [];
      const enabled = overview.settings.ok ? overview.settings.data.enabled : true;
      const lastGood = overview.lastGoodFinishedAt.ok ? overview.lastGoodFinishedAt.data : null;
      const stale =
        overview.settings.ok && overview.lastGoodFinishedAt.ok
          ? evaluateStaleBanner({ now, enabled: overview.settings.data.enabled, lastGoodFinishedAt: lastGood, enabledSince: overview.settings.data.enabledSince, staleMin: overview.settings.data.staleMin })
          : null;
      data = {
        label: target.label,
        model: buildStatusCard({ now, state: overview.state.ok ? overview.state.data : null, runs, lastGoodFinishedAt: lastGood, staleBanner: stale, enabled }),
        cells: overview.runs.ok ? buildStrip(runs, now) : [],
        recorded: overview.runs.ok,
      };
    }
  } catch {
    data = null; // 오류 문구는 화면에 내지 않는다
  }

  if (!data) {
    return (
      <section aria-labelledby="web-card-title" className={box} data-testid="web-card">
        <h2 id="web-card-title" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          홈페이지
        </h2>
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300" data-testid="web-card-error">
          홈페이지 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <Link href="/web" className="mt-2 inline-block text-xs font-medium text-blue-700 underline underline-offset-2 dark:text-blue-300">
          홈페이지 모니터링 화면으로 →
        </Link>
      </section>
    );
  }

  const { model, cells } = data;
  return (
    <Link
      href="/web"
      aria-labelledby="web-card-title"
      data-testid="web-card"
      className={`${box} flex flex-col gap-3 transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:border-zinc-600`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="web-card-title" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          홈페이지 <span className="text-xs font-normal text-zinc-500">— {data.label}</span>
        </h2>
        <ToneBadge tone={model.tone} testId="web-card-verdict">
          {model.verdictLabel}
        </ToneBadge>
        {model.incident ? <span className="text-xs font-medium text-red-700 dark:text-red-300">장애 진행 중</span> : null}
        <span className="text-xs text-zinc-600 dark:text-zinc-400" data-testid="web-card-last">
          마지막 점검 {model.lastCheckAt ? `${kstDateTime(model.lastCheckAt)} KST` : "아직 없음"}
        </span>
      </div>

      {data.recorded && cells.length > 0 ? (
        <div>
          <p className="mb-1 text-xs text-zinc-500">최근 24시간 (정시 점검 · KST)</p>
          <MiniStrip cells={cells} />
        </div>
      ) : (
        <p className="text-xs text-zinc-500" data-testid="web-card-nostrip">
          최근 24시간 점검 결과를 불러오지 못했습니다.
        </p>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">응답</dt>
          <dd data-testid="web-card-ms">{model.lastResponseMs !== null ? `${model.lastResponseMs.toLocaleString("ko-KR")}ms` : "-"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">인증서</dt>
          <dd data-testid="web-card-cert">{model.certDaysLeft !== null ? `${model.certDaysLeft}일 남음` : "-"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-zinc-500">모니터</dt>
          <dd data-testid="web-card-monitor">{model.monitorText}</dd>
        </div>
      </dl>

      <p className="text-xs text-zinc-500 dark:text-zinc-400" data-testid="web-card-note">
        ※ 단일 지점, 1시간 간격 외부 관측입니다. 모든 이용자의 상태를 뜻하지 않습니다.
      </p>
      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">자세히 보기 →</span>
    </Link>
  );
}

// 홈페이지 모니터링 경고 띠 (조건이 켜지면 보이고 꺼지면 사라진다). 그리기만 하고, 조건 계산은 lib/web-monitor/view.ts가 한다.
import Link from "next/link";
import type { WebBanner } from "@/lib/web-monitor/view";

const TONE = {
  warning: "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  info: "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
} as const;
const MARK = { warning: "경고", info: "안내" } as const;

export function BannerList({ banners }: { banners: readonly WebBanner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="web-banners">
      {banners.map((b) => (
        <section key={b.id} role={b.level === "warning" ? "alert" : "status"} aria-label={b.title} className={`flex flex-col gap-1 rounded-xl border p-3 text-sm ${TONE[b.level]}`} data-testid={`web-banner-${b.id}`}>
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current">{MARK[b.level]}</span>
            <strong>{b.title}</strong>
            {b.href ? (
              <Link href={b.href} className="underline">
                자세히 보기
              </Link>
            ) : null}
          </p>
          <p>{b.detail}</p>
        </section>
      ))}
    </div>
  );
}

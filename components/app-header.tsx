// Design Ref: DESIGN §4.2 공통 화면 틀 — 위쪽 막대
//   앱 이름 · 메뉴 4개 · 데이터 출처 배지(DEMO/PUBLIC) · 사용자 이름과 역할 · 로그아웃
// 로그인 정보(쿠키)를 읽으므로 이 컴포넌트는 <Suspense> 안에서 쓴다. (Cache Components)
import Link from "next/link";
import { connection } from "next/server";
import { MainNav, type NavItem } from "@/components/main-nav";
import { requireUser, ROLE_LABEL, type CurrentUser } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "대시보드" },
  { href: "/anomalies", label: "이상징후" },
  { href: "/runs", label: "점검 이력" },
  { href: "/reports", label: "보고서" },
];

type Source = "DEMO" | "PUBLIC";

// 지금 화면이 다루는 데이터 출처. 예약 점검이 조회하는 출처(설정값 scheduled_source)를 보여 준다. (PRD 4-6: 출처를 항상 구분해 표시)
// 읽을 수 없거나 알 수 없는 값이면 null → "출처 확인 불가"로 보여 준다. (DEMO로 짐작해서 보여 주지 않는다)
async function getScheduledSource(): Promise<Source | null> {
  // 로그인 정보를 쓰는 DB 조회도 "사용자 요청이 들어온 뒤"에만 실행한다. (getAuthState와 같은 이유 — DESIGN 2.3의 connection() 설명 참고)
  await connection();

  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "scheduled_source").maybeSingle();
  return data?.value === "DEMO" || data?.value === "PUBLIC" ? data.value : null;
}

function SourceBadge({ source }: { source: Source | null }) {
  const style =
    source === "PUBLIC"
      ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
      : source === "DEMO"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      data-testid="source-badge"
      title="예약 점검이 조회하는 데이터 출처입니다. DEMO는 가상 데이터, PUBLIC은 공개 OpenAPI 데이터입니다."
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}
    >
      {source ?? "출처 확인 불가"}
    </span>
  );
}

function UserInfo({ user, testIdPrefix }: { user: CurrentUser; testIdPrefix: string }) {
  return (
    <div className="leading-tight">
      <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50" data-testid={`${testIdPrefix}user-name`}>
        {user.displayName}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400" data-testid={`${testIdPrefix}user-role`}>
        {ROLE_LABEL[user.role]}
      </p>
    </div>
  );
}

function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        로그아웃
      </button>
    </form>
  );
}

export async function AppHeader() {
  // 로그인하지 않았으면 /login, 역할이 없으면 /no-access로 보낸다. 출처 배지는 함께 읽는다.
  const [user, source] = await Promise.all([requireUser(), getScheduledSource()]);

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="whitespace-nowrap text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
          OnBid Ops Radar
        </Link>

        <MainNav
          items={NAV_ITEMS}
          mobileFooter={
            <div className="space-y-3">
              <UserInfo user={user} testIdPrefix="mobile-" />
              <SignOutButton />
            </div>
          }
        />

        <div className="ml-auto flex items-center gap-3">
          <SourceBadge source={source} />
          {/* 넓은 화면에서만 보인다. 좁은 화면에서는 메뉴 안에 같은 내용이 들어 있다. */}
          <div className="hidden items-center gap-3 md:flex">
            <UserInfo user={user} testIdPrefix="" />
            <SignOutButton />
          </div>
        </div>
      </div>
    </header>
  );
}

// 사용자 정보를 기다리는 동안 보여 주는 뼈대 (앱 이름과 막대 높이만 먼저 보인다)
export function AppHeaderFallback() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" aria-hidden="true">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <span className="whitespace-nowrap text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">OnBid Ops Radar</span>
        <div className="ml-auto h-[42px]" />
      </div>
    </header>
  );
}

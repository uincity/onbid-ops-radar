"use client";

// Design Ref: DESIGN §4.2 — 공통 화면 틀의 메뉴. 넓은 화면에서는 가로 메뉴, 좁은 화면(모바일)에서는 "메뉴" 버튼 안으로 접힌다.
// 지금 보고 있는 화면의 메뉴 항목을 강조하려면 현재 주소를 알아야 해서 이 부분만 브라우저 쪽 컴포넌트로 만들었다.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type NavItem = { href: string; label: string };

// "/"(대시보드)는 정확히 같을 때만, 나머지는 그 아래 주소(예: /anomalies/12)도 같은 메뉴로 본다.
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function linkClass(active: boolean, block: boolean) {
  return [
    "rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100",
    block ? "block" : "",
    active
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  ].join(" ");
}

// mobileFooter: 좁은 화면에서 메뉴 안에 함께 보여 줄 내용(사용자 이름·역할, 로그아웃). 서버에서 만든 조각을 그대로 받는다.
export function MainNav({ items, mobileFooter }: { items: NavItem[]; mobileFooter: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      {/* 넓은 화면: 가로 메뉴 */}
      <nav aria-label="주 메뉴" className="hidden items-center gap-1 md:flex">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={linkClass(active, false)}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 좁은 화면: "메뉴" 버튼. key에 주소를 넣어, 다른 화면으로 이동하면 메뉴가 저절로 닫히게 한다. */}
      {/* 메뉴 상자는 버튼이 아니라 위쪽 막대(relative) 기준으로 펼쳐서, 좁은 화면에서 왼쪽 밖으로 삐져나가지 않게 한다 */}
      <details key={pathname} className="group md:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
          메뉴
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="absolute inset-x-4 top-full z-20 mt-1 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <nav aria-label="주 메뉴(모바일)" className="space-y-1">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={linkClass(active, true)}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">{mobileFooter}</div>
        </div>
      </details>
    </>
  );
}

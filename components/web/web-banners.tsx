// Design Ref: docs/design-homepage-monitoring.md §4.2 / Plan W13 — 대시보드와 `/web` 맨 위의 홈페이지 경고 띠 (서버 컴포넌트)
// 레이아웃이 아니라 화면 안에 둔다(레이아웃은 화면을 옮겨 다닐 때 다시 그려지지 않아 최신 값을 반영하지 못한다). 조회가 실패하면 화면 전체를 깨지 않고 띠만 생략한다.
// 로그인 확인은 부르는 화면(page)이 이미 했다. 읽기는 로그인 사용자 권한(RLS)이다.
import { connection } from "next/server";
import { WEB_TARGETS } from "@/lib/web-monitor/registry";
import type { WebBanner } from "@/lib/web-monitor/view";
import { bannersFrom } from "@/lib/web-monitor/view-banners";
import { getWebViewSource } from "@/lib/web-monitor/view-load";
import { BannerList } from "./banner-list";

export async function WebBanners({ includeOff = false }: { includeOff?: boolean }) {
  await connection(); // 현재 시각을 쓰므로 요청이 들어온 뒤에만 실행한다 (try 밖: Next.js 신호를 삼키지 않기 위해)
  let banners: WebBanner[];
  try {
    const source = await getWebViewSource();
    const now = new Date();
    banners = bannersFrom(await source.loadBannerInputs(now, WEB_TARGETS.targets[0].key), now, includeOff);
  } catch {
    return null; // 띠 조회 실패는 화면을 깨지 않고 생략한다
  }
  return <BannerList banners={banners} />;
}

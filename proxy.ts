// Design Ref: DESIGN §2.2(proxy.ts: 로그인 안 된 요청을 /login으로 돌려보냄), §2.3(Next.js 16에서는 middleware가 proxy로 바뀜),
//             §9(로그인 없이 접근 → proxy 차단 + 서버 액션 재확인 + RLS), PRD 7-5 SEC-01
//
// 하는 일
//   1. 로그인 정보(쿠키)를 확인하고 만료가 가까우면 새로 고친다. (Supabase 로그인 세션 유지)
//   2. 로그인하지 않은 사람의 화면 요청은 /login으로, API 요청은 401로 막는다.
//   3. 이미 로그인한 사람이 /login에 오면 첫 화면으로 보낸다.
// 주의: proxy는 "1차 확인"이다. 화면과 서버 액션도 requireUser()로 다시 확인한다. (서버 액션은 주소로 직접 호출될 수 있다)
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

// 로그인 없이 열 수 있는 화면
const PUBLIC_PAGES = ["/login"];
// 자체 인증을 쓰는 입구(예약 점검은 CRON_SECRET 헤더로 인증, PLAN 31번·SEC-09). 로그인 쿠키 검사를 건너뛴다.
const SELF_AUTHENTICATED_PREFIXES = ["/api/cron/"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (SELF_AUTHENTICATED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const { url, publishableKey } = getSupabasePublicEnv();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 새로 고친 로그인 정보를 이 요청과 응답 모두에 반영한다.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getClaims()는 로그인 정보(JWT)가 진짜인지 확인한다. (getSession()은 위조된 쿠키를 믿을 수 있어 쓰지 않는다)
  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims?.sub);

  // 응답을 바꿔 보낼 때도 새로 고친 로그인 쿠키를 함께 실어 보낸다.
  const withRefreshedCookies = (next: NextResponse) => {
    for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);
    return next;
  };

  const isPublicPage = PUBLIC_PAGES.includes(pathname);

  if (isPublicPage) {
    if (loggedIn) return withRefreshedCookies(NextResponse.redirect(new URL("/", request.url)));
    return response;
  }

  if (!loggedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    // 첫 화면이 아니면 로그인 뒤 돌아올 수 있게 원래 주소를 기억해 둔다.
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // 정적 파일(_next/static, 이미지 등)은 제외한다. 포함하면 CSS·이미지까지 막혀 화면이 깨진다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

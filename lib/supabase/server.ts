// Design Ref: DESIGN §11.1 — 서버용 Supabase 연결 (요청한 사용자의 로그인 정보로 동작)
// 서버 컴포넌트·서버 액션·Route Handler에서 쓴다. 사용자 권한과 RLS가 그대로 적용된다. (PRD 7-3 규칙 10)
// 요청마다 새로 만들어야 하므로 전역 변수에 담아 두지 않는다.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없어 여기로 온다.
          // 로그인 세션 갱신은 proxy.ts(PLAN 14번)가 맡으므로 무시해도 된다.
        }
      },
    },
  });
}

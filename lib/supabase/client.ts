// Design Ref: DESIGN §11.1 — 브라우저용 Supabase 연결 (로그인한 사용자의 권한으로 동작)
// 공개 키만 사용하므로 브라우저 코드에서 써도 안전하다. 데이터 보호는 DB의 RLS가 담당한다.
import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient(url, publishableKey);
}

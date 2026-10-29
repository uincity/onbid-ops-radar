// Design Ref: DESIGN §11.2 — 서버 관리용 Supabase 연결 (SUPABASE_SECRET_KEY 사용)
// 이 키는 RLS를 건너뛰는 강한 권한이라 아래 경우에만 쓴다. (PRD 7-3 규칙 9)
//   - 예약 점검, 팀장의 수동 점검(서버 액션이 admin 역할을 확인한 뒤에만), 관리 스크립트
// 화면 컴포넌트나 "use client" 파일에서는 절대 불러오지 않는다. (SEC-06)
// `server-only`를 불러오면 브라우저 쪽에서 가져오는 순간 빌드가 실패한다.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY가 없습니다. .env을 확인해 주세요. (npm run setup:env)");
  }

  // 서버에서 한 번 쓰고 버리는 연결이므로 로그인 세션을 저장하거나 갱신하지 않는다.
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

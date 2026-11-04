// 화면 자동 테스트가 끝나면 시험 전용 계정을 정지하고 비밀번호를 새 무작위 값으로 바꿔 둔다.
import { createClient } from "@supabase/supabase-js";
import { releaseTestAccounts } from "../../scripts/lib/test-accounts.mjs";

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return;
  await releaseTestAccounts(createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } }));
}

// 화면 자동 테스트를 시작하기 전에 시험 전용 계정(팀장·운영 담당자)을 준비한다.
// 비밀번호는 매번 새로 만들어 환경변수(E2E_*)에만 두므로 .env에 저장된 비밀번호가 필요 없다. 끝나면 global-teardown이 계정을 정지한다.
import { createClient } from "@supabase/supabase-js";
import { prepareTestAccounts } from "../../scripts/lib/test-accounts.mjs";

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("화면 시험 계정을 준비하려면 .env에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY가 있어야 합니다. (npm run test:e2e로 실행하면 .env를 읽습니다)");
  }
  await prepareTestAccounts(createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } }));
}

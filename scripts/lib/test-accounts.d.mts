// test-accounts.mjs의 타입 선언 (TypeScript인 화면 시험 설정에서 불러 쓰기 위한 것)
import type { SupabaseClient } from "@supabase/supabase-js";

export type TestAccount = {
  label: string;
  role: "admin" | "operator";
  displayName: string;
  email: string;
  emailVar: string;
  passwordVar: string;
};

export const TEST_ACCOUNTS: TestAccount[];
export function prepareTestAccounts(supabase: SupabaseClient): Promise<void>;
export function releaseTestAccounts(supabase: SupabaseClient): Promise<void>;

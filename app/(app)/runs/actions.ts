// Design Ref: DESIGN §4.6, §7 / PRD SEC-03 — 수동 점검 실행 서버 액션
// 서버 관리용 키(createAdminClient)는 팀장 확인을 통과한 뒤 이 서버 코드 안에서만 쓴다.
"use server";

import { revalidatePath } from "next/cache";
import { getAuthState } from "@/lib/auth/current-user";
import { runManualCheck, type ManualCheckResult } from "@/lib/checks/manual-check";
import { runCheck } from "@/lib/checks/run-check";
import { createSupabaseCheckStore } from "@/lib/checks/supabase-store";
import { loadSettings } from "@/lib/settings/load";
import { createAdminClient } from "@/lib/supabase/admin";

export type ManualCheckState = ManualCheckResult | null;

export async function startManualCheck(_prev: ManualCheckState, formData: FormData): Promise<ManualCheckResult> {
  const result = await runManualCheck(
    { source: formData.get("source"), mode: formData.get("mode") },
    {
      getUser: async () => {
        const state = await getAuthState();
        return state.status === "member" ? { id: state.user.id, role: state.user.role } : null;
      },
      prepare: async () => {
        const admin = createAdminClient();
        return { settings: await loadSettings(admin), store: createSupabaseCheckStore(admin) };
      },
      runCheck,
      now: () => Date.now(),
    },
  );

  // 점검 이력·대시보드·이상징후 목록을 새로 고친다 (실행 기록이 생겼을 때만)
  if (result.runId !== undefined) {
    revalidatePath("/runs");
    revalidatePath("/");
    revalidatePath("/anomalies");
  }
  return result;
}

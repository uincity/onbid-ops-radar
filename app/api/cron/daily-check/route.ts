// Design Ref: DESIGN §5.1, §9 / PRD SEC-09 — 예약 점검 입구. Supabase Cron(pg_net)이 매일 KST 08:00에 POST로 부른다.
// 로그인 쿠키 대신 CRON_SECRET(Authorization: Bearer)으로 인증한다. 사람이 브라우저에서 여는 주소가 아니다.
import { runCheck } from "@/lib/checks/run-check";
import { createSupabaseCheckStore } from "@/lib/checks/supabase-store";
import { runScheduledCheck } from "@/lib/schedule/cron-check";
import { loadSettings } from "@/lib/settings/load";
import { createAdminClient } from "@/lib/supabase/admin";

// 점검은 최대 60초(설정값) 걸린다. 응답을 기다리는 쪽(pg_net 90초)보다 짧게 둔다.
export const maxDuration = 90;

export async function POST(request: Request) {
  const result = await runScheduledCheck(request.headers.get("authorization"), {
    secret: () => process.env.CRON_SECRET,
    prepare: async () => {
      const admin = createAdminClient();
      return { settings: await loadSettings(admin), store: createSupabaseCheckStore(admin) };
    },
    runCheck,
    now: () => Date.now(),
    serviceKey: () => process.env.DATA_GO_KR_SERVICE_KEY,
  });
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}

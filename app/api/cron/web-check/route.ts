// Design Ref: docs/design-homepage-monitoring.md §5.1·§7 / Plan W07 — 홈페이지 정시 점검 입구. 매시 :07에 Supabase Cron(pg_net)이 POST로 부른다(스케줄 등록은 W08).
// 로그인 쿠키 대신 CRON_SECRET(Authorization: Bearer)으로 인증한다. 사람이 브라우저에서 여는 주소가 아니다.
// 서울 리전은 프로젝트 전체 설정(vercel.json의 regions)을 따른다. preferredRegion은 쓰지 않는다.
import { runScheduledWebCheck } from "@/lib/web-monitor/cron-web-check";
import { nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { allWebTargets } from "@/lib/web-monitor/registry";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { loadWebSettings } from "@/lib/web-monitor/settings-load";
import { createSupabaseWebStore } from "@/lib/web-monitor/store";
import { createAdminClient } from "@/lib/supabase/admin";

// 점검은 최대 60초(웹 설정 기본값)다. 응답을 기다리는 쪽(pg_net)보다 짧게 둔다.
export const maxDuration = 90;

export async function POST(request: Request) {
  const result = await runScheduledWebCheck(request.headers.get("authorization"), {
    secret: () => process.env.CRON_SECRET,
    prepare: async () => {
      const admin = createAdminClient();
      return { settings: await loadWebSettings(admin), store: createSupabaseWebStore(admin) };
    },
    targets: () => allWebTargets(),
    transport: nodeTransport,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    runWebCheck,
  });
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}

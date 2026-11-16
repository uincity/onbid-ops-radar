// Design Ref: docs/design-homepage-monitoring.md §5.10·§7 / Plan W26 — 핵심 시간대 촉진 점검 입구. DB 함수 web_critical_tick()이 5분마다 켜져 있고 촉진 칸일 때만 pg_net으로 부른다.
// 정시 점검 입구(/api/cron/web-check)와 같은 방식(CRON_SECRET 인증, 서울 리전은 프로젝트 전체 설정)이다. 사람이 브라우저에서 여는 주소가 아니다.
import { runCriticalWebCheck } from "@/lib/web-monitor/cron-web-check-critical";
import { nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { allWebTargets } from "@/lib/web-monitor/registry";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { loadWebSettings } from "@/lib/web-monitor/settings-load";
import { createNotifyRuntime } from "@/lib/web-monitor/notify/runtime";
import { createSupabaseWebStore } from "@/lib/web-monitor/store";
import { createSupabaseWebTransitionStore } from "@/lib/web-monitor/transition-store";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 90;

export async function POST(request: Request) {
  const result = await runCriticalWebCheck(request.headers.get("authorization"), {
    secret: () => process.env.CRON_SECRET,
    prepare: async () => {
      const admin = createAdminClient();
      const settings = await loadWebSettings(admin);
      return { settings, store: createSupabaseWebStore(admin), transitionStore: createSupabaseWebTransitionStore(admin), notify: createNotifyRuntime(admin, settings) };
    },
    targets: () => allWebTargets(),
    transport: nodeTransport,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    runWebCheck,
  });
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}

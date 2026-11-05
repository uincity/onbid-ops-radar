// Design Ref: docs/design-homepage-monitoring.md §5.2·§7 / Plan W11 — 확인 재시도·정시 대체 실행 입구. 매분 pg_cron 함수가 "예정된 줄이 있을 때만" POST로 부른다.
// 로그인 쿠키 대신 CRON_SECRET(Authorization: Bearer)으로 인증한다. 사람이 브라우저에서 여는 주소가 아니다.
import { runWebRetries } from "@/lib/web-monitor/cron-web-retry";
import { createNotifyRuntime } from "@/lib/web-monitor/notify/runtime";
import { nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { loadWebSettings } from "@/lib/web-monitor/settings-load";
import { createSupabaseWebStore } from "@/lib/web-monitor/store";
import { createSupabaseWebRetryStore, createSupabaseWebTransitionStore } from "@/lib/web-monitor/transition-store";
import { createAdminClient } from "@/lib/supabase/admin";

// 줄 여러 개를 처리해도 웹 설정의 실행 시간 제한(기본 60초)을 넘기지 않는다. 호출하는 쪽(pg_net 85초)보다 짧게 둔다.
export const maxDuration = 90;

export async function POST(request: Request) {
  const result = await runWebRetries(request.headers.get("authorization"), {
    secret: () => process.env.CRON_SECRET,
    prepare: async () => {
      const admin = createAdminClient();
      const settings = await loadWebSettings(admin);
      return {
        settings,
        store: createSupabaseWebStore(admin),
        transitionStore: createSupabaseWebTransitionStore(admin),
        retryStore: createSupabaseWebRetryStore(admin),
        notify: createNotifyRuntime(admin, settings),
      };
    },
    findTarget: (key) => findWebTarget(key),
    transport: nodeTransport,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    runWebCheck,
  });
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}

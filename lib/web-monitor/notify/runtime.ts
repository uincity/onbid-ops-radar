// Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12 — 입구 경로(web-check·web-retry)가 알림 발송기를 만드는 공통 부분 (서버 전용)
// 환경변수로 채널을 고른다: WEB_NOTIFY_MODE=telegram(운영 배포만)이면 텔레그램, 아니면 log. 앱 주소는 APP_BASE_URL(없으면 링크 없이 보낸다).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebSettings } from "../settings";
import { deliverNotifications, type DeliverSummary } from "./deliver";
import { createNotifierFromEnv } from "./index";
import { createSupabaseNotifyStore } from "./store";

const realClock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

export function createNotifyRuntime(admin: SupabaseClient, settings: WebSettings): { deliver: (opts: { keys?: readonly string[]; olderThanMinutes?: number }) => Promise<DeliverSummary> } {
  const store = createSupabaseNotifyStore(admin);
  const notifier = createNotifierFromEnv({ WEB_NOTIFY_MODE: process.env.WEB_NOTIFY_MODE, TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID }, { timeoutMs: settings.notifyTimeoutMs });
  return {
    deliver: (opts) => deliverNotifications({ store, notifier, clock: realClock, appBaseUrl: process.env.APP_BASE_URL, ...opts }),
  };
}

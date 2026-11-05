// Design Ref: docs/design-homepage-monitoring.md §5.4·§10 / Plan W12 — 환경변수로 알림 채널 고르기
// WEB_NOTIFY_MODE=telegram 일 때만 실제로 보낸다(운영 배포에서만 이 값을 둔다). 그 밖(없음 포함)은 log — .env에 텔레그램 값이 있어도 개발·시험에서는 보내지 않는다.
import { createLogNotifier } from "./log";
import { createTelegramNotifier } from "./telegram";
import type { Notifier } from "./types";

export type NotifyEnv = { WEB_NOTIFY_MODE?: string; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string };

export function createNotifierFromEnv(env: NotifyEnv, opts: { timeoutMs: number; fetchImpl?: typeof fetch; logSink?: (line: string) => void }): Notifier {
  if (env.WEB_NOTIFY_MODE !== "telegram") return createLogNotifier(opts.logSink);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    // 운영에서 텔레그램 모드인데 비밀값이 없다: 보낼 수 없으므로 시도 기록을 실패(not_configured)로 남긴다(조용히 log로 바꿔 '발송됨'으로 오해하게 하지 않는다)
    return { channel: "telegram", send: async () => ({ ok: false, channel: "telegram", responseCode: null, errorClass: "not_configured" }) };
  }
  return createTelegramNotifier({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl });
}

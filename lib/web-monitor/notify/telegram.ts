// Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12 — 텔레그램 채널: Bot API sendMessage (parse_mode=HTML)
// 봇 토큰은 요청 주소에 들어가므로 어떤 오류·로그에도 주소와 예외 원문을 남기지 않는다. 결과는 분류 이름과 응답 코드만 돌려준다.
import type { Notifier, SendResult } from "./types";

export type TelegramOptions = {
  token: string;
  chatId: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export function createTelegramNotifier(opts: TelegramOptions): Notifier {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    channel: "telegram",
    async send(text): Promise<SendResult> {
      try {
        const res = await doFetch(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: opts.chatId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
        if (res.ok) return { ok: true, channel: "telegram", responseCode: res.status, errorClass: null };
        const errorClass = res.status === 429 ? "rate_limited" : res.status >= 500 ? "http_5xx" : "http_4xx";
        return { ok: false, channel: "telegram", responseCode: res.status, errorClass };
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        return { ok: false, channel: "telegram", responseCode: null, errorClass: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error" };
      }
    },
  };
}

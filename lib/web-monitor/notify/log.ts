// Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12 — log 채널: 실제로 보내지 않고 서버 로그에 한 줄만 남긴다 (개발·시험 기본값)
import type { Notifier } from "./types";

export function createLogNotifier(sink: (line: string) => void = (line) => console.info(line)): Notifier {
  return {
    channel: "log",
    async send(text) {
      sink(`[web-notify:log] ${text.replaceAll("\n", " | ")}`);
      return { ok: true, channel: "log", responseCode: null, errorClass: null };
    },
  };
}

// 유형별 시험 알림을 "진짜 텔레그램"으로 보내 보는 시험 (홈페이지 모니터링 알림 문구 확인용)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run test:notify-samples`로만 실행한다 (.env의 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 필요).
// DB에는 아무것도 쓰지 않고 상태·알림 기록·알림 키를 건드리지 않는다. 모든 문구에 "[시험]" 표시가 붙는다.
// 일부만 보내려면 NOTIFY_SAMPLES_ONLY=down-5xx,cert 처럼 id를 쉼표로 적는다. 토큰·대화방 번호는 출력하지 않는다.
import { describe, expect, it } from "vitest";
import { buildNotifySamples } from "@/lib/web-monitor/notify/samples";
import { createTelegramNotifier } from "@/lib/web-monitor/notify/telegram";

const live = process.env.NOTIFY_SAMPLES === "1" && !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
const GAP_MS = 1_300; // 텔레그램 대화방 초당 전송 제한을 피한다

describe.skipIf(!live)("유형별 시험 알림 → 실제 텔레그램", () => {
  it("선택한 유형의 시험 알림을 순서대로 보낸다 (전부 성공해야 한다)", async () => {
    const only = (process.env.NOTIFY_SAMPLES_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const all = buildNotifySamples(new Date());
    const chosen = only.length > 0 ? all.filter((s) => only.includes(s.id)) : all;
    if (only.length > 0) expect(chosen.length, "NOTIFY_SAMPLES_ONLY에 없는 id가 있습니다").toBe(only.length);

    const notifier = createTelegramNotifier({ token: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID!, timeoutMs: 10_000 });
    const results: string[] = [];
    for (const [i, s] of chosen.entries()) {
      const r = await notifier.send(s.text);
      results.push(`${r.ok ? "보냄" : `실패(${r.errorClass ?? r.responseCode})`} | ${s.id} | ${s.title}`);
      expect(r.ok, `${s.id} 발송 실패: ${r.errorClass ?? r.responseCode}`).toBe(true);
      if (i < chosen.length - 1) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
    console.log(`\n${results.join("\n")}\n총 ${chosen.length}건을 보냈습니다.`);
  }, 120_000);
});

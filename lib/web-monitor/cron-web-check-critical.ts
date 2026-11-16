// Design Ref: docs/design-homepage-monitoring.md §5.10(W26)·§7 — 핵심 시간대 촉진 점검 입구(POST /api/cron/web-check-critical)의 핵심 흐름
// 하는 일: (1) CRON_SECRET 확인 (2) 웹 설정 읽기 — 점검이나 촉진 점검이 꺼져 있으면 아무것도 하지 않음 (3) 지금이 핵심 시간대의 촉진 칸인지 한 번 더 확인
//   (DB의 web_critical_tick이 이미 정했지만 규칙을 앱에서도 확인해 어긋나면 조용히 건너뜀) (4) 실행기를 trigger='critical'로 부르고 상태 전환(재확인 예약·복구)으로 잇는다.
// 정시 점검 입구(cron-web-check.ts)와 같은 의존 주입 방식이라 DB·네트워크 없이 시험할 수 있다. 응답에는 내부 정보를 담지 않는다(SEC-11).
import { bearerToken, sameSecret } from "@/lib/schedule/cron-check";
import { criticalSlotAt, isCriticalSlot } from "./critical";
import type { WebCronDeps, WebCronResponse } from "./cron-web-check";
import { applyRunDecision, type ApplyOutcome } from "./transition";

const reply = (httpStatus: number, message: string, extra: Partial<WebCronResponse["body"]> = {}): WebCronResponse => ({
  httpStatus,
  body: { ok: httpStatus === 200, message, ...extra },
});

export async function runCriticalWebCheck(authorization: string | null, deps: WebCronDeps): Promise<WebCronResponse> {
  const expected = deps.secret();
  if (!expected) return reply(503, "홈페이지 촉진 점검 입구가 설정되지 않았습니다.");
  const given = bearerToken(authorization);
  if (!given || !sameSecret(given, expected)) return reply(401, "인증에 실패했습니다.");

  let prepared: Awaited<ReturnType<WebCronDeps["prepare"]>>;
  try {
    prepared = await deps.prepare();
  } catch {
    return reply(503, "홈페이지 점검 설정을 확인할 수 없어 실행하지 않았습니다.");
  }
  const { settings } = prepared;
  if (!settings.monitorEnabled || !settings.criticalEnabled) return reply(200, "촉진 점검이 꺼져 있어 실행하지 않았습니다.", { skipped: "disabled" });

  const nowMs = deps.clock.now();
  if (!isCriticalSlot(new Date(nowMs), settings)) return reply(200, "지금은 촉진 점검 시간이 아니라 실행하지 않았습니다.", { skipped: "not-slot" });

  try {
    const startedAt = new Date(nowMs);
    const report = await deps.runWebCheck({
      trigger: "critical",
      slotAt: criticalSlotAt(nowMs),
      targets: deps.targets(),
      settings,
      store: prepared.store,
      transport: deps.transport,
      clock: deps.clock,
    });
    const runs: { target: string; status: string; follow?: string }[] = [];
    const claimedKeys: string[] = [];
    for (const t of report.targets) {
      let follow: string | undefined;
      if (prepared.transitionStore) {
        try {
          // 알림 강조는 핵심 시간대 안에서 만든 알림에 붙는다(촉진 점검은 핵심 시간대 안에서만 돌므로 항상 true)
          const out: ApplyOutcome = await applyRunDecision({ report: t, trigger: "critical", startedAt, settings, store: prepared.transitionStore, criticalNow: true });
          follow = out.action;
          claimedKeys.push(...(out.claimedKeys ?? []));
        } catch {
          follow = "error";
        }
      }
      runs.push(follow ? { target: t.targetKey, status: t.status, follow } : { target: t.targetKey, status: t.status });
    }
    if (prepared.notify && claimedKeys.length > 0) {
      try {
        await prepared.notify.deliver({ keys: claimedKeys });
      } catch {
        // 발송 오류는 점검 응답에 영향이 없다. 시도 기록이 없는 알림은 회수 경로가 다시 보낸다
      }
    }
    return reply(200, "홈페이지 촉진 점검 요청을 처리했습니다.", { runs });
  } catch {
    return reply(500, "홈페이지 촉진 점검 중 오류가 생겼습니다.");
  }
}

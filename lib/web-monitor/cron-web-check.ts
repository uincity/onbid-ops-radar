// Design Ref: docs/design-homepage-monitoring.md §5.1(흐름 ① 1단계)·§7·§9 / Plan W07 — 홈페이지 정시 점검 입구(POST /api/cron/web-check)의 핵심 흐름
// 하는 일: (1) CRON_SECRET 확인 (2) 웹 설정 읽기 — web_monitor_enabled가 꺼져 있으면 아무것도 하지 않음 (3) 정시 칸을 계산해 실행기를 부름.
// 기존 lib/schedule/cron-check.ts(OpenAPI 예약 점검 입구)와 같은 의존 주입 방식이라 DB·네트워크 없이 시험할 수 있다.
// 응답에는 내부 정보(주소, 토큰, 예외 문구, 설정값)를 담지 않는다(SEC-11). 판단은 DB의 web_check_runs 기록으로 한다.
import { bearerToken, sameSecret } from "@/lib/schedule/cron-check";
import type { WebRunInput, WebRunReport } from "./runner";
import { applyRunDecision, type ApplyOutcome } from "./transition";
import type { WebTransitionStore } from "./transition-store";
import type { DeliverSummary } from "./notify/deliver";
import { scheduledSlotAt } from "./slot";
import type { WebTarget } from "./schema";
import type { WebSettings } from "./settings";
import type { WebCheckStore } from "./store";
import type { ProbeClock, WebTransport } from "./probes/types";

export type WebCronResponse = {
  httpStatus: number;
  body: { ok: boolean; message: string; skipped?: "disabled"; runs?: { target: string; status: string; follow?: string }[] };
};

export type WebCronDeps = {
  secret: () => string | undefined; // 서버에 설정된 CRON_SECRET
  // 설정을 못 읽거나 규칙에 어긋나면 던진다. transitionStore가 있으면 점검 뒤에 상태 전환(재확인 예약 포함)까지 이어서 한다
  // notify가 있으면 상태 전환에서 선점한 알림을 바로 발송한다(실패해도 점검 응답에는 영향이 없고, 15분 뒤 회수 경로가 다시 보낸다)
  prepare: () => Promise<{ settings: WebSettings; store: WebCheckStore; transitionStore?: WebTransitionStore; notify?: { deliver: (opts: { keys: readonly string[] }) => Promise<DeliverSummary> } }>;
  targets: () => readonly WebTarget[];
  transport: WebTransport;
  clock: ProbeClock;
  runWebCheck: (input: WebRunInput) => Promise<WebRunReport>;
};

const reply = (httpStatus: number, message: string, extra: Partial<WebCronResponse["body"]> = {}): WebCronResponse => ({
  httpStatus,
  body: { ok: httpStatus === 200, message, ...extra },
});

export async function runScheduledWebCheck(authorization: string | null, deps: WebCronDeps): Promise<WebCronResponse> {
  // ① 인증. 서버에 비밀값이 없으면 입구를 열어 두지 않고 거부한다 (설정 누락이 "인증 없음"이 되지 않게)
  const expected = deps.secret();
  if (!expected) return reply(503, "홈페이지 점검 입구가 설정되지 않았습니다.");
  const given = bearerToken(authorization);
  if (!given || !sameSecret(given, expected)) return reply(401, "인증에 실패했습니다.");

  // ② 설정 읽기. 읽지 못하거나 규칙에 어긋나면 기본값으로 대신하지 않고 아무것도 점검하지 않는다
  let prepared: Awaited<ReturnType<WebCronDeps["prepare"]>>;
  try {
    prepared = await deps.prepare();
  } catch {
    return reply(503, "홈페이지 점검 설정을 확인할 수 없어 실행하지 않았습니다.");
  }
  // 롤백 스위치: 꺼져 있으면 요청도 기록도 하지 않는다(정상 응답이라 스케줄러가 실패로 보지 않는다)
  if (!prepared.settings.monitorEnabled) return reply(200, "홈페이지 점검이 꺼져 있어 실행하지 않았습니다.", { skipped: "disabled" });

  // ③ 실행. 어떤 예외가 나도 내부 오류 문구는 응답에 내지 않는다
  try {
    const startedAt = new Date(deps.clock.now());
    const report = await deps.runWebCheck({
      trigger: "scheduled",
      slotAt: scheduledSlotAt(deps.clock.now()),
      targets: deps.targets(),
      settings: prepared.settings,
      store: prepared.store,
      transport: deps.transport,
      clock: deps.clock,
    });
    // 점검 결과를 상태 전환에 연결한다(정시 실패면 확인 재시도 예약). 여기서 오류가 나도 점검 기록은 이미 남아 있으므로 응답은 "처리됨"이다
    const runs: { target: string; status: string; follow?: string }[] = [];
    const claimedKeys: string[] = [];
    for (const t of report.targets) {
      let follow: string | undefined;
      if (prepared.transitionStore) {
        try {
          const out: ApplyOutcome = await applyRunDecision({ report: t, trigger: "scheduled", startedAt, settings: prepared.settings, store: prepared.transitionStore });
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
    // 막히거나 일부만 끝나도 "요청은 처리됨"이다. 결과는 web_check_runs에 남는다
    return reply(200, "홈페이지 정시 점검 요청을 처리했습니다.", { runs });
  } catch {
    return reply(500, "홈페이지 정시 점검 중 오류가 생겼습니다.");
  }
}

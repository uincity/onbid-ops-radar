// Design Ref: docs/design-homepage-monitoring.md §5.2·§7 / Plan W11 — 확인 재시도·정시 대체 실행 입구(POST /api/cron/web-retry)의 핵심 흐름
// 부르는 쪽: 매분 pg_cron 함수 web_enqueue_due_retries()가 "예정된 줄이 있을 때만" pg_net으로 부른다. CRON_SECRET(Bearer)으로 인증한다.
// 하는 일: 예정된 대기 줄을 하나씩 원자적으로 선점해 처리한다.
//   confirm : 원래 정시 실행의 대상을 다시 점검(trigger='retry')하고, 그 결과로 원래 칸의 확정 판정을 낸다. 사건이 이미 열려 있으면 하지 않고 취소한다.
//   replace : 다른 실행 때문에 막힌 정시 점검을 같은 정시 칸으로 대신 실행한다(trigger='scheduled').
// 응답에는 내부 정보(주소, 예외 문구, 설정값)를 담지 않는다(SEC-11). 처리 개수만 알린다.
import { bearerToken, sameSecret } from "@/lib/schedule/cron-check";
import type { WebRunInput, WebRunReport } from "./runner";
import type { WebTarget } from "./schema";
import type { WebSettings } from "./settings";
import type { ProbeClock, WebTransport } from "./probes/types";
import type { WebCheckStore } from "./store";
import { applyRunDecision } from "./transition";
import type { ClaimedRetry, WebRetryStore, WebTransitionStore } from "./transition-store";

export const MAX_RETRIES_PER_CALL = 5; // 한 번 호출에서 처리하는 줄 수의 상한

export type WebRetryCronResponse = {
  httpStatus: number;
  body: { ok: boolean; message: string; skipped?: "disabled"; processed?: number };
};

export type WebRetryCronDeps = {
  secret: () => string | undefined;
  prepare: () => Promise<{ settings: WebSettings; store: WebCheckStore; transitionStore: WebTransitionStore; retryStore: WebRetryStore }>;
  findTarget: (key: string) => WebTarget | undefined;
  transport: WebTransport;
  clock: ProbeClock;
  runWebCheck: (input: WebRunInput) => Promise<WebRunReport>;
};

const reply = (httpStatus: number, message: string, extra: Partial<WebRetryCronResponse["body"]> = {}): WebRetryCronResponse => ({
  httpStatus,
  body: { ok: httpStatus === 200, message, ...extra },
});

export async function runWebRetries(authorization: string | null, deps: WebRetryCronDeps): Promise<WebRetryCronResponse> {
  const expected = deps.secret();
  if (!expected) return reply(503, "홈페이지 재확인 입구가 설정되지 않았습니다.");
  const given = bearerToken(authorization);
  if (!given || !sameSecret(given, expected)) return reply(401, "인증에 실패했습니다.");

  let prepared: Awaited<ReturnType<WebRetryCronDeps["prepare"]>>;
  try {
    prepared = await deps.prepare();
  } catch {
    return reply(503, "홈페이지 점검 설정을 확인할 수 없어 실행하지 않았습니다.");
  }
  if (!prepared.settings.monitorEnabled) return reply(200, "홈페이지 점검이 꺼져 있어 실행하지 않았습니다.", { skipped: "disabled" });

  const startedMs = deps.clock.now();
  const budgetMs = prepared.settings.runTimeLimitSeconds * 1000;
  let processed = 0;
  try {
    while (processed < MAX_RETRIES_PER_CALL && deps.clock.now() - startedMs < budgetMs) {
      const row = await prepared.retryStore.claimDue();
      if (!row) break; // 더 처리할 줄이 없다
      processed += 1;
      await processOne(row, prepared, deps);
    }
    return reply(200, "홈페이지 재확인 요청을 처리했습니다.", { processed });
  } catch {
    return reply(500, "홈페이지 재확인 중 오류가 생겼습니다.", { processed });
  }
}

// 줄 1개 처리. 예외가 나면 다음 분에 다시 시도하도록 되돌리고(최대 3번 뒤 취소) 위로 던지지 않는다
async function processOne(row: ClaimedRetry, prepared: Awaited<ReturnType<WebRetryCronDeps["prepare"]>>, deps: WebRetryCronDeps): Promise<void> {
  const { retryStore, transitionStore, store, settings } = prepared;
  try {
    const target = deps.findTarget(row.targetKey);
    const origin = row.originRunId !== null ? await retryStore.getRun(row.originRunId) : null;
    if (!target || !origin || origin.targetKey !== row.targetKey) {
      await retryStore.finish(row.id, "cancelled"); // 등록부에서 빠진 대상이거나 원래 실행이 없다
      return;
    }

    if (row.kind === "confirm") {
      // 사건이 이미 열려 있으면 재확인하지 않는다
      const state = await transitionStore.loadState(row.targetKey);
      if (state?.incident_open) {
        await retryStore.finish(row.id, "cancelled");
        return;
      }
    } else if (origin.slotAt === null) {
      await retryStore.finish(row.id, "cancelled"); // 정시 칸이 없는 실행은 대신 실행할 수 없다
      return;
    }

    const startedAt = new Date(deps.clock.now());
    const report = await deps.runWebCheck(
      row.kind === "confirm"
        ? { trigger: "retry", originRunId: row.originRunId, targets: [target], settings, store, transport: deps.transport, clock: deps.clock }
        : { trigger: "scheduled", slotAt: origin.slotAt, targets: [target], settings, store, transport: deps.transport, clock: deps.clock },
    );
    const result = report.targets[0];
    // 다른 실행 때문에 또 막혔거나 점검 자체가 실패(조회기 오류·저장 오류)했으면 다음 분에 다시 한다(최대 3번, 그 뒤 취소)
    if (!result || result.status === "blocked" || result.status === "failed") {
      await retryStore.finish(row.id, "retry");
      return;
    }
    // 줄을 먼저 마감한다: 처리 중인 줄이 남아 있으면 같은 대상의 새 재확인을 예약할 수 없기 때문이다(대상별 1개)
    await retryStore.finish(row.id, "done");
    await applyRunDecision({
      report: result,
      trigger: row.kind === "confirm" ? "retry" : "scheduled",
      originRunId: row.kind === "confirm" ? row.originRunId : null,
      startedAt,
      settings,
      store: transitionStore,
    });
  } catch {
    await retryStore.finish(row.id, "retry").catch(() => false);
  }
}

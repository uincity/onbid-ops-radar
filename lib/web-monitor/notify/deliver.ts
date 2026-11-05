// Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12 — 알림 발송 흐름 (아웃박스 방식)
// 하는 일: 상태 전환이 만들어 둔 대기(queued) 줄을 읽어 → 발송 임대를 받고 → 메시지를 만들어 → Notifier로 보내고 → 시도마다 한 줄씩 추가한다.
//   한 번 실행에서 최대 3번 시도(짧은 간격), 한 알림의 시도는 모두 합쳐 5번까지. 5번을 다 쓰면 더 보내지 않고 화면에 "발송 실패"로 남는다.
//   회수: 앱이 죽었거나 실패해 15분 넘게 sent가 없는 알림은 매분 함수가 이 흐름을 다시 부르게 하고, 남은 시도 횟수만큼 다시 보낸다.
// 키 선점은 상태 전환 트랜잭션이 이미 했다. 여기서는 키를 다시 선점하지 않고, 같은 알림을 두 실행이 동시에 보내지 않게 "발송 임대"만 받는다.
import { findWebTarget } from "../registry";
import type { ProbeClock } from "../probes/types";
import { buildMessage } from "./messages";
import type { Notifier, NotifyStore, UnsentNotification } from "./types";

export const MAX_TRIES_PER_RUN = 3; // 한 번 실행에서의 시도 상한
export const MAX_ATTEMPTS_PER_NOTIFICATION = 5; // 한 알림의 전체 시도 상한 (DB 제약과 같다)
export const LEASE_SECONDS = 60;
export const RETRY_GAP_MS = 1000; // 시도 사이 간격(429 같은 일시 오류가 풀릴 시간)
export const RECOVERY_AFTER_MINUTES = 15; // 이만큼 미발송이면 회수 대상 (매분 함수의 조건과 같다)

export type DeliverOptions = {
  store: NotifyStore;
  notifier: Notifier;
  clock: ProbeClock;
  appBaseUrl?: string | null;
  keys?: readonly string[]; // 방금 선점한 키만 보낼 때
  olderThanMinutes?: number; // 회수: 오래된 것만
  limit?: number;
  labelOf?: (targetKey: string) => string;
};

export type DeliverSummary = { sent: number; failed: number; skipped: number };

const defaultLabel = (targetKey: string): string => findWebTarget(targetKey)?.label ?? targetKey;

async function deliverOne(item: UnsentNotification, o: DeliverOptions): Promise<"sent" | "failed" | "skipped"> {
  // 같은 알림을 다른 실행이 보내는 중이면 건너뛴다 (동시 두 실행에서 한 번만 발송)
  if (!(await o.store.lease(item.key, LEASE_SECONDS))) return "skipped";

  const anomalyId = await o.store.latestAnomalyId(item.targetKey);
  const text = buildMessage(item, { targetLabel: (o.labelOf ?? defaultLabel)(item.targetKey), appBaseUrl: o.appBaseUrl, anomalyId });

  let attempt = item.attempts;
  for (let tries = 0; tries < MAX_TRIES_PER_RUN && attempt < MAX_ATTEMPTS_PER_NOTIFICATION; tries++) {
    attempt += 1;
    const result = await o.notifier.send(text);
    await o.store.recordAttempt({
      key: item.key,
      attempt,
      channel: result.channel,
      status: result.ok ? "sent" : "failed",
      responseCode: result.responseCode ?? null,
      errorClass: result.ok ? null : (result.errorClass ?? "unknown"),
    });
    if (result.ok) return "sent";
    if (tries < MAX_TRIES_PER_RUN - 1 && attempt < MAX_ATTEMPTS_PER_NOTIFICATION) await o.clock.sleep(RETRY_GAP_MS);
  }
  return "failed";
}

export async function deliverNotifications(o: DeliverOptions): Promise<DeliverSummary> {
  const items = await o.store.listUnsent({ olderThanMinutes: o.olderThanMinutes ?? 0, keys: o.keys, limit: o.limit ?? 20 });
  const summary: DeliverSummary = { sent: 0, failed: 0, skipped: 0 };
  for (const item of items) {
    try {
      summary[await deliverOne(item, o)] += 1;
    } catch {
      // 한 알림의 오류(DB 등)가 다른 알림의 발송을 막지 않는다. 시도 기록이 없으면 15분 뒤 회수 경로가 다시 보낸다
      summary.failed += 1;
    }
  }
  return summary;
}

// PUBLIC 점검에 쓸 조회기와 "추가 오퍼레이션 목록"을 한 번에 만든다. 수동 점검과 예약 점검이 같은 구성을 쓰도록 한곳에 둔다.
import { genericProbeTargets } from "./generic-probe";
import { createPublicFetcher } from "./public-fetcher";
import type { Fetcher } from "./types";

export function buildPublicCheck(options: { serviceKey: string; timeoutSeconds: number; now: Date; callIntervalMs?: number | null }): { fetcher: Fetcher; extraEndpoints: { endpoint: string; operationKey: string }[] } {
  const targets = genericProbeTargets(options.now);
  return {
    fetcher: createPublicFetcher({ serviceKey: options.serviceKey, timeoutSeconds: options.timeoutSeconds, extraOperations: targets, callIntervalMs: options.callIntervalMs }),
    extraEndpoints: targets.map((t) => ({ endpoint: t.endpoint, operationKey: t.operationKey, calls: t.lookup ? 2 : 1 })),
  };
}

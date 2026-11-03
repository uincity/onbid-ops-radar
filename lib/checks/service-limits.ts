// Design Ref: PRD 5-2-3(호출 예산·속도 제한), 부록 E-3(R04) — 서비스(배치) 단위 호출 예산과 호출 간격
// 순수 함수다. DB·네트워크·시계를 모른다 (시각과 잠자기는 바깥에서 넣어 준다).
//   - 서비스별 하루 호출 예산: 등록부 오퍼레이션의 승인 쿼터(quota.dailyLimit) 중 가장 작은 값. 같은 서비스의 오퍼레이션은 한 승인 단위로 보고 보수적으로 잡는다.
//   - 호출 간격: 같은 서비스에 연달아 요청을 보낼 때 최소로 벌려 둘 시간(설정값 public_call_interval_ms). 서비스가 다르면 서로 기다리지 않는다.
import { allOperations, API_REGISTRY, type ApiRegistry } from "@/lib/registry";

// 서비스ID → 하루 호출 예산. 쿼터가 확인되지 않은 서비스는 넣지 않는다(= 서비스별 제한 없음, 전체 일일 예산만 적용)
export function serviceDailyLimits(registry: ApiRegistry = API_REGISTRY): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const { service, operation } of allOperations(registry)) {
    const daily = operation.quota?.dailyLimit;
    if (daily === undefined) continue;
    limits[service.serviceId] = Math.min(limits[service.serviceId] ?? Infinity, daily);
  }
  return limits;
}

// 서비스 하나가 오늘 더 쓸 수 있는 호출 수. 제한이 없으면 null
export function serviceCallsLeft(limits: Readonly<Record<string, number>>, usedToday: Readonly<Record<string, number>>, usedThisRun: Readonly<Record<string, number>>, serviceId: string): number | null {
  const limit = limits[serviceId];
  if (limit === undefined) return null;
  return Math.max(0, limit - (usedToday[serviceId] ?? 0) - (usedThisRun[serviceId] ?? 0));
}

// 서비스별 호출 간격 조절기. wait(서비스ID)를 부르면 같은 서비스의 직전 호출로부터 intervalMs가 지날 때까지 기다린 뒤 돌아온다.
// intervalMs가 0이거나 비어 있으면(null) 기다리지 않는다.
export type Pacer = { wait(serviceId: string): Promise<void> };

export function createPacer(intervalMs: number | null, now: () => number, sleep: (ms: number) => Promise<void>): Pacer {
  const lastCallAt = new Map<string, number>();
  return {
    async wait(serviceId) {
      if (intervalMs !== null && intervalMs > 0) {
        const last = lastCallAt.get(serviceId);
        if (last !== undefined) {
          const remain = intervalMs - (now() - last);
          if (remain > 0) await sleep(remain);
        }
      }
      lastCallAt.set(serviceId, now());
    },
  };
}

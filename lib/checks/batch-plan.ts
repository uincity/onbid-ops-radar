// Design Ref: PRD 부록 E-3(R04), 3-1(분모·미점검 이유) — 서비스 등록부를 서비스 단위 배치로 나눈 점검 계획
// 한 번의 PUBLIC 점검은 서비스(배치) 25개를 대상으로 하되, 지금 실제로 요청을 보낼 수 있는 오퍼레이션(조회기가 있는 것)만 호출한다.
// 나머지는 요청을 보내지 않고 "왜 점검하지 못했는지"를 UNVERIFIED로 남겨 분모에 넣는다 (정상으로도 실패로도 세지 않음, PRD 3-3).
// 순수 함수다. DB·네트워크를 모른다.
import { allOperations, type ApiRegistry, API_REGISTRY } from "@/lib/registry";
import { checkReadiness } from "./probe/readiness";
import type { UnverifiedReason } from "./probe/status";

export type PlannedOperation = {
  key: string; // "서비스ID/오퍼레이션ID"
  serviceId: string;
  operationId: string;
  // 실제로 요청을 보낼 수 있으면 조회기 이름(예: public-list), 아니면 null
  endpoint: string | null;
  // 요청을 보낼 수 없는 이유 (endpoint가 null일 때만)
  notReadyReason: UnverifiedReason | null;
};

export type Batch = { serviceId: string; serviceName: string; operations: PlannedOperation[] };

// 조회기 이름 → "서비스ID/오퍼레이션ID" (public-fetcher의 PUBLIC_ENDPOINT_OPERATIONS와 같은 모양)
export type CallableMap = Readonly<Record<string, string>>;

// 서비스별 배치 목록. 서비스는 등록부 순서를 따른다.
export function buildBatches(callable: CallableMap, registry: ApiRegistry = API_REGISTRY): Batch[] {
  const endpointByKey = new Map(Object.entries(callable).map(([endpoint, key]) => [key, endpoint]));
  const batches = new Map<string, Batch>();
  for (const { service, operation, key } of allOperations(registry)) {
    const batch = batches.get(service.serviceId) ?? { serviceId: service.serviceId, serviceName: service.name, operations: [] };
    const endpoint = endpointByKey.get(key) ?? null;
    batch.operations.push({
      key,
      serviceId: service.serviceId,
      operationId: operation.operationId,
      endpoint,
      // 조회기가 없는 오퍼레이션: 승인·입력값이 확정되지 않아 점검 방식이 없다. 승인 상태를 먼저 따지고, 그 밖에는 유효 입력값이 정의되지 않은 것으로 본다
      notReadyReason: endpoint ? null : (checkReadiness(operation, { hasValidInput: false }) ?? "NO_VALID_INPUT"),
    });
    batches.set(service.serviceId, batch);
  }
  return [...batches.values()];
}

// 요청을 보내지 않는(조회기가 없는) 오퍼레이션들
export const unprobeableOperations = (batches: readonly Batch[]): (PlannedOperation & { notReadyReason: UnverifiedReason })[] =>
  batches.flatMap((b) => b.operations).filter((o): o is PlannedOperation & { notReadyReason: UnverifiedReason } => o.endpoint === null && o.notReadyReason !== null);

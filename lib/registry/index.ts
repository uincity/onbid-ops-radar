// Design Ref: PRD 5-2-1, 부록 E-3(R01) — 온비드 OpenAPI 서비스 등록부 읽기
// data/registry/api-registry.json을 읽을 때마다 스키마로 검증한다. 틀리면 기본값으로 대신하지 않고 멈춘다.
// 등록부는 크기가 커서(약 100KB) 서버 쪽 코드(점검 엔진·보고서)와 시험에서만 불러온다. 브라우저 코드에서는 불러오지 않는다.
import registryJson from "@/data/registry/api-registry.json";
import { registrySchema, type ApiRegistry, type RegistryOperation, type RegistryService } from "./schema";

export type { ApiRegistry, RegistryOperation, RegistryService } from "./schema";

const parsed = registrySchema.safeParse(registryJson);
if (!parsed.success) {
  // 어디가 틀렸는지 알 수 있게 항목 이름과 이유를 모아서 알린다 (등록부에는 비밀 값이 없다)
  const reasons = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`);
  throw new Error(`서비스 등록부(data/registry/api-registry.json)가 올바르지 않습니다. ${reasons.join(" / ")}`);
}

export const API_REGISTRY: ApiRegistry = parsed.data;

export type OperationRef = { service: RegistryService; operation: RegistryOperation; key: string };

// 모든 오퍼레이션을 "서비스ID/오퍼레이션ID" 키와 함께 돌려준다
export function allOperations(registry: ApiRegistry = API_REGISTRY): OperationRef[] {
  return registry.services.flatMap((service) => service.operations.map((operation) => ({ service, operation, key: `${service.serviceId}/${operation.operationId}` })));
}

export function findOperation(key: string, registry: ApiRegistry = API_REGISTRY): OperationRef | undefined {
  return allOperations(registry).find((o) => o.key === key);
}

// 실제 호출로 응답 형식을 확인한 오퍼레이션
export const liveVerifiedOperations = (registry: ApiRegistry = API_REGISTRY): OperationRef[] => allOperations(registry).filter((o) => o.operation.verification.state === "LIVE_VERIFIED");

// 점검 대상으로 셀 수 있는 서비스 수와 목표 수. 미확정 슬롯은 분모에 넣지 않고 따로 알린다 (PRD 3-1 지표 산식)
export function registryCoverage(registry: ApiRegistry = API_REGISTRY) {
  return {
    target: registry.targetServices,
    registered: registry.services.length,
    unconfirmed: registry.unconfirmedServices,
    operations: allOperations(registry).length,
    liveVerifiedOperations: liveVerifiedOperations(registry).length,
  };
}

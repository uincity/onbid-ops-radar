// Design Ref: PRD 5-2-1(Probe 정의), 부록 E-3(R04) — 등록부에 점검 입력(probe.input)이 정해진 오퍼레이션을 "일반 조회기"로 점검하기 위한 목록·입력 해석
// 순수 함수다. 네트워크·DB를 모른다. 점검 입력의 {…} 자리표시자는 KST 기준으로 풀어 쓴다 (고정 날짜를 쓰면 데이터 공개 기간 때문에 0건이 나와 장애처럼 보일 수 있다).
import { allOperations, API_REGISTRY, findOperation, type ApiRegistry } from "@/lib/registry";
import { PROBE_INPUT_TOKENS } from "@/lib/registry/schema";
import { addDaysKst, toKstDateString } from "@/lib/time";
import { validCrossApiRelations } from "./cross-api";

// 전용 조회기가 이미 있는 오퍼레이션(부동산 목록·상세)은 일반 조회기로 다시 점검하지 않는다
const LEGACY_PUBLIC_KEYS: readonly string[] = ["SVC-API-001/getRlstCltrList", "SVC-API-004/getRlstDtlInf"];

// 승인이 확인된 상태. 승인되지 않았거나 확인하지 못한 오퍼레이션은 점검 입력이 있어도 요청을 보내지 않는다
const APPROVED_STATES: readonly string[] = ["APPROVED", "CONFIRMED_BY_USER_2026_10_29"];

export type GenericProbeTarget = {
  endpoint: string; // 점검 이름 (api_checks.endpoint_name 형식). 예: svc-api-010-getItrsCltrRnkClg
  operationKey: string; // "서비스ID/오퍼레이션ID"
  url: string; // 호출 주소 (서비스키 없음)
  params: Record<string, string>; // 풀어 쓴 업무 파라미터 (공통 항목 제외)
  linkFields?: string[]; // 교차 참조: 응답에서 식별키 값을 뽑아 둘 항목
  inputNames?: string[]; // 교차 참조의 자식: 부모 응답에서 얻어 넘겨받는 필수 입력 이름 (params에는 없다)
  lookup?: { endpoint: string; url: string; params: Record<string, string>; field: string; matchField: string; matchValue: string }; // 부모 목록을 조건으로 다시 조회해 입력값을 얻는 자식 (유가증권 상세)
};

// 점검 이름: 서비스ID와 오퍼레이션ID로 만든다 (영문·숫자·하이픈, 60자 이내)
export const genericEndpointName = (serviceId: string, operationId: string): string => `${serviceId.toLowerCase()}-${operationId}`.slice(0, 60);

// 점검 입력의 자리표시자를 푼다. 알 수 없는 자리표시자는 지어내지 않고 오류로 멈춘다 (등록부 검증이 먼저 막지만 한 번 더 확인)
export function resolveProbeInput(input: Readonly<Record<string, string>>, now: Date): Record<string, string> {
  const today = toKstDateString(now); // KST 오늘 YYYY-MM-DD (new Date()로 직접 자르지 않는다)
  const compact = (date: string) => date.replaceAll("-", "");
  const values: Record<(typeof PROBE_INPUT_TOKENS)[number], string> = {
    PREV_YEAR: String(Number(today.slice(0, 4)) - 1),
    TODAY: compact(today),
    DAYS_AGO_7: compact(addDaysKst(today, -7)),
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    out[name] = value.replace(/\{([^}]*)\}/g, (_, token: string) => {
      if (!(token in values)) throw new Error(`알 수 없는 점검 입력 자리표시자입니다: {${token}}`);
      return values[token as keyof typeof values];
    });
  }
  return out;
}

// 일반 조회기로 점검할 오퍼레이션 목록 (등록부 순서). 점검 입력이 있고 승인된 것 + 교차 참조 관계의 자식(부모 응답에서 입력을 얻는 승인된 오퍼레이션)
export function genericProbeTargets(now: Date, registry: ApiRegistry = API_REGISTRY): GenericProbeTarget[] {
  const relations = validCrossApiRelations(registry);
  // 부모는 자식들이 필요로 하는 식별키 항목을 모두 뽑아 두고, 자식은 자기 입력 항목을 받는다
  const parentFields = new Map<string, string[]>();
  for (const r of relations.filter((x) => !x.parentLookup)) parentFields.set(r.parentKey, [...new Set([...(parentFields.get(r.parentKey) ?? []), ...r.fields])]);
  const childFields = new Map(relations.map((r) => [r.childKey, [...r.fields]]));
  const lookupRelationByChild = new Map(relations.filter((r) => r.parentLookup).map((r) => [r.childKey, r]));
  return allOperations(registry)
    .filter(({ key, operation }) => !LEGACY_PUBLIC_KEYS.includes(key) && APPROVED_STATES.includes(operation.approval) && (operation.probe.input !== null || childFields.has(key)))
    .map(({ service, operation, key }): GenericProbeTarget => {
      const target: GenericProbeTarget = {
        endpoint: genericEndpointName(service.serviceId, operation.operationId),
        operationKey: key,
        url: operation.url,
        params: operation.probe.input ? resolveProbeInput(operation.probe.input, now) : {},
      };
      const parentField = parentFields.get(key);
      const childField = childFields.get(key);
      if (parentField) target.linkFields = parentField;
      if (childField) {
        target.linkFields = [...new Set([...(target.linkFields ?? []), childField[0]])]; // 자식은 대표 식별키(첫 항목)만 되돌려 비교한다
        const lookupRelation = lookupRelationByChild.get(key);
        if (lookupRelation?.parentLookup) {
          // 부모 목록을 조건으로 다시 조회해 식별키를 얻는다 (엔진이 넘겨주는 입력이 아니다). 부모 조회의 기본 입력(점검 입력)에 조건을 더한다
          const parent = findOperation(lookupRelation.parentKey, registry);
          if (!parent?.operation.probe.input) throw new Error(`부모 오퍼레이션(${lookupRelation.parentKey})의 점검 입력이 없습니다.`);
          target.lookup = {
            endpoint: genericEndpointName(parent.service.serviceId, parent.operation.operationId),
            url: parent.operation.url,
            params: { ...resolveProbeInput(parent.operation.probe.input, now), ...lookupRelation.parentLookup.params },
            field: lookupRelation.fields[0],
            matchField: lookupRelation.parentLookup.matchField,
            matchValue: lookupRelation.parentLookup.matchValue,
          };
        } else {
          target.inputNames = childField;
        }
      }
      return target;
    });
}

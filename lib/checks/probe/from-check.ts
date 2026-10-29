// Design Ref: PRD 5-2-2 — 조회기가 돌려준 "API 호출 1번의 결과"를 점검 판정 입력(관측)으로 바꾼다. 순수 함수다.
// 조회기는 결과를 5가지 outcome으로 요약해 돌려주므로, 판정에 필요한 연결 방식·본문 종류·결과코드를 되살린다.
import type { RegistryOperation } from "@/lib/registry/schema";
import type { ApiCheckRecord } from "../types";
import type { ObservedBody, ProbeObservation, ProbePolicy } from "./classify";

export function observationFromCheck(check: ApiCheckRecord, retries = 0): ProbeObservation {
  const base = { durationMs: check.durationMs, retries, schema: check.schema ?? null };

  if (check.outcome === "timeout") return { ...base, connection: { kind: "timeout" }, body: null };
  // 응답을 받지 못한 채 실패(연결 거부·DNS 등)
  if (check.httpStatus === null) return { ...base, connection: { kind: "network_error" }, body: null };

  const connection = { kind: "response", httpStatus: check.httpStatus } as const;
  const ok2xx = check.httpStatus >= 200 && check.httpStatus < 300;
  // HTTP 오류(401·403·429·5xx 등)는 연결 단계에서 판정하므로 본문은 보지 않는다
  if (!ok2xx) return { ...base, connection, body: null };

  let body: ObservedBody | null;
  switch (check.outcome) {
    case "success":
      body = { kind: "ok", recordCount: check.recordCount ?? 0 };
      break;
    case "empty_result":
      body = { kind: "nodata" };
      break;
    case "auth_or_quota":
      body = { kind: "auth_or_quota", code: check.resultCode ?? "UNKNOWN" };
      break;
    default:
      // HTTP 200인데 실패로 요약된 경우: 업무 오류 코드이거나 응답을 해석하지 못한 것
      body = { kind: "error", code: check.resultCode ?? "NO_CODE" };
  }
  return { ...base, connection, body };
}

// 등록부의 오퍼레이션 정보로 점검 정책을 만든다.
// expectDataKnown(실데이터가 반드시 있다고 확인된 입력인지)은 등록부에 아직 없으므로 항상 false다 → 0건을 POSITIVE_DATA_MISSING으로 단정하지 않는다.
// slowMs(응답 지연 기준)도 확정된 기준이 없어 null이다 → 지연을 DEGRADED로 판정하지 않는다. (PRD 5-2-3 "기준 확정 시에만 적용")
export function policyFromOperation(op: Pick<RegistryOperation, "probe" | "noDataPolicy">): ProbePolicy {
  return { mode: op.probe.mode, noDataPolicy: op.noDataPolicy, expectDataKnown: false, slowMs: null };
}

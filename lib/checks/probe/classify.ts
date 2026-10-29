// Design Ref: PRD 5-2-2(합성 점검 단계), 5-2-3(판정 상태 및 오류 분류) — 점검 한 번의 관측을 6가지 상태로 판정한다
// 순수 함수다. 네트워크·DB·현재 시각을 모른다. 같은 입력이면 항상 같은 결과다.
// 판정 순서는 PRD 5-2-2의 단계와 같다: 준비 → 연결 → 인증·한도 → 업무 응답 → 스키마 → (Positive) → 정상 중 주의 여부.
// 원칙: 승인·입력값이 없거나 점검을 못 한 것은 장애로 세지 않는다. 0건은 기본적으로 "정상 무데이터 후보"이며 실패로 단정하지 않는다.
import type { SchemaCheckResult } from "./schema-check";
import type { DegradedReason, FailCode, NotRunReason, ProbeResult, UnverifiedReason } from "./status";

export type ProbeMode = "positive" | "structural" | "negative" | null;
export type NoDataPolicy = "UNDEFINED" | "ALLOWED" | "NOT_ALLOWED";

// 오퍼레이션별로 정해 둔 점검 정책 (등록부에서 온다)
export type ProbePolicy = {
  mode: ProbeMode;
  noDataPolicy: NoDataPolicy;
  // "실데이터가 반드시 존재한다"고 독립적으로 확인된 입력인가. 이것이 true일 때만 0건을 POSITIVE_DATA_MISSING으로 판정한다
  expectDataKnown: boolean;
  // 응답 지연으로 볼 기준(ms). 기준이 확정되지 않았으면 null → 지연을 DEGRADED로 판정하지 않는다
  slowMs: number | null;
};

// 응답 본문을 해석한 결과 (public-response.ts의 해석을 점검 판정에 필요한 만큼만 옮겼다)
export type ObservedBody =
  | { kind: "ok"; recordCount: number }
  | { kind: "nodata" }
  | { kind: "auth_or_quota"; code: string } // 결과코드 20·21·22·30·31·32·33
  | { kind: "error"; code: string }; // 그 밖의 결과코드, 또는 해석 불가(PARSE·XML·NO_CODE)

export type ProbeObservation = {
  connection: { kind: "response"; httpStatus: number } | { kind: "timeout" } | { kind: "network_error" };
  durationMs: number;
  retries: number; // 재시도 횟수 (0이면 한 번에 응답)
  body: ObservedBody | null; // HTTP 응답을 받지 못했거나 본문을 읽기 전이면 null
  schema: SchemaCheckResult | null; // 스키마 확인 결과 (확인하지 못했으면 null)
};

export type ProbeInput = {
  policy: ProbePolicy;
  // 점검 전에 이미 "판단 불가"로 정해진 경우(승인 미확인·입력값 없음·선행 실패). 있으면 요청 결과와 관계없이 이것이 우선한다
  unverified?: UnverifiedReason | null;
  // 요청을 보내지 못한 경우의 사유 (observation이 null일 때 필수)
  notRunReason?: NotRunReason | null;
  observation: ProbeObservation | null;
};

const PARSE_FAILURE_CODES = new Set(["PARSE", "XML", "NO_CODE"]);

const fail = (code: FailCode): ProbeResult => ({ status: "FAIL", attempted: true, code });

// 정상으로 판정된 뒤, 주의(DEGRADED)할 점이 있는지 본다. 기준이 확정된 것만 적용한다.
function degradedReason(obs: ProbeObservation, policy: ProbePolicy): DegradedReason | null {
  if (obs.retries > 0) return "RETRIED_THEN_OK";
  if (obs.schema && obs.schema.warnings > 0) return "FIELD_WARNING";
  if (policy.slowMs !== null && obs.durationMs > policy.slowMs) return "SLOW_RESPONSE"; // 딱 기준값이면 지연이 아니다
  return null;
}

export function classifyProbe(input: ProbeInput): ProbeResult {
  const { policy, observation: obs } = input;

  // 1) 준비: 판단 불가로 정해진 점검은 요청 결과를 보지 않는다
  if (input.unverified) return { status: "UNVERIFIED", attempted: obs !== null, reason: input.unverified };

  // 요청을 보내지 못했다
  if (obs === null) {
    if (!input.notRunReason) throw new Error("요청을 보내지 못한 점검에는 미점검 사유(notRunReason)가 필요합니다.");
    return { status: "NOT_RUN", attempted: false, reason: input.notRunReason };
  }

  // 2) 연결
  if (obs.connection.kind === "timeout") return fail("TIMEOUT");
  if (obs.connection.kind === "network_error") return fail("HTTP_ERROR");

  // 3) 인증·한도: HTTP 수준
  const http = obs.connection.httpStatus;
  if (http === 401 || http === 403) return fail("AUTH_ERROR");
  if (http === 429) return fail("QUOTA_EXCEEDED");
  if (http < 200 || http >= 300) return fail("HTTP_ERROR");

  // 4) 업무 응답: HTTP 200이어도 본문의 결과코드를 해석한다
  const body = obs.body;
  if (body === null) return fail("SCHEMA_ERROR"); // 정상 응답인데 읽을 본문이 없다
  if (body.kind === "auth_or_quota") return fail(body.code === "22" ? "QUOTA_EXCEEDED" : "AUTH_ERROR");
  if (body.kind === "error") return fail(PARSE_FAILURE_CODES.has(body.code) ? "SCHEMA_ERROR" : "BUSINESS_ERROR");

  // 5) 스키마: 필수 응답 항목이 빠졌으면 실패. (확인하지 못했거나 필수 항목이 모두 있으면 통과)
  if (body.kind === "ok" && obs.schema && obs.schema.checked && !obs.schema.ok) return fail("SCHEMA_ERROR");

  // 6) 0건
  if (body.kind === "nodata") {
    // 무데이터를 기대한 점검(negative)이거나 명세상 허용된 API면 정상 무데이터
    if (policy.mode === "negative" || policy.noDataPolicy === "ALLOWED") {
      const reason = degradedReason(obs, policy);
      return reason ? { status: "DEGRADED", attempted: true, reason, hadData: false } : { status: "PASS_NO_DATA", attempted: true };
    }
    // 실데이터가 반드시 있다고 확인된 입력으로 점검했는데 0건이면 기대 데이터 없음 (Positive Probe 실패)
    if (policy.mode === "positive" && policy.expectDataKnown) return fail("POSITIVE_DATA_MISSING");
    // 그 밖: 정상 무데이터인지 확정할 근거가 없다 → 장애로 단정하지 않는다
    return { status: "UNVERIFIED", attempted: true, reason: "NO_DATA_UNCONFIRMED" };
  }

  // 7) 데이터가 왔다
  if (policy.mode === "negative") return { status: "UNVERIFIED", attempted: true, reason: "EXPECTATION_MISMATCH" }; // 무데이터를 기대했는데 데이터가 옴
  const reason = degradedReason(obs, policy);
  return reason ? { status: "DEGRADED", attempted: true, reason, hadData: true } : { status: "PASS_DATA", attempted: true };
}

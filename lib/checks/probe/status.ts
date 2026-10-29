// Design Ref: PRD 5-2-3(판정 상태 및 오류 분류), 3-1(지표 산식) — 합성 점검(Probe) 결과 상태 6종과 세부 사유
// 순수한 타입·상수·집계 함수다. DB·네트워크를 모른다.
// 핵심 원칙: UNVERIFIED(검증 불가)와 NOT_RUN(미점검)은 정상으로도 실패로도 세지 않는다.
//           우리 점검 요청에 관측된 결과일 뿐 온비드 서버 전체의 가용성이 아니다. (PRD 1-2, 3-3)

export const PROBE_STATUSES = ["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"] as const;
export type ProbeStatus = (typeof PROBE_STATUSES)[number];

// FAIL의 세부 오류 코드 (최소 7개, PRD 5-2-3)
export const FAIL_CODES = ["HTTP_ERROR", "TIMEOUT", "BUSINESS_ERROR", "SCHEMA_ERROR", "POSITIVE_DATA_MISSING", "AUTH_ERROR", "QUOTA_EXCEEDED"] as const;
export type FailCode = (typeof FAIL_CODES)[number];

// NOT_RUN의 사유: 실제 요청을 시도하지 못했다
export const NOT_RUN_REASONS = ["BUDGET_SKIP", "SCHEDULE_MISSED", "RUN_BLOCKED", "NO_SCHEDULE", "OPERATOR_STOPPED"] as const;
export type NotRunReason = (typeof NOT_RUN_REASONS)[number];

// UNVERIFIED의 사유: 판단할 수 없다 (API 자체 장애로 집계하지 않는다)
export const UNVERIFIED_REASONS = [
  "NO_VALID_INPUT", // 유효 입력값(선행 목록의 식별번호 등)이 없다
  "APPROVAL_UNCONFIRMED", // 서비스키 승인 범위를 확인하지 못했다
  "NOT_APPROVED", // 승인되지 않았다
  "MISSING_DOC", // 공식 명세가 없다
  "PRECONDITION_FAILED", // 선행 Probe가 실패해 이 점검을 할 수 없다
  "NO_DATA_UNCONFIRMED", // 0건이지만 정상 무데이터인지 확정할 근거가 없다
  "EXPECTATION_MISMATCH", // 무데이터를 기대한 점검에서 데이터가 왔다 (점검 설계 확인 필요)
] as const;
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];

// DEGRADED의 사유: 정상이지만 불완전하다 (기준이 확정된 경우에만 적용한다)
export const DEGRADED_REASONS = ["RETRIED_THEN_OK", "FIELD_WARNING", "SLOW_RESPONSE"] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

export type ProbeResult =
  | { status: "PASS_DATA"; attempted: true }
  | { status: "PASS_NO_DATA"; attempted: true }
  | { status: "DEGRADED"; attempted: true; reason: DegradedReason; hadData: boolean }
  | { status: "FAIL"; attempted: true; code: FailCode }
  | { status: "UNVERIFIED"; attempted: boolean; reason: UnverifiedReason }
  | { status: "NOT_RUN"; attempted: false; reason: NotRunReason };

export const PROBE_STATUS_LABEL: Record<ProbeStatus, string> = {
  PASS_DATA: "정상(실데이터 확인)",
  PASS_NO_DATA: "정상(데이터 없음)",
  DEGRADED: "주의",
  FAIL: "실패",
  UNVERIFIED: "검증 불가",
  NOT_RUN: "미점검",
};

export const FAIL_CODE_LABEL: Record<FailCode, string> = {
  HTTP_ERROR: "HTTP 오류",
  TIMEOUT: "시간 초과",
  BUSINESS_ERROR: "업무 결과코드 오류",
  SCHEMA_ERROR: "응답 구조 오류",
  POSITIVE_DATA_MISSING: "기대한 실데이터 없음",
  AUTH_ERROR: "서비스키·권한 문제",
  QUOTA_EXCEEDED: "호출 한도 초과",
};

// 로그·화면에 쓰는 한 줄 표기. 예: "FAIL(TIMEOUT)", "UNVERIFIED(NO_VALID_INPUT)", "PASS_DATA"
export function describeProbe(result: ProbeResult): string {
  switch (result.status) {
    case "FAIL":
      return `FAIL(${result.code})`;
    case "UNVERIFIED":
    case "NOT_RUN":
    case "DEGRADED":
      return `${result.status}(${result.reason})`;
    default:
      return result.status;
  }
}

// 서비스키·한도 문제는 "데이터 품질 이상징후를 만들지 않는" 실행으로 이어진다 (PRD 5-2-3)
export const isKeyOrQuotaProblem = (result: ProbeResult): boolean => result.status === "FAIL" && (result.code === "AUTH_ERROR" || result.code === "QUOTA_EXCEEDED");

export type ProbeSummary = {
  total: number;
  counts: Record<ProbeStatus, number>;
  attempted: number; // 실제 요청을 보낸 점검 수 (PASS·DEGRADED·FAIL, 그리고 요청은 보냈지만 판단하지 못한 UNVERIFIED)
  // 합계 검증: 상태별 수의 합 = 전체. 어긋나면 집계 코드가 틀린 것이다 (PRD 5-4 필수 지표)
  sumMatches: boolean;
  // 기본 정상 비율의 분자·분모 (PRD 3-1): "해당 Probe가 정상"(PASS_DATA·PASS_NO_DATA·DEGRADED) / "실제 시도한 수". 분모가 0이면 비율을 만들지 않는다
  basicOk: { ok: number; attempted: number; ratio: number | null };
  // 실데이터 검증률의 분자: PASS_DATA 수 (분모는 Positive Probe로 등록된 수로 호출하는 쪽이 정한다)
  passData: number;
};

export function summarizeProbes<T extends { status: ProbeStatus; attempted: boolean }>(results: readonly T[]): ProbeSummary {
  const counts = Object.fromEntries(PROBE_STATUSES.map((s) => [s, 0])) as Record<ProbeStatus, number>;
  for (const r of results) counts[r.status] += 1;
  const attempted = results.filter((r) => r.attempted).length;
  const ok = counts.PASS_DATA + counts.PASS_NO_DATA + counts.DEGRADED;
  return {
    total: results.length,
    counts,
    attempted,
    sumMatches: PROBE_STATUSES.reduce((sum, s) => sum + counts[s], 0) === results.length,
    basicOk: { ok, attempted, ratio: attempted > 0 ? ok / attempted : null },
    passData: counts.PASS_DATA,
  };
}

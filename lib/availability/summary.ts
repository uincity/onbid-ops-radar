// Design Ref: PRD 3-1(지표 산식), 5-4(일일 보고서 가용성), 3-3(품질 원칙) — 26종 가용성 집계 (순수 함수: DB 행 → 화면·보고서용 요약)
// 핵심 원칙
//  - 이 숫자는 "우리 점검 요청에 관측된 결과"일 뿐 온비드 서버 전체의 가용성이 아니다.
//  - 검증 불가(UNVERIFIED)·미점검(NOT_RUN)은 정상으로도 실패로도 세지 않는다. 분모에서 따로 보여 준다.
//  - PUBLIC 점검 결과만 쓴다. DEMO와 합산하지 않는다. 점검 기록이 없는 오퍼레이션은 "미점검(기록 없음)"이다.
import { API_REGISTRY, type ApiRegistry } from "@/lib/registry";
import { checkReadiness } from "@/lib/checks/probe/readiness";
import { FAIL_CODES, PROBE_STATUSES, summarizeProbes, type FailCode, type ProbeStatus } from "@/lib/checks/probe/status";
import { formatKst } from "@/lib/time";

// probe_results에서 읽은 행 (필요한 열만)
export type ProbeRow = { api_id: string; operation_id: string; status: string; attempted: boolean; reason: string | null; checked_at: string };

// 사유 코드의 한국어 표시 (UNVERIFIED·NOT_RUN·DEGRADED 사유 + 기록 없음)
export const REASON_LABEL: Record<string, string> = {
  NO_RECORD: "점검 기록 없음",
  NO_VALID_INPUT: "유효 입력값 없음",
  APPROVAL_UNCONFIRMED: "승인 미확인",
  NOT_APPROVED: "승인 안 됨",
  MISSING_DOC: "공식 명세 없음",
  PRECONDITION_FAILED: "선행 점검 실패",
  NO_DATA_UNCONFIRMED: "0건 (정상 무데이터 확정 불가)",
  EXPECTATION_MISMATCH: "무데이터 기대와 다른 응답",
  BUDGET_SKIP: "호출 한도로 건너뜀",
  SCHEDULE_MISSED: "예약 누락",
  RUN_BLOCKED: "다른 점검 실행 중",
  NO_SCHEDULE: "점검 예정 없음",
  OPERATOR_STOPPED: "담당자가 중단",
  RETRIED_THEN_OK: "재시도 후 정상",
  FIELD_WARNING: "일부 항목 경고",
  SLOW_RESPONSE: "응답 느림",
};

export type OperationAvailability = {
  key: string; // 서비스ID/오퍼레이션ID
  operationId: string;
  nameKr: string;
  status: ProbeStatus;
  reason: string | null; // FAIL 코드 · UNVERIFIED/NOT_RUN/DEGRADED 사유. 기록이 없으면 NO_RECORD
  attempted: boolean;
  ready: boolean; // 승인·입력값 면에서 요청을 보낼 수 있는 상태
  checkedAt: string | null; // 마지막 판정 시각 (KST 표시용)
  lastOkAt: string | null; // 마지막 정상 응답(PASS_DATA·PASS_NO_DATA·DEGRADED) 시각. 서비스 전체 점검 완료 시각과 다른 값이다
};

export type ServiceAvailability = { serviceId: string; name: string; operations: OperationAvailability[]; allPassData: boolean };

export type Ratio = { num: number; den: number; ratio: number | null }; // den이 0이면 ratio를 만들지 않는다
const ratio = (num: number, den: number): Ratio => ({ num, den, ratio: den > 0 ? num / den : null });

export type AvailabilitySummary = {
  registry: { target: number; registered: number; unconfirmed: number; operations: number };
  counts: Record<ProbeStatus, number>; // 오퍼레이션 수 기준 6종. 합계 = operations
  sumMatches: boolean;
  noRecord: number; // 점검 기록이 하나도 없어 미점검으로 센 오퍼레이션 수 (counts.NOT_RUN에 포함)
  ready: { ready: number; notReady: number };
  attemptRate: Ratio; // 실제 요청을 보낸 수 / 준비된 오퍼레이션 수
  basicOk: Ratio; // 해당 Probe가 정상 / 실제 시도한 수
  realData: { passData: number; positiveRegistered: number; ratio: Ratio }; // 실데이터 검증률: 분모는 Positive Probe로 등록된 수
  serviceCoverage: Ratio; // 전체 목표(26) 대비: 모든 오퍼레이션이 PASS_DATA인 서비스 수 / 26
  failByCode: Record<FailCode, number>;
  reasons: { unverified: Record<string, number>; notRun: Record<string, number> };
  services: ServiceAvailability[];
  lastCheckedAt: string | null; // 가장 최근 판정 시각 (서비스 전체 점검 완료 시각이 아니다)
};

const isStatus = (v: string): v is ProbeStatus => (PROBE_STATUSES as readonly string[]).includes(v);

// rows: 판정 행(가장 최근이 먼저). 오퍼레이션마다 첫 행을 "그 시점의 판정"으로 쓴다
// okRows: 정상 응답이었던 행(가장 최근이 먼저). 오퍼레이션마다 첫 행의 시각을 "마지막 정상 응답"으로 쓴다
export function summarizeAvailability(input: { rows: readonly ProbeRow[]; okRows: readonly ProbeRow[]; registry?: ApiRegistry }): AvailabilitySummary {
  const registry = input.registry ?? API_REGISTRY;
  const firstBy = (rows: readonly ProbeRow[]) => {
    const map = new Map<string, ProbeRow>();
    for (const r of rows) {
      const key = `${r.api_id}/${r.operation_id}`;
      if (!map.has(key)) map.set(key, r);
    }
    return map;
  };
  const latest = firstBy(input.rows);
  const lastOk = firstBy(input.okRows);

  const services: ServiceAvailability[] = [];
  const results: { status: ProbeStatus; attempted: boolean }[] = [];
  const failByCode = Object.fromEntries(FAIL_CODES.map((c) => [c, 0])) as Record<FailCode, number>;
  const unverified: Record<string, number> = {};
  const notRun: Record<string, number> = {};
  let noRecord = 0;
  let ready = 0;
  let attemptedReady = 0;
  let positiveRegistered = 0;
  let lastChecked: Date | null = null;

  for (const service of registry.services) {
    const operations: OperationAvailability[] = [];
    for (const operation of service.operations) {
      const key = `${service.serviceId}/${operation.operationId}`;
      const row = latest.get(key);
      const okRow = lastOk.get(key);
      const isReady = checkReadiness(operation, { hasValidInput: true }) === null;
      let status: ProbeStatus = "NOT_RUN";
      let reason: string | null = "NO_RECORD";
      let attempted = false;
      if (row && isStatus(row.status)) {
        status = row.status;
        reason = row.reason;
        attempted = row.attempted;
        const at = new Date(row.checked_at);
        if (lastChecked === null || at > lastChecked) lastChecked = at;
      } else {
        noRecord += 1;
      }
      if (status === "FAIL" && reason && reason in failByCode) failByCode[reason as FailCode] += 1;
      if (status === "UNVERIFIED") unverified[reason ?? "UNKNOWN"] = (unverified[reason ?? "UNKNOWN"] ?? 0) + 1;
      if (status === "NOT_RUN") notRun[reason ?? "UNKNOWN"] = (notRun[reason ?? "UNKNOWN"] ?? 0) + 1;
      if (isReady) {
        ready += 1;
        if (attempted) attemptedReady += 1;
      }
      if (operation.probe.mode === "positive") positiveRegistered += 1;
      results.push({ status, attempted });
      operations.push({
        key,
        operationId: operation.operationId,
        nameKr: operation.nameKr,
        status,
        reason,
        attempted,
        ready: isReady,
        checkedAt: row ? formatKst(new Date(row.checked_at)) : null,
        lastOkAt: okRow ? formatKst(new Date(okRow.checked_at)) : null,
      });
    }
    services.push({ serviceId: service.serviceId, name: service.name, operations, allPassData: operations.length > 0 && operations.every((o) => o.status === "PASS_DATA") });
  }

  const probeSummary = summarizeProbes(results);
  const passData = probeSummary.passData;
  return {
    registry: { target: registry.targetServices, registered: registry.services.length, unconfirmed: registry.unconfirmedServices, operations: results.length },
    counts: probeSummary.counts,
    sumMatches: probeSummary.sumMatches && probeSummary.total === results.length,
    noRecord,
    ready: { ready, notReady: results.length - ready },
    attemptRate: ratio(attemptedReady, ready),
    basicOk: ratio(probeSummary.basicOk.ok, probeSummary.basicOk.attempted),
    realData: { passData, positiveRegistered, ratio: ratio(passData, positiveRegistered) },
    serviceCoverage: ratio(services.filter((s) => s.allPassData).length, registry.targetServices),
    failByCode,
    reasons: { unverified, notRun },
    services,
    lastCheckedAt: lastChecked ? formatKst(lastChecked) : null,
  };
}

// Design Ref: PRD 5-4(필수 지표: 데이터 품질·실행 품질) — 일일 보고서의 "데이터 품질 규칙 적용 현황"과 "실행 품질" 집계 (순수 함수)
// 우리 점검 요청에 관측된 결과일 뿐 온비드 전체의 품질·가용성이 아니다. 품질 이상징후는 담당자가 확인하기 전까지 "의심"이다.
import { evaluateSchedule, type ScheduleRun, type ScheduleState } from "@/lib/schedule/status";
import { DQ_RULE_IDS } from "@/lib/anomalies/labels";
import { kstDayRange } from "@/lib/time";

export type QualityProbeRow = { api_id: string; operation_id: string; attempted: boolean };
export type QualityLogRow = { run_id: number | null; code: string; message: string };

export type QualitySection = {
  applicableApis: number; // 그날 실제로 요청을 보낸 오퍼레이션 수 (응답 구조 규칙의 대상)
  collectedItems: number; // 그날 수집·검사한 데이터 건수 (필수 항목·목록→상세 참조 규칙의 대상)
  rules: { ruleId: string; targets: number | null; suspected: number }[]; // targets가 null이면 적용 대상이 없어 적용 제외
  deferred: number; // 판정 보류(상세 조회 결과가 없어 정상 종료·철회 등과 구분할 수 없는 물건 수)
  notApplicableRuns: number; // 교차 참조 규칙이 "연결해서 비교할 API 점검이 없어" 적용 제외된 점검 실행 수
};

const DEFERRED_PATTERN = /판정 보류\(UNVERIFIED\)\s+(\d+)건/;

export function buildQualitySection(input: { probes: readonly QualityProbeRow[]; logs: readonly QualityLogRow[]; runIds: ReadonlySet<number>; collectedItems: number; newByRule: Readonly<Record<string, number>> }): QualitySection {
  const applicable = new Set(input.probes.filter((p) => p.attempted).map((p) => `${p.api_id}/${p.operation_id}`));
  const logs = input.logs.filter((l) => l.run_id !== null && input.runIds.has(l.run_id));
  const deferred = logs.filter((l) => l.code === "DQ_REF_UNVERIFIED").reduce((sum, l) => sum + Number(DEFERRED_PATTERN.exec(l.message)?.[1] ?? 0), 0);
  const notApplicableRuns = logs.filter((l) => l.code === "DQ_CROSS_API_NOT_APPLICABLE").length;
  const targetsOf: Record<string, number | null> = {
    DQ_SCHEMA: applicable.size,
    DQ_REQUIRED: input.collectedItems,
    DQ_LIST_DETAIL_REF: input.collectedItems,
    // 연결해서 비교할 API 점검이 있었던 날에는 대상이 생기겠지만, 지금은 적용 제외 기록만 있다
    DQ_CROSS_API_REF: notApplicableRuns > 0 ? null : 0,
  };
  return {
    applicableApis: applicable.size,
    collectedItems: input.collectedItems,
    // targets가 null(적용 제외)인 것을 0으로 바꾸지 않도록 ?? 를 쓰지 않는다
    rules: DQ_RULE_IDS.map((ruleId) => ({ ruleId, targets: ruleId in targetsOf ? targetsOf[ruleId] : 0, suspected: input.newByRule[ruleId] ?? 0 })),
    deferred,
    notApplicableRuns,
  };
}

export type ExecutionSection = {
  scheduleState: ScheduleState; // 예약 점검이 시작·완료되었는가 (NOT_DUE·WAITING·RUNNING·COMPLETED·PARTIAL·BLOCKED·FAILED·MISSED)
  scheduleTitle: string;
  scheduledRunCount: number; // 그날 시작한 예약 점검 실행 수 (차단 포함)
  lastFinishedAt: string | null; // 마지막으로 끝난 점검 실행의 종료 시각 (ISO). 서비스 전체 점검 완료 시각이며 API별 마지막 성공 시각과 다르다
  lastSucceededAt: string | null; // 마지막으로 정상 완료된 점검 실행의 종료 시각 (ISO)
};

export type ExecutionRunRow = ScheduleRun & { finished_at: string | null };

export function buildExecutionSection(input: { reportDate: string; coversUntil: Date; runs: readonly ExecutionRunRow[]; missedRecorded: boolean; graceMinutes: number }): ExecutionSection {
  // coversUntil은 집계 끝(포함하지 않음)이라, 지난 날짜면 "다음 날 00:00"이다. 그날 안의 마지막 순간(1ms 전)으로 상태를 판단한다
  const now = new Date(input.coversUntil.getTime() - 1);
  const status = evaluateSchedule({ now, runs: input.runs, missedRecorded: input.missedRecorded, graceMinutes: input.graceMinutes });
  const day = kstDayRange(input.reportDate);
  const finishedMs = (r: ExecutionRunRow) => (r.finished_at ? Date.parse(r.finished_at) : null);
  const latest = (rows: readonly ExecutionRunRow[]) => {
    const times = rows.map(finishedMs).filter((t): t is number => t !== null);
    return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
  };
  return {
    scheduleState: status.state,
    scheduleTitle: status.title,
    scheduledRunCount: input.runs.filter((r) => r.trigger === "scheduled" && Date.parse(r.started_at) >= day.start.getTime() && Date.parse(r.started_at) < day.end.getTime()).length,
    lastFinishedAt: latest(input.runs),
    lastSucceededAt: latest(input.runs.filter((r) => r.status === "succeeded")),
  };
}

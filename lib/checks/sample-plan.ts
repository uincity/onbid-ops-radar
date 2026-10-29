// 예시 운영 데이터 시드(npm run seed:sample)의 "계획"을 만드는 순수 함수 모음
// 화면(대시보드·목록·보고서)이 비어 보이지 않도록 DB에 넣을 예시 데이터의 내용을 정한다.
// 이 파일은 DB·네트워크·현재 시각을 전혀 쓰지 않는다. 같은 입력이면 항상 같은 결과가 나와서 가짜 데이터로 빠르게 시험할 수 있다.
// 실제로 DB에 넣는 일은 tests/unit/seed-sample-live.test.ts가 한다.
import type { AnomalyStatus, AnomalyVerdict } from "@/lib/anomalies/labels";
import { addDaysKst, kstDayRange, scheduledRunAt, toKstDateString } from "@/lib/time";
import type { ApiOutcome, LogLevel, RunStatus, RunTrigger } from "./types";

const SECOND_MS = 1000;

// ---------------------------------------------------------------------------
// 1. 안전장치: 처음 실행할 때만 동작한다
// ---------------------------------------------------------------------------
export type SeedState = {
  runningCount: number; // 지금 실행 중(running)인 점검 수
  anomalyCount: number; // 이미 있는 이상징후 수
};

export type SeedSafety = { ok: true } | { ok: false; reason: string };

// 이상징후 이력(anomaly_events)은 한번 적으면 지울 수 없어서, 이미 이상징후가 하나라도 있으면 다시 넣지 않는다.
export function checkSeedSafety(state: SeedState): SeedSafety {
  if (state.runningCount > 0) {
    return { ok: false, reason: "실행 중인 점검이 있어 중단합니다. 점검이 끝난 뒤 다시 실행해 주세요." };
  }
  if (state.anomalyCount > 0) {
    return { ok: false, reason: "이미 예시 데이터가 있어 중단합니다(이상징후 이력은 지울 수 없어 다시 넣을 수 없음)." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. 지난 6일치 과거 점검 이력 계획
// ---------------------------------------------------------------------------
export type PlannedApiCheck = {
  endpointName: string;
  httpStatus: number | null; // 타임아웃은 응답이 없어 null
  durationMs: number;
  outcome: ApiOutcome;
  recordCount: number | null;
  dataValid: boolean | null;
  checkedAt: Date;
};

export type PlannedLog = { level: LogLevel; code: string; message: string; loggedAt: Date };

export type PlannedRun = {
  label: string; // 사람이 읽는 설명 (출력용)
  dateKst: string; // 점검이 시작된 KST 날짜
  trigger: RunTrigger;
  status: RunStatus | "blocked";
  startedAt: Date;
  finishedAt: Date;
  apiCallCount: number;
  byAdmin: boolean; // 수동 점검을 누른 사람이 시연 팀장인지 (예약은 항상 false)
  apiChecks: PlannedApiCheck[];
  logs: PlannedLog[];
};

export const PAST_DAYS = 6;

// 날짜 순서(6일 전 → 어제)에 따른 하루치 모양. 사람이 보기에 자연스럽게 섞여 있다.
const DAY_KINDS = ["succeeded", "succeeded", "partial", "succeeded", "failed", "succeeded"] as const;
const START_JITTER_SECONDS = [12, 8, 21, 5, 17, 9]; // 예약 시각(09:00) 뒤 몇 초에 시작했나
const RUN_SECONDS = [42, 47, 58, 44, 24, 41]; // 점검이 걸린 시간(40초~1분, 실패한 날은 타임아웃 2번이라 짧게 끝남)
const LIST_MS = [128, 142, 312, 171, 0, 155]; // 목록 조회 응답시간(ms), 실패한 날은 쓰지 않음
const DETAIL_MS = [210, 187, 398, 264, 0, 198]; // 상세 조회 응답시간(ms)
const TIMEOUT_MS = 10_000; // 설정값 api_timeout_seconds(10초)와 같다. 이 숫자는 "과거 기록"을 꾸미는 값일 뿐 엔진 설정으로 쓰지 않는다.

export type DemoCounts = { list: number; detail: number };

// todayKst: 오늘의 KST 날짜("YYYY-MM-DD"). 호출하는 쪽이 lib/time의 toKstDateString(new Date())로 구해서 넘긴다.
export function buildPastRunPlan(todayKst: string, counts: DemoCounts = { list: 160, detail: 159 }): PlannedRun[] {
  const runs: PlannedRun[] = [];

  for (let i = 0; i < PAST_DAYS; i += 1) {
    const dateKst = addDaysKst(todayKst, i - PAST_DAYS); // 6일 전 ~ 어제
    const kind = DAY_KINDS[i];
    const startedAt = new Date(scheduledRunAt(dateKst).getTime() + START_JITTER_SECONDS[i] * SECOND_MS);
    const finishedAt = new Date(startedAt.getTime() + RUN_SECONDS[i] * SECOND_MS);
    const at = (seconds: number) => new Date(startedAt.getTime() + seconds * SECOND_MS);

    const logs: PlannedLog[] = [];
    let apiChecks: PlannedApiCheck[];

    if (kind === "failed") {
      // 두 조회 모두 10초 제한을 넘겨 타임아웃 → 실패
      apiChecks = [
        { endpointName: "demo-list", httpStatus: null, durationMs: TIMEOUT_MS, outcome: "timeout", recordCount: null, dataValid: null, checkedAt: at(10) },
        { endpointName: "demo-detail", httpStatus: null, durationMs: TIMEOUT_MS, outcome: "timeout", recordCount: null, dataValid: null, checkedAt: at(20) },
      ];
      logs.push(
        { level: "warn", code: "API_TIMEOUT", message: "'demo-list' 호출이 실패했습니다 (timeout).", loggedAt: at(10) },
        { level: "warn", code: "API_TIMEOUT", message: "'demo-detail' 호출이 실패했습니다 (timeout).", loggedAt: at(20) },
      );
    } else {
      apiChecks = [
        { endpointName: "demo-list", httpStatus: 200, durationMs: LIST_MS[i], outcome: "success", recordCount: counts.list, dataValid: true, checkedAt: at(2) },
        { endpointName: "demo-detail", httpStatus: 200, durationMs: DETAIL_MS[i], outcome: "success", recordCount: counts.detail, dataValid: true, checkedAt: at(30) },
      ];
      logs.push({ level: "info", code: "COMPARE_SKIPPED", message: `목록·상세 비교 제외 ${counts.list - counts.detail}건 (한쪽 조회 결과 없음) 예: DEMO-0158`, loggedAt: at(35) });
      if (kind === "partial") {
        logs.push({ level: "warn", code: "CALL_LIMIT_REACHED", message: "호출 상한 2회에 도달해 'demo-extra' 이후 작업을 하지 않았습니다.", loggedAt: at(40) });
      }
    }
    logs.sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());

    runs.push({
      label: `${dateKst} 예약 점검 (${kind})`,
      dateKst,
      trigger: "scheduled",
      status: kind,
      startedAt,
      finishedAt,
      apiCallCount: apiChecks.length,
      byAdmin: false,
      apiChecks,
      logs,
    });
  }

  // 어제 낮에 팀장이 수동 점검을 한 번 누르고, 그 점검이 도는 중에 한 번 더 눌러 차단(blocked)된 모습
  const yesterday = addDaysKst(todayKst, -1);
  const manualStart = new Date(kstDayRange(yesterday).start.getTime() + (14 * 3600 + 20 * 60 + 10) * SECOND_MS); // KST 14:20:10
  const manualEnd = new Date(manualStart.getTime() + 46 * SECOND_MS);
  const m = (seconds: number) => new Date(manualStart.getTime() + seconds * SECOND_MS);
  runs.push({
    label: `${yesterday} 수동 점검 (succeeded)`,
    dateKst: yesterday,
    trigger: "manual",
    status: "succeeded",
    startedAt: manualStart,
    finishedAt: manualEnd,
    apiCallCount: 2,
    byAdmin: true,
    apiChecks: [
      { endpointName: "demo-list", httpStatus: 200, durationMs: 133, outcome: "success", recordCount: counts.list, dataValid: true, checkedAt: m(2) },
      { endpointName: "demo-detail", httpStatus: 200, durationMs: 246, outcome: "success", recordCount: counts.detail, dataValid: true, checkedAt: m(30) },
    ],
    logs: [{ level: "info", code: "COMPARE_SKIPPED", message: `목록·상세 비교 제외 ${counts.list - counts.detail}건 (한쪽 조회 결과 없음) 예: DEMO-0158`, loggedAt: m(35) }],
  });
  const blockedAt = m(20);
  runs.push({
    label: `${yesterday} 수동 점검 (blocked: 이미 실행 중)`,
    dateKst: yesterday,
    trigger: "manual",
    status: "blocked",
    startedAt: blockedAt,
    finishedAt: blockedAt, // 차단 기록은 시작 즉시 끝난다 (start_check_run과 같은 모양)
    apiCallCount: 0,
    byAdmin: true,
    apiChecks: [],
    logs: [{ level: "warn", code: "RUN_BLOCKED", message: "이미 점검이 실행 중이라 새 실행을 시작하지 않았습니다.", loggedAt: blockedAt }],
  });

  return runs.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

// DB에 넣기 전에 DB 제약(check_runs·api_checks·run_logs)을 미리 지키는지 확인한다. 문제 목록을 돌려주고, 비어 있으면 통과다.
export function validatePastRunPlan(plan: readonly PlannedRun[]): string[] {
  const problems: string[] = [];
  const OUTCOMES = ["success", "http_error", "timeout", "auth_or_quota", "empty_result"];
  plan.forEach((run, index) => {
    const who = `#${index + 1} ${run.label}`;
    if (!["succeeded", "partial", "failed", "blocked"].includes(run.status)) problems.push(`${who}: 과거 기록은 running일 수 없습니다.`);
    if (run.finishedAt.getTime() < run.startedAt.getTime()) problems.push(`${who}: 종료 시각이 시작 시각보다 빠릅니다.`);
    if (run.trigger === "scheduled" && run.byAdmin) problems.push(`${who}: 예약 점검에는 시작한 사람이 없어야 합니다.`);
    if (run.trigger === "manual" && !run.byAdmin) problems.push(`${who}: 수동 점검에는 시작한 팀장이 있어야 합니다.`);
    if (run.apiCallCount < 0) problems.push(`${who}: 호출 횟수가 음수입니다.`);
    for (const check of run.apiChecks) {
      if (!/^[A-Za-z0-9_.-]{1,60}$/.test(check.endpointName)) problems.push(`${who}: API 이름 형식이 올바르지 않습니다 (${check.endpointName}).`);
      if (check.httpStatus !== null && (check.httpStatus < 100 || check.httpStatus > 599)) problems.push(`${who}: HTTP 상태 범위가 올바르지 않습니다.`);
      if (check.durationMs < 0) problems.push(`${who}: 응답시간이 음수입니다.`);
      if (!OUTCOMES.includes(check.outcome)) problems.push(`${who}: 알 수 없는 결과 구분입니다 (${check.outcome}).`);
      if (check.recordCount !== null && check.recordCount < 0) problems.push(`${who}: 건수가 음수입니다.`);
      if (check.checkedAt.getTime() < run.startedAt.getTime() || check.checkedAt.getTime() > run.finishedAt.getTime()) problems.push(`${who}: API 호출 시각이 점검 시간 밖입니다.`);
    }
    for (const log of run.logs) {
      if (!/^[A-Z][A-Z0-9_]{0,59}$/.test(log.code)) problems.push(`${who}: 메모 코드 형식이 올바르지 않습니다 (${log.code}).`);
      if (log.message.length < 1 || log.message.length > 500) problems.push(`${who}: 메모 길이는 1~500자여야 합니다.`);
      if (/servicekey=(?!\*)/i.test(log.message)) problems.push(`${who}: 메모에 인증키가 들어 있습니다.`);
    }
    if (run.status !== "blocked" && run.apiCallCount !== run.apiChecks.length) problems.push(`${who}: 호출 횟수와 API 점검 줄 수가 다릅니다.`);
  });
  return problems;
}

// 점검 실행 한 건의 KST 날짜 (run_logs.log_date에 쓴다. DB 기본값은 "지금"이라 과거 기록에는 직접 넣어야 한다)
export const logDateKst = (loggedAt: Date): string => toKstDateString(loggedAt);

// ---------------------------------------------------------------------------
// 3. 이상징후 처리 시나리오 (담당자 배정·검토·판정·종결·재개)
// ---------------------------------------------------------------------------
export type Actor = "admin" | "operator"; // 시연 팀장 / 시연 운영 담당자

export type TriageStep =
  | { kind: "assign"; anomalyId: number; actor: Actor; assignee: Actor } // actor가 assignee를 담당자로 지정(스스로 맡기 포함)
  | { kind: "verdict"; anomalyId: number; actor: Actor; verdict: AnomalyVerdict }
  | { kind: "status"; anomalyId: number; actor: Actor; toStatus: AnomalyStatus; verdict?: AnomalyVerdict; note?: string };

export const RESOLVE_NOTE = "가상 시연 데이터 원본 날짜를 정정하여 조치 완료";
export const DISMISS_NOTE = "시연용 경계 사례로 정상 데이터임을 확인함";
export const REOPEN_NOTE = "조치 뒤에도 같은 문제가 다시 확인되어 검토를 재개함";

// 처리 시나리오가 필요로 하는 최소 이상징후 수
export const MIN_TRIAGE_ANOMALIES = 12;

type Recipe = { assignedBy: Actor; end: "assigned" | "investigating" | "verdict" | "resolved" | "dismissed" | "reopened" };

// 앞에서부터 12건에 적용하는 처리 방법. 나머지는 미확인(open)으로 남겨 둔다.
//   0~4  : 운영 담당자가 스스로 맡기 (5건)
//   5~11 : 팀장이 운영 담당자에게 지정 (7건)
const RECIPES: Recipe[] = [
  { assignedBy: "operator", end: "assigned" },
  { assignedBy: "operator", end: "investigating" },
  { assignedBy: "operator", end: "verdict" },
  { assignedBy: "operator", end: "resolved" },
  { assignedBy: "operator", end: "dismissed" },
  { assignedBy: "admin", end: "assigned" },
  { assignedBy: "admin", end: "investigating" },
  { assignedBy: "admin", end: "resolved" },
  { assignedBy: "admin", end: "dismissed" },
  { assignedBy: "admin", end: "reopened" }, // 조치 완료 뒤 검토 재개
  { assignedBy: "admin", end: "resolved" },
  { assignedBy: "admin", end: "dismissed" },
];

// 이상징후 번호 목록(오름차순으로 정렬해서 쓴다)을 받아 실행할 단계를 순서대로 돌려준다.
// 단계 안에서 "최신 version 읽기"는 실행하는 쪽이 한다.
export function buildTriagePlan(anomalyIds: readonly number[]): TriageStep[] {
  const ids = [...anomalyIds].sort((a, b) => a - b);
  if (new Set(ids).size !== ids.length) throw new Error("이상징후 번호에 중복이 있습니다.");
  if (ids.length < MIN_TRIAGE_ANOMALIES) {
    throw new Error(`처리 시나리오에는 이상징후가 최소 ${MIN_TRIAGE_ANOMALIES}건 필요한데 ${ids.length}건뿐입니다.`);
  }

  const steps: TriageStep[] = [];
  RECIPES.forEach((recipe, index) => {
    const anomalyId = ids[index];
    // 처리는 담당자인 운영 담당자가 한다 (팀장은 지정과 재개를 맡는다)
    steps.push({ kind: "assign", anomalyId, actor: recipe.assignedBy, assignee: "operator" });
    if (recipe.end === "assigned") return;

    steps.push({ kind: "status", anomalyId, actor: "operator", toStatus: "investigating" });
    if (recipe.end === "investigating") return;

    const dismiss = recipe.end === "dismissed";
    const verdict: AnomalyVerdict = dismiss ? "false_positive" : "confirmed_issue";
    steps.push({ kind: "verdict", anomalyId, actor: "operator", verdict });
    if (recipe.end === "verdict") return;

    steps.push({ kind: "status", anomalyId, actor: "operator", toStatus: dismiss ? "dismissed" : "resolved", verdict, note: dismiss ? DISMISS_NOTE : RESOLVE_NOTE });
    if (recipe.end === "reopened") {
      steps.push({ kind: "status", anomalyId, actor: "admin", toStatus: "investigating", note: REOPEN_NOTE });
    }
  });
  return steps;
}

// 상태별 건수 세기 (최종 요약용)
export function tallyBy<T extends string>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

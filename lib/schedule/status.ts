// Design Ref: PRD 5-2-5 — 오늘의 예약 점검이 "예정 → 시작 → 완료"까지 갔는지 판단한다 (순수 함수, 읽기 전용)
// '실행됨'과 '실제로 완료됨'을 분리한다: 차단(blocked)·일부 완료(partial)·진행 중은 정상 완료로 세지 않고 경고를 남긴다.
// 08:30은 "시작 기록이 있는지" 확인하는 시각이지, 모든 점검이 30분 안에 끝나야 한다는 기한이 아니다.
import { scheduleMissedDeadline, scheduledRunAt, toKstDateString, formatKst, kstDayRange } from "@/lib/time";

export type ScheduleRun = { id: number; trigger: string; status: string; started_at: string };

export type ScheduleState =
  | "NOT_DUE" // 아직 예정 시각 전
  | "WAITING" // 예정 시각은 지났고 시작 확인 기한 전
  | "RUNNING" // 점검이 진행 중
  | "COMPLETED" // 정상 완료
  | "PARTIAL" // 실행됐지만 일부만 완료 (SCHEDULE_INCOMPLETE)
  | "BLOCKED" // 다른 점검이 실행 중이라 차단됨 (SCHEDULE_INCOMPLETE)
  | "FAILED" // 실행됐지만 실패 (SCHEDULE_INCOMPLETE)
  | "MISSED"; // 시작 기록이 기한까지 없음 (SCHEDULE_MISSED)

export type ScheduleStatus = {
  date: string; // KST 오늘
  state: ScheduleState;
  level: "ok" | "info" | "warning"; // warning이면 화면이 경고로 보여 준다
  title: string;
  detail: string;
  runId: number | null;
  scheduledAt: string; // 화면용 KST
  deadlineAt: string; // 화면용 KST (시작 확인 기한)
  missedRecorded: boolean; // 누락이 DB(run_logs)에 기록되었는가
};

export function evaluateSchedule(input: { now: Date; runs: readonly ScheduleRun[]; missedRecorded: boolean; graceMinutes: number }): ScheduleStatus {
  const date = toKstDateString(input.now);
  const { start, end } = kstDayRange(date);
  const scheduledAt = scheduledRunAt(date);
  const deadline = scheduleMissedDeadline(date, input.graceMinutes);
  const base = { date, scheduledAt: formatKst(scheduledAt), deadlineAt: formatKst(deadline), missedRecorded: input.missedRecorded };

  // 오늘(KST) 시작한 예약 점검, 가장 최근이 먼저. 수동 점검은 예약 점검을 대신하지 않는다
  const today = input.runs
    .filter((r) => r.trigger === "scheduled")
    .filter((r) => {
      const t = Date.parse(r.started_at);
      return t >= start.getTime() && t < end.getTime();
    })
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || b.id - a.id);

  if (today.length === 0) {
    const now = input.now.getTime();
    if (now < scheduledAt.getTime()) {
      return { ...base, state: "NOT_DUE", level: "info", title: "오늘 예약 점검 예정", detail: `KST ${base.scheduledAt.slice(11, 16)}에 시작할 예정입니다.`, runId: null };
    }
    if (now < deadline.getTime()) {
      return { ...base, state: "WAITING", level: "info", title: "예약 점검 시작 대기", detail: `예정 시각(${base.scheduledAt.slice(11, 16)})이 지났습니다. ${base.deadlineAt.slice(11, 16)}까지 시작 기록을 기다립니다.`, runId: null };
    }
    return {
      ...base,
      state: "MISSED",
      level: "warning",
      title: "오늘 예약 점검이 시작되지 않았습니다",
      detail: `${base.deadlineAt.slice(11, 16)}까지 예약 점검의 시작 기록이 없습니다.${input.missedRecorded ? " 누락이 기록되었습니다." : " 누락 기록은 아직 남지 않았습니다."} 팀장이 수동 점검을 실행할 수 있습니다.`,
      runId: null,
    };
  }

  // 같은 날 예약 점검이 여러 번이면(차단 뒤 재시도 등) 정상 완료가 하나라도 있으면 완료로 본다. 없으면 가장 최근 것
  const done = today.find((r) => r.status === "succeeded");
  const run = done ?? today[0];
  const link = { runId: run.id };
  switch (run.status) {
    case "succeeded":
      return { ...base, ...link, state: "COMPLETED", level: "ok", title: "오늘 예약 점검 완료", detail: `예약 점검 #${run.id}이 정상 완료되었습니다.` };
    case "running":
      return { ...base, ...link, state: "RUNNING", level: "info", title: "예약 점검 진행 중", detail: `예약 점검 #${run.id}이 아직 끝나지 않았습니다.` };
    case "partial":
      return { ...base, ...link, state: "PARTIAL", level: "warning", title: "예약 점검이 일부만 완료되었습니다", detail: `예약 점검 #${run.id}이 실행되었지만 일부 점검은 끝내지 못했습니다. 정상 완료가 아닙니다.` };
    case "blocked":
      return { ...base, ...link, state: "BLOCKED", level: "warning", title: "예약 점검이 차단되었습니다", detail: `다른 점검이 실행 중이어서 예약 점검 #${run.id}이 시작되지 못했습니다. 실제 점검은 이루어지지 않았습니다.` };
    default:
      return { ...base, ...link, state: "FAILED", level: "warning", title: "예약 점검이 실패했습니다", detail: `예약 점검 #${run.id}이 실행되었지만 실패했습니다.` };
  }
}

// Design Ref: docs/design-homepage-monitoring.md §5.7 / Plan W17 — 수동 점검(팀장의 "지금 점검")의 핵심 흐름 (순수: DB·네트워크·시각은 모두 밖에서 받는다)
// 하는 일: 점검이 켜져 있는지 확인 → 같은 점검 실행기를 trigger='manual'로 실행 → 결과를 돌려준다.
// 지키는 것: **기록만 한다.** 상태 전환(applyRunDecision)·사건·이상징후·알림·재확인 예약을 하지 않는다(그래서 상태 저장소·알림 발송기를 아예 받지 않는다).
//   정시 칸(slotAt)도 갖지 않아 정시 점검과 겹치지 않는다. 이미 점검이 실행 중이면 실행기가 blocked 줄을 남기고 RUN_IN_PROGRESS로 알린다.
// 로그인·팀장 확인은 이 함수를 부르는 서버 액션이 먼저 한다(여기는 누가 눌렀는지만 받는다).
import type { WebVerdict } from "./classify";
import type { ProbeClock, WebTransport } from "./probes/types";
import type { WebRunInput, WebRunReport } from "./runner";
import type { WebTarget } from "./schema";
import type { WebSettings } from "./settings";
import type { WebCheckStore } from "./store";

export type ManualCheckErrorCode = "MONITOR_DISABLED" | "RUN_IN_PROGRESS" | "INTERNAL";

export const MANUAL_CHECK_ERROR_TEXT: Record<ManualCheckErrorCode, string> = {
  MONITOR_DISABLED: "홈페이지 점검이 꺼져 있습니다.",
  RUN_IN_PROGRESS: "다른 점검이 실행 중입니다. 잠시 뒤 다시 시도해 주세요.",
  INTERNAL: "점검을 실행하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
};

export type ManualCheckResult =
  | { ok: true; targetKey: string; runId: number; status: "succeeded" | "partial" | "failed"; verdict: WebVerdict | null }
  | { ok: false; code: ManualCheckErrorCode; message: string };

export type ManualCheckDeps = {
  userId: string; // 지금 누른 팀장 (web_check_runs.triggered_by)
  // 설정을 못 읽거나 규칙에 어긋나면 던진다 (기본값으로 대신하지 않는다)
  prepare: () => Promise<{ settings: WebSettings; store: WebCheckStore }>;
  targets: () => readonly WebTarget[];
  transport: WebTransport;
  clock: ProbeClock;
  runWebCheck: (input: WebRunInput) => Promise<WebRunReport>;
};

const fail = (code: ManualCheckErrorCode): ManualCheckResult => ({ ok: false, code, message: MANUAL_CHECK_ERROR_TEXT[code] });

export async function runManualWebCheck(deps: ManualCheckDeps): Promise<ManualCheckResult> {
  let prepared: Awaited<ReturnType<ManualCheckDeps["prepare"]>>;
  try {
    prepared = await deps.prepare();
  } catch {
    return fail("INTERNAL"); // 설정 오류 문구는 내지 않는다
  }
  if (!prepared.settings.monitorEnabled) return fail("MONITOR_DISABLED");

  let report: WebRunReport;
  try {
    report = await deps.runWebCheck({
      trigger: "manual",
      triggeredBy: deps.userId,
      targets: deps.targets(),
      settings: prepared.settings,
      store: prepared.store,
      transport: deps.transport,
      clock: deps.clock,
    });
  } catch {
    return fail("INTERNAL");
  }

  const first = report.targets[0];
  if (!first) return fail("INTERNAL");
  if (first.status === "blocked") return fail("RUN_IN_PROGRESS");
  return { ok: true, targetKey: first.targetKey, runId: first.runId, status: first.status, verdict: first.overall };
}

// Design Ref: docs/design-homepage-monitoring.md §5.1(8. 후속 판단)·§5.2·§5.3 / Plan W11 — 점검 결과를 decide로 판단해 저장하거나 재확인을 예약하는 연결부
// 하는 일: 끝난 정시·재확인 실행의 판정 줄에서 decide 입력을 만들고, 결과가
//   defer → 확인 재시도 예약(enqueueConfirm)    planned/transition → record_web_transition 저장 (버전 충돌이면 상태를 다시 읽어 최대 3번)
// 지키는 것: 수동 점검은 이 연결부에 들어오지 않는다. 사건이 이미 열려 있으면 재확인은 하지 않는다. 알림 발송은 하지 않는다(W12).
import type { ProbeResult } from "./classify";
import { decide, isNormalFamily, type DecideInput } from "./decide";
import type { WebTargetRunReport } from "./runner";
import type { WebSettings } from "./settings";
import type { WebTransitionStore } from "./transition-store";

export const MAX_TRANSITION_ATTEMPTS = 3;

export type ApplyAction = "deferred" | "applied" | "planned" | "skipped" | "conflict";
export type ApplyOutcome = { action: ApplyAction; confirmQueued?: boolean; reason?: string; claimedKeys?: string[] }; // claimedKeys: 이번 전환에서 선점한 알림 키(바로 발송할 대상)

// 보조 확인의 이름: 판정 줄에는 층만 있어서 층 이름으로 정한다(알림 키 aux:{대상}:{이름}:{시작 실행}에 들어가므로 바꾸지 않는다)
const AUX_KEY: Record<string, string> = { AUX_STUB: "aux-stub", AUX_QUEUE: "aux-queue" };

/** 판정 줄들에서 decide 입력의 "관측" 부분을 뽑는다 (순수) */
export function observationFromProbes(probes: readonly ProbeResult[]) {
  const counting = probes.filter((p) => p.countsTowardOverall);
  return {
    primaryReason: counting.find((p) => p.reason !== null && !isNormalFamily(p.verdict))?.reason ?? null,
    maintenanceDetected: probes.some((p) => p.reason === "MAINTENANCE_DETECTED"),
    certExpiring: probes.some((p) => p.reason === "CERT_EXPIRING"),
    certDaysLeft: probes.find((p) => p.certDaysLeft !== null)?.certDaysLeft ?? null,
    aux: probes.filter((p) => p.layer in AUX_KEY).map((p) => ({ key: AUX_KEY[p.layer], verdict: p.verdict })),
  };
}

export type ApplyInput = {
  report: WebTargetRunReport; // 끝난 실행의 보고(정시 또는 재확인)
  trigger: "scheduled" | "retry";
  originRunId?: number | null; // 재확인이면 원래 정시 실행
  startedAt: Date; // 이번 실행의 시작 시각(창 판정·경과 시간 기준)
  settings: WebSettings;
  store: WebTransitionStore;
  isInWindow?: (targetKey: string, startedAt: Date) => Promise<boolean>; // 시험용 덮어쓰기. 없으면 저장소의 계획 점검 창(W15)을 본다
};

export async function applyRunDecision(input: ApplyInput): Promise<ApplyOutcome> {
  const { report, store, settings } = input;
  // 정상 종료된 실행만 상태를 바꾼다(실패·차단 실행은 판정이 없다)
  if ((report.status !== "succeeded" && report.status !== "partial") || report.overall === null) return { action: "skipped", reason: "not_completed" };
  if (report.storeError) return { action: "skipped", reason: "store_error" };

  // 점검의 started_at이 계획 점검 창 [시작, 종료) 안인가 (설계서 5.3 처리표)
  const inWindow = input.isInWindow ? await input.isInWindow(report.targetKey, input.startedAt) : await store.inMaintenance(report.targetKey, input.startedAt);
  const obs = observationFromProbes(report.probes);

  for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt++) {
    const state = await store.loadState(report.targetKey);
    // 사건이 이미 열려 있으면 재확인 결과를 평가하지 않는다(재확인은 사건이 없을 때만 예약된다)
    if (input.trigger === "retry" && state?.incident_open) return { action: "skipped", reason: "incident_open" };

    const decideInput: DecideInput = {
      targetKey: report.targetKey,
      runId: report.runId,
      trigger: input.trigger,
      originRunId: input.originRunId ?? null,
      now: input.startedAt,
      verdict: report.overall,
      primaryReason: obs.primaryReason,
      maintenanceDetected: obs.maintenanceDetected,
      certExpiring: obs.certExpiring,
      certDaysLeft: obs.certDaysLeft,
      aux: obs.aux,
      inWindow,
      state,
      settings,
    };
    const result = decide(decideInput);

    if (result.kind === "defer") {
      const queued = await store.enqueueConfirm({ targetKey: report.targetKey, originRunId: report.runId, delaySec: settings.confirmRetryDelaySec });
      return { action: "deferred", confirmQueued: queued !== null };
    }

    const saved = await store.recordTransition({ runId: report.runId, targetKey: report.targetKey, expectedVersion: state ? state.version : null, decision: result.decision });
    if (saved.result === "OK") {
      // 창 안에서 끝난 점검은 실행 줄에 계획 점검 표시를 남긴다(띠의 빗금 칸, 가용률 분모 제외). 표시 실패가 전환 저장을 되돌리지는 않는다
      if (inWindow) await store.markPlanned(report.runId).catch(() => false);
      return { action: result.kind === "planned" ? "planned" : "applied", claimedKeys: saved.claimed };
    }
    // CONFLICT: 그사이 다른 실행이 상태를 바꿨다 → 상태를 다시 읽어 판단을 다시 한다
  }
  return { action: "conflict" };
}

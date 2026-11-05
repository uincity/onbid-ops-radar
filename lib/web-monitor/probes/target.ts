// Design Ref: docs/design-homepage-monitoring.md §5.1(3~5단계) / Plan W03a — 대상 1개의 점검: 주 대상(L1~L3) 다음에 보조 확인
// 보조 확인 결과는 대표 판정에 들어가지 않는다(원칙 5). 주 대상이 실패해도 보조 확인은 계속해서, 스텁·대기열이 따로 살아 있는지 함께 기록한다.
import type { WebTarget } from "../schema";
import { probeAux } from "./aux-probe";
import { probePrimary, type PrimaryProbeDeps, type PrimaryProbeOutcome } from "./primary";
import type { ProbeResult } from "../classify";

export type TargetProbeOutcome = PrimaryProbeOutcome & { aux: ProbeResult[] };

export async function probeTarget(target: WebTarget, deps: PrimaryProbeDeps): Promise<TargetProbeOutcome> {
  const primary = await probePrimary(target, deps);
  const aux = await probeAux(deps.transport, deps.clock, target.aux, { timeoutMs: deps.cfg.timeoutMs, requestGapMs: deps.requestGapMs, deadlineMs: deps.deadlineMs });
  return { verdict: primary.verdict, requestCount: primary.requestCount + aux.requestCount, aux: aux.results };
}

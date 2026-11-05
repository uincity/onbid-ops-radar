// (파일 이름 주의: Windows에서 aux.ts는 예약 이름이라 aux-probe.ts로 둔다)
// Design Ref: docs/design-homepage-monitoring.md §5.1(4단계)·§11 / Plan W03a — 보조 확인 프로브 (진입 스텁, 대기열 설정 파일)
// 요청마다 허용 호스트를 검사하고 GET 한 번만 보낸다(리다이렉트는 따라가지 않는다: 스텁은 이동 "코드"를 확인하는 것이 목적).
// 판정은 classify-aux.ts. 결과는 대표 판정에서 제외된다.
import { checkAllowedUrl } from "../allowed-hosts";
import { classifyAuxQueue, classifyAuxStub, type AuxObservation } from "../classify-aux";
import type { ProbeResult } from "../classify";
import type { WebAuxTarget } from "../schema";
import { ProbeTransportError, type ProbeClock, type WebTransport } from "./types";

const AUX_MAX_BYTES = 200_000; // 스텁 781바이트, 대기열 설정 9KB 정도라 넉넉한 상한

export type AuxProbeOptions = { timeoutMs: number; requestGapMs: number; deadlineMs: number };

async function observeAux(transport: WebTransport, clock: ProbeClock, aux: WebAuxTarget, timeoutMs: number): Promise<AuxObservation> {
  const check = checkAllowedUrl(aux.url);
  if (!check.ok) return { kind: "host_not_allowed" }; // 요청하지 않는다
  const t0 = clock.now();
  try {
    const res = await transport.get(check.url.href, { timeoutMs, readBody: true, maxBytes: AUX_MAX_BYTES });
    return { kind: "response", status: res.status, durationMs: clock.now() - t0, location: res.location, body: res.body, url: check.url.href };
  } catch (e) {
    return { kind: e instanceof ProbeTransportError && e.kind === "timeout" ? "timeout" : "network_error" };
  }
}

// 대상의 보조 확인을 순서대로(동시 요청 없음) 실행한다. 시간 예산이 끝나면 남은 것은 미점검
export async function probeAux(transport: WebTransport, clock: ProbeClock, auxList: readonly WebAuxTarget[], opts: AuxProbeOptions): Promise<{ results: ProbeResult[]; requestCount: number }> {
  const results: ProbeResult[] = [];
  let requestCount = 0;
  for (const aux of auxList) {
    const remaining = opts.deadlineMs - clock.now();
    let obs: AuxObservation;
    if (remaining <= 0) {
      obs = { kind: "skipped" };
    } else {
      if (requestCount > 0 && opts.requestGapMs > 0) await clock.sleep(opts.requestGapMs);
      obs = await observeAux(transport, clock, aux, Math.max(1, Math.min(opts.timeoutMs, opts.deadlineMs - clock.now())));
      if (obs.kind !== "host_not_allowed") requestCount++;
    }
    results.push(aux.kind === "stub" ? classifyAuxStub(obs, aux.expectedRedirectPath ?? "") : classifyAuxQueue(obs));
  }
  return { results, requestCount };
}

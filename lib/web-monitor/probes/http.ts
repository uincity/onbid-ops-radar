// Design Ref: docs/design-homepage-monitoring.md §5.1(3단계 L2)·§8.2 / PRD-hp §6.2 / Plan W03 — L2 HTTP 프로브 (GET만, 리다이렉트 수동 추적)
// 요청마다(첫 요청과 이동할 때마다) https·허용 호스트 검사를 먼저 한다. 허용 밖이면 요청을 보내지 않고 "허용 호스트 밖"으로 남긴다.
// 전체 시간 상한은 timeoutMs 하나로 묶는다(이동이 많아도 합쳐서 10초). 시각·대기·네트워크는 밖에서 받는다.
import type { L2Observation } from "../classify";
import { checkAllowedUrl } from "../allowed-hosts";
import { MAX_BODY_BYTES, ProbeTransportError, type ProbeClock, type WebTransport } from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type HttpProbeOptions = {
  timeoutMs: number;
  maxRedirects: number;
  requestGapMs: number; // 요청과 요청 사이 간격 (서버 부담 줄이기)
  maintenanceUrlPatterns?: readonly string[]; // 최종 주소 경로와 맞으면 점검 안내 페이지로 본다 (정규식 문자열)
};
export type HttpProbeResult = { observation: L2Observation; body: string | null; bytes: number; finalUrl: string | null };

export async function observeL2(transport: WebTransport, clock: ProbeClock, startUrl: string, opts: HttpProbeOptions): Promise<HttpProbeResult> {
  const t0 = clock.now();
  const patterns = (opts.maintenanceUrlPatterns ?? []).map((p) => new RegExp(p));
  let raw = startUrl;
  let base: URL | undefined;
  let redirects = 0;

  for (let hop = 0; ; hop++) {
    const check = checkAllowedUrl(raw, base);
    if (!check.ok) return { observation: { kind: "host_not_allowed" }, body: null, bytes: 0, finalUrl: null }; // 요청하지 않는다
    if (hop > 0 && opts.requestGapMs > 0) await clock.sleep(opts.requestGapMs);
    const remaining = opts.timeoutMs - (clock.now() - t0);
    if (remaining <= 0) return { observation: { kind: "timeout" }, body: null, bytes: 0, finalUrl: null };

    let res;
    try {
      res = await transport.get(check.url.href, { timeoutMs: remaining, readBody: true, maxBytes: MAX_BODY_BYTES });
    } catch (e) {
      return { observation: { kind: e instanceof ProbeTransportError && e.kind === "timeout" ? "timeout" : "network_error" }, body: null, bytes: 0, finalUrl: null };
    }

    if (REDIRECT_STATUSES.has(res.status) && res.location) {
      redirects++;
      if (redirects > opts.maxRedirects) {
        // 상한을 넘으면 더 따라가지 않고 판정에 넘긴다 (10회까지 허용, 11회째에 멈춤)
        const durationMs = clock.now() - t0;
        return { observation: { kind: "response", status: res.status, durationMs, finalUrl: check.url.href, redirectCount: redirects, maintenanceUrlMatched: false }, body: null, bytes: 0, finalUrl: check.url.href };
      }
      raw = res.location;
      base = check.url;
      continue;
    }

    const durationMs = clock.now() - t0;
    const maintenanceUrlMatched = patterns.some((re) => re.test(check.url.pathname));
    return {
      observation: { kind: "response", status: res.status, durationMs, finalUrl: check.url.href, redirectCount: redirects, maintenanceUrlMatched },
      body: res.body,
      bytes: res.bytes,
      finalUrl: check.url.href,
    };
  }
}

// Design Ref: docs/design-homepage-monitoring.md §5.1(3~5단계) / Plan W03 — 주 대상 1개의 L1→L2→L3 관측과 판정을 이어 붙인다
// 앞 층이 실패·검증 불가·미점검이면 뒤 층은 요청 자체를 보내지 않는다(낭비·서버 부담 방지). 시간 예산이 끝나면 남은 층은 미점검.
import { blocksNext, classifyL1, classifyL2, classifyRun, type ClassifyConfig, type ContentRules, type L2Observation, type L3Observation, type WebRunObservation, type WebRunVerdict } from "../classify";
import type { WebTarget } from "../schema";
import { observeL1 } from "./connect";
import { countBundleFailures } from "./content";
import { observeL2 } from "./http";
import type { ProbeClock, WebTransport } from "./types";

export type PrimaryProbeDeps = {
  transport: WebTransport;
  clock: ProbeClock;
  cfg: ClassifyConfig;
  requestGapMs: number;
  deadlineMs: number; // 시간 예산이 끝나는 시각 (clock.now 기준)
  maintenanceUrlPatterns?: readonly string[];
};

export type PrimaryProbeOutcome = { verdict: WebRunVerdict; requestCount: number };

const skipped = { kind: "skipped" } as const;

export async function probePrimary(target: WebTarget, deps: PrimaryProbeDeps): Promise<PrimaryProbeOutcome> {
  const { transport, clock, cfg } = deps;
  const overBudget = () => clock.now() >= deps.deadlineMs;
  const rules: ContentRules = target.content;
  let requestCount = 0;

  // L1
  let l1: WebRunObservation["l1"] = skipped;
  if (!overBudget()) {
    l1 = await observeL1(transport, target.cert.host, target.cert.port, Math.min(cfg.timeoutMs, Math.max(1, deps.deadlineMs - clock.now())));
    requestCount += 1;
  }
  const l1Verdict = classifyL1(l1, clock.now(), cfg).connect.verdict;

  // L2 — L1이 막히지 않았을 때만
  let l2: L2Observation = skipped;
  let l3: L3Observation = skipped;
  if (!blocksNext(l1Verdict) && !overBudget()) {
    const http = await observeL2(transport, clock, target.primary.url, {
      timeoutMs: Math.min(cfg.timeoutMs, Math.max(1, deps.deadlineMs - clock.now())),
      maxRedirects: cfg.maxRedirects,
      requestGapMs: deps.requestGapMs,
      maintenanceUrlPatterns: deps.maintenanceUrlPatterns,
    });
    l2 = http.observation;
    requestCount += 1;
    const l2Verdict = classifyL2(l2, cfg).verdict;

    // L3 — 본문이 있고 L2가 막히지 않았을 때만. 본문은 L2의 같은 GET 결과를 쓴다(추가 요청 없음)
    if (!blocksNext(l2Verdict) && http.body !== null && !overBudget()) {
      const bundleFailures = await countBundleFailures(transport, clock, http.body, http.finalUrl ?? target.primary.url, target.content.bundlePaths, {
        timeoutMs: Math.min(cfg.timeoutMs, Math.max(1, deps.deadlineMs - clock.now())),
        requestGapMs: deps.requestGapMs,
      });
      requestCount += target.content.bundlePaths.length;
      l3 = { kind: "content", body: http.body, bytes: http.bytes, bundleFailures };
    }
  }

  return { verdict: classifyRun({ l1, l2, l3 }, rules, clock.now(), cfg), requestCount };
}

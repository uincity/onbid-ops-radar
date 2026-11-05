// Design Ref: docs/design-homepage-monitoring.md §5.1(흐름 ① 정시 점검 1~7단계)·§11 / Plan W06 — 점검 실행기: 대상 1개씩 시작 → 프로브 → 저장 → 종료
// 하는 일: 대상마다 (1) DB 함수로 안전하게 시작(동시 실행·같은 정시 칸 중복이면 blocked) (2) L1→L3와 보조 확인 (3) 층별 판정 저장 (4) 종료·대표 판정 기록.
// 지키는 것: 한 대상의 오류가 다른 대상을 막지 않고, 웹 전용 시간 예산을 대상들이 나눠 쓰며(남은 시간보다 긴 타임아웃 금지, 소진되면 미점검),
//   응답 본문·예외 원문은 어디에도 남기지 않는다. DB·네트워크·시각은 모두 밖에서 받는다(의존 주입) — 그래서 가짜 저장소로 시험할 수 있다.
// 이 파일은 알림·사건·상태 전환을 하지 않는다(M2의 W10a 이후). 입구 경로(W07)가 이 함수를 부른다.
import { base, out, type ClassifyConfig, type ProbeResult, type WebVerdict } from "./classify";
import { probeTarget, type TargetProbeOutcome } from "./probes/target";
import type { PrimaryProbeDeps } from "./probes/primary";
import type { ProbeClock, WebTransport } from "./probes/types";
import type { WebTarget } from "./schema";
import type { WebSettings } from "./settings";
import type { WebCheckStore, WebRunTrigger } from "./store";

// 리다이렉트 상한: 코드 상수(등록부 칸이 없다). 바꾸려면 등록부 스키마에 칸을 추가한다
export const WEB_MAX_REDIRECTS = 10;

// 웹 설정 → 판정에 쓰는 설정 (타임아웃·느림 기준·인증서 임박 기준·리다이렉트 상한)
export function toClassifyConfig(s: WebSettings): ClassifyConfig {
  return { timeoutMs: s.httpTimeoutMs, slowMs: s.httpSlowMs, certWarnDays: s.certWarnDays, maxRedirects: WEB_MAX_REDIRECTS };
}

export type WebRunInput = {
  trigger: WebRunTrigger;
  targets: readonly WebTarget[];
  settings: WebSettings;
  store: WebCheckStore;
  transport: WebTransport;
  clock: ProbeClock;
  triggeredBy?: string | null; // 수동 점검을 누른 팀장
  originRunId?: number | null; // 재확인이면 원래 실행
  slotAt?: Date | null; // 정시·대체 실행의 정시 칸 (scheduledSlotAt)
  maintenanceUrlPatterns?: readonly string[];
  probe?: (target: WebTarget, deps: PrimaryProbeDeps) => Promise<TargetProbeOutcome>; // 시험용으로 바꿔 끼운다
};

export type WebTargetRunReport = {
  targetKey: string;
  runId: number;
  status: "succeeded" | "partial" | "failed" | "blocked";
  overall: WebVerdict | null; // blocked면 null
  requestCount: number;
  finalized: boolean; // 종료 기록이 반영되었는가(멈춘 실행으로 먼저 정리되었으면 false)
  storeError: boolean; // 저장 중 DB 오류가 있었는가(내용은 남기지 않는다)
  probes: ProbeResult[]; // 저장한 층별 판정(본문 없음). 다음 단계(상태 전환)가 이 값을 쓴다
};
export type WebRunReport = { targets: WebTargetRunReport[] };

// 조회기 코드에서 예기치 않은 예외가 나면 내부 문구 없이 "검증 불가(INTERNAL_ERROR)" 한 줄로 남긴다
const internalErrorProbe = (): ProbeResult => out(base("L2_HTTP", true), "UNVERIFIED", "INTERNAL_ERROR");

export async function runWebCheck(input: WebRunInput): Promise<WebRunReport> {
  const { settings, store, transport, clock } = input;
  if ((input.trigger === "scheduled") !== (input.slotAt != null)) {
    throw new RangeError("정시 점검에만 정시 칸 시각(slotAt)을 줄 수 있고, 정시 점검에는 반드시 줘야 합니다.");
  }
  const cfg = toClassifyConfig(settings);
  const deadlineMs = clock.now() + settings.runTimeLimitSeconds * 1000; // 이번 점검 전체의 시간 예산(대상들이 나눠 쓴다)
  const probe = input.probe ?? probeTarget;
  const targets: WebTargetRunReport[] = [];

  for (const target of input.targets) {
    // 시작 입구에서 DB 오류가 나면 기록할 곳이 없으므로 위로 던진다(입구 경로가 내부 문구 없이 오류로 답한다)
    const started = await store.startRun({ targetKey: target.key, trigger: input.trigger, triggeredBy: input.triggeredBy ?? null, originRunId: input.originRunId ?? null, slotAt: input.slotAt ?? null });
    if (started.status === "blocked") {
      targets.push({ targetKey: target.key, runId: started.runId, status: "blocked", overall: null, requestCount: 0, finalized: true, storeError: false, probes: [] });
      continue;
    }

    let probes: ProbeResult[];
    let overall: WebVerdict;
    let requestCount = 0;
    let status: "succeeded" | "partial" | "failed";
    try {
      const outcome = await probe(target, { transport, clock, cfg, requestGapMs: settings.requestGapMs, deadlineMs, maintenanceUrlPatterns: input.maintenanceUrlPatterns });
      probes = [...outcome.verdict.probes, ...outcome.aux];
      overall = outcome.verdict.overall;
      requestCount = outcome.requestCount;
      // 시간 예산이 끝나 건너뛴 층이 있으면 일부만 점검한 것(partial)
      status = probes.some((p) => p.reason === "BUDGET_SKIP") ? "partial" : "succeeded";
    } catch {
      probes = [internalErrorProbe()];
      overall = "UNVERIFIED";
      status = "failed";
    }

    let storeError = false;
    let finalized = false;
    try {
      await store.saveProbeResults(started.runId, target.key, probes);
    } catch {
      storeError = true;
      status = "failed"; // 판정을 남기지 못했으면 정상 종료로 기록하지 않는다
    }
    try {
      finalized = await store.finishRun({ runId: started.runId, status, overallVerdict: overall, requestCount });
    } catch {
      storeError = true; // 종료를 못 적어도 멈춘 실행 정리(다음 시작 때)가 마감한다
    }
    targets.push({ targetKey: target.key, runId: started.runId, status, overall, requestCount, finalized, storeError, probes });
  }
  return { targets };
}

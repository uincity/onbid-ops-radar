// Design Ref: docs/design-homepage-monitoring.md §5.1(5단계 판정)·§8 / PRD-hp FR-3, §6.1~6.3·6.6 / Plan W02 — 웹 점검 판정 규칙(순수 함수)
// 프로브가 "관측한 사실"(상태 코드·응답 시간·본문·인증서 만료 시각)을 받아 6가지 판정으로 바꾼다.
// 네트워크·시각·DB를 쓰지 않는다: 같은 입력이면 항상 같은 판정이다(시각은 now를 밖에서 받는다).
// 사유(reason)는 DB의 닫힌 허용 목록(설계서 §6.1 web_probe_results)만 쓴다. 응답 본문·예외 원문은 결과에 담지 않는다.

export type WebVerdict = "PASS_DATA" | "PASS_NO_DATA" | "DEGRADED" | "FAIL" | "UNVERIFIED" | "NOT_RUN";

export type WebReason =
  | "TIMEOUT" | "SLOW_RESPONSE" | "DNS_FAILED" | "TCP_FAILED" | "TLS_FAILED" | "HTTP_5XX" | "HTTP_BLOCKED" | "HTTP_4XX_OTHER" | "HTTP_NOT_FOUND"
  | "MARKER_MISSING" | "TOO_SMALL" | "MAINTENANCE_DETECTED" | "BLOCK_PHRASE" | "CERT_EXPIRING" | "CERT_INVALID" | "REDIRECT_LIMIT"
  | "HOST_NOT_ALLOWED" | "STUB_CHANGED" | "UPSTREAM_FAILED" | "BUDGET_SKIP" | "INTERNAL_ERROR";

export type WebLayer = "L1_CONNECT" | "L2_HTTP" | "L3_CONTENT" | "AUX_STUB" | "AUX_QUEUE"; // AUX_*는 보조 확인(대표 판정 제외, W03a)

export type ClassifyConfig = {
  timeoutMs: number; // web_http_timeout_ms (기본 10000)
  slowMs: number; // web_http_slow_ms (기본 3000)
  certWarnDays: number; // web_cert_warn_days (기본 14)
  maxRedirects: number; // 리다이렉트 상한 (기본 10)
};
export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = { timeoutMs: 10_000, slowMs: 3_000, certWarnDays: 14, maxRedirects: 10 };

export type ProbeResult = {
  layer: WebLayer;
  countsTowardOverall: boolean; // false면 대표 판정에서 제외(인증서 임박 신호, 보조 확인)
  verdict: WebVerdict;
  reason: WebReason | null; // 정상이면 null
  httpStatus: number | null;
  durationMs: number | null;
  finalUrl: string | null; // 주소 뒤 질의·조각은 지운다(키·토큰 보호)
  certDaysLeft: number | null;
};

export const base = (layer: WebLayer, countsTowardOverall: boolean): ProbeResult => ({ layer, countsTowardOverall, verdict: "PASS_DATA", reason: null, httpStatus: null, durationMs: null, finalUrl: null, certDaysLeft: null });
export const out = (r: ProbeResult, verdict: WebVerdict, reason: WebReason | null, extra: Partial<ProbeResult> = {}): ProbeResult => ({ ...r, ...extra, verdict, reason });

// ---------- L1 접속 ----------
export type L1Observation =
  | { kind: "connected"; certNotAfterMs: number; hostnameMatches: boolean }
  | { kind: "dns_failed" | "tcp_failed" | "tls_failed" }
  | { kind: "skipped" }; // 시간 예산 소진

const DAY_MS = 24 * 60 * 60 * 1000;
// 남은 일수 = floor((만료 - 현재) / 24시간). 14일 0시간~14일 23시간 59분은 14일, 15일부터 15
export const certDaysLeft = (notAfterMs: number, nowMs: number): number => Math.floor((notAfterMs - nowMs) / DAY_MS);

export function classifyL1(obs: L1Observation, now: number, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG): { connect: ProbeResult; certExpiring: boolean; certDaysLeft: number | null } {
  const r = base("L1_CONNECT", true);
  switch (obs.kind) {
    case "skipped":
      return { connect: out(r, "NOT_RUN", "BUDGET_SKIP"), certExpiring: false, certDaysLeft: null };
    case "dns_failed":
      return { connect: out(r, "FAIL", "DNS_FAILED"), certExpiring: false, certDaysLeft: null };
    case "tcp_failed":
      return { connect: out(r, "FAIL", "TCP_FAILED"), certExpiring: false, certDaysLeft: null };
    case "tls_failed":
      return { connect: out(r, "FAIL", "TLS_FAILED"), certExpiring: false, certDaysLeft: null };
    case "connected": {
      const days = certDaysLeft(obs.certNotAfterMs, now);
      // 이미 만료됐거나(만료 시각이 지금 이전) 호스트명이 다르면 실패
      if (obs.certNotAfterMs <= now || !obs.hostnameMatches) return { connect: out(r, "FAIL", "CERT_INVALID", { certDaysLeft: days }), certExpiring: false, certDaysLeft: days };
      // 만료 임박은 대표 판정에 넣지 않는다: 연결 판정은 정상, 임박 신호만 따로 낸다
      return { connect: out(r, "PASS_DATA", null, { certDaysLeft: days }), certExpiring: days <= cfg.certWarnDays, certDaysLeft: days };
    }
  }
}

// 인증서 임박 신호를 "저하로 기록하되 대표 판정에서 제외"하는 별도 결과 줄로 만든다
export function certSignalResult(days: number): ProbeResult {
  return out(base("L1_CONNECT", false), "DEGRADED", "CERT_EXPIRING", { certDaysLeft: days });
}

// ---------- L2 HTTP ----------
export type L2Observation =
  | { kind: "response"; status: number; durationMs: number; finalUrl: string; redirectCount: number; maintenanceUrlMatched: boolean }
  | { kind: "timeout" }
  | { kind: "network_error" } // 접속 뒤 연결이 끊김 등
  | { kind: "host_not_allowed" } // 허용 호스트 밖으로 이동 — 요청하지 않음
  | { kind: "skipped" };

// 주소 뒤 질의·조각을 지운다(서비스키·토큰이 남지 않게). 깨진 주소는 기록하지 않는다
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

export function classifyL2(obs: L2Observation, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG, opts: { notFoundIsFail?: boolean } = {}): ProbeResult {
  const r = base("L2_HTTP", true);
  const notFoundIsFail = opts.notFoundIsFail ?? true; // main.do는 404·410이 실패, 스텁은 검증 불가(호출한 쪽이 false로 부름)
  switch (obs.kind) {
    case "skipped":
      return out(r, "NOT_RUN", "BUDGET_SKIP");
    case "host_not_allowed":
      return out(r, "UNVERIFIED", "HOST_NOT_ALLOWED");
    case "timeout":
      return out(r, "FAIL", "TIMEOUT");
    case "network_error":
      return out(r, "FAIL", "TCP_FAILED");
    case "response": {
      const extra = { httpStatus: obs.status, durationMs: obs.durationMs, finalUrl: safeUrl(obs.finalUrl) };
      if (obs.durationMs >= cfg.timeoutMs) return out(r, "FAIL", "TIMEOUT", extra); // 10000ms 이상은 타임아웃
      if (obs.redirectCount > cfg.maxRedirects) return out(r, "FAIL", "REDIRECT_LIMIT", extra); // 10회까지 허용, 11회부터 실패
      if (obs.maintenanceUrlMatched) return out(r, "FAIL", "MAINTENANCE_DETECTED", extra);
      const s = obs.status;
      if (s >= 500 && s <= 599) return out(r, "FAIL", "HTTP_5XX", extra);
      if (s === 401 || s === 403 || s === 429) return out(r, "UNVERIFIED", "HTTP_BLOCKED", extra); // 차단·제한 가능성: 실패로 세지 않음
      if (s === 404 || s === 410) return notFoundIsFail ? out(r, "FAIL", "HTTP_NOT_FOUND", extra) : out(r, "UNVERIFIED", "HTTP_NOT_FOUND", extra);
      if (s >= 400 && s <= 499) return out(r, "UNVERIFIED", "HTTP_4XX_OTHER", extra);
      if (s >= 200 && s <= 299) {
        if (obs.durationMs > cfg.slowMs) return out(r, "DEGRADED", "SLOW_RESPONSE", extra); // 3000ms는 정상, 3001ms부터 저하
        return out(r, "PASS_DATA", null, extra);
      }
      return out(r, "UNVERIFIED", "INTERNAL_ERROR", extra); // 100번대·남은 300번대: 기대하지 않은 상태 (예외 원문은 남기지 않음)
    }
  }
}

// ---------- L3 내용 ----------
export type ContentRules = { mustContain: readonly string[]; mustNotContain: readonly string[]; blockedPhrases: readonly string[]; minBytes: number };
// bundleFailures: 확인한 JS 번들 중 받지 못했거나(200 아님·오류·HTML에 주소 없음) 비어 있던 개수 (W03)
export type L3Observation = { kind: "content"; body: string; bytes: number; bundleFailures?: number } | { kind: "skipped" };

export function classifyL3(obs: L3Observation, rules: ContentRules): ProbeResult {
  const r = base("L3_CONTENT", true);
  if (obs.kind === "skipped") return out(r, "NOT_RUN", "BUDGET_SKIP");
  const extra = { httpStatus: null, durationMs: null };
  if (rules.mustNotContain.some((p) => obs.body.includes(p))) return out(r, "FAIL", "MAINTENANCE_DETECTED", extra); // 점검 문구는 계획/미등록으로 분리되는 실패
  const lower = obs.body.toLowerCase();
  if (rules.blockedPhrases.some((p) => lower.includes(p.toLowerCase()))) return out(r, "UNVERIFIED", "BLOCK_PHRASE", extra); // 차단 페이지: 사이트 장애가 아닐 수 있다
  if (rules.mustContain.some((m) => !obs.body.includes(m))) return out(r, "FAIL", "MARKER_MISSING", extra);
  if (obs.bytes < rules.minBytes) return out(r, "FAIL", "TOO_SMALL", extra); // 하한 이상이면 통과 (minBytes 바이트는 통과, 한 바이트 모자라면 실패)
  // JS 번들이 받아지지 않으면 화면이 깨진 것이다. 닫힌 사유 목록에 번들 전용 사유가 없어 "필수 요소 누락"(MARKER_MISSING)으로 기록한다
  if ((obs.bundleFailures ?? 0) > 0) return out(r, "FAIL", "MARKER_MISSING", extra);
  return out(r, "PASS_DATA", null, extra);
}

// ---------- 층 연결과 대표 판정 ----------
// 심각도 순서(PRD §6.6): 실패 > 저하 > 검증 불가 > 미점검 > 정상(무데이터) > 정상(데이터)
const SEVERITY: Record<WebVerdict, number> = { FAIL: 5, DEGRADED: 4, UNVERIFIED: 3, NOT_RUN: 2, PASS_NO_DATA: 1, PASS_DATA: 0 };
const worse = (a: WebVerdict, b: WebVerdict): WebVerdict => (SEVERITY[b] > SEVERITY[a] ? b : a);

// 대표 판정: "대표 판정에 포함되는" 프로브 중 가장 나쁜 판정. 포함되는 프로브가 없으면 미점검
export function representativeVerdict(results: readonly ProbeResult[]): WebVerdict {
  const counted = results.filter((p) => p.countsTowardOverall);
  if (counted.length === 0) return "NOT_RUN";
  return counted.map((p) => p.verdict).reduce(worse);
}

const upstream = (layer: WebLayer): ProbeResult => out(base(layer, true), "NOT_RUN", "UPSTREAM_FAILED");
export const blocksNext = (v: WebVerdict) => v === "FAIL" || v === "UNVERIFIED" || v === "NOT_RUN"; // 앞 층이 이 판정이면 뒤 층은 하지 않는다 (저하는 계속 진행)

export type WebRunObservation = { l1: L1Observation; l2: L2Observation; l3: L3Observation };
export type WebRunVerdict = {
  probes: ProbeResult[]; // 저장할 프로브 줄 (인증서 임박 신호가 있으면 제외 줄이 하나 더 들어간다)
  overall: WebVerdict;
  certExpiring: boolean;
  certDaysLeft: number | null;
  maintenanceDetected: boolean; // 점검 문구·점검 경로 감지 (계획/미등록 분리는 maintenance.ts)
};

// 주 대상 1개의 L1→L2→L3를 판정한다. 앞 층이 실패·검증 불가·미점검이면 뒤 층은 UPSTREAM_FAILED(미점검)
export function classifyRun(obs: WebRunObservation, rules: ContentRules, now: number, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG): WebRunVerdict {
  const l1 = classifyL1(obs.l1, now, cfg);
  const l2 = blocksNext(l1.connect.verdict) ? upstream("L2_HTTP") : classifyL2(obs.l2, cfg);
  const l3 = blocksNext(l1.connect.verdict) || blocksNext(l2.verdict) ? upstream("L3_CONTENT") : classifyL3(obs.l3, rules);
  const probes = [l1.connect, l2, l3];
  if (l1.certExpiring && l1.certDaysLeft !== null) probes.push(certSignalResult(l1.certDaysLeft));
  return {
    probes,
    overall: representativeVerdict(probes),
    certExpiring: l1.certExpiring,
    certDaysLeft: l1.certDaysLeft,
    maintenanceDetected: probes.some((p) => p.reason === "MAINTENANCE_DETECTED"),
  };
}

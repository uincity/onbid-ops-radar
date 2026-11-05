// Design Ref: docs/design-homepage-monitoring.md §5.1(4단계 보조 확인)·§3(원칙 5) / PRD-hp FR-3·§6.2 / Plan W03a — 보조 확인 판정 (순수 함수)
// 진입 스텁(이동 코드·이동 대상)과 대기열 설정 파일(200·JSON)을 판정한다. 결과는 모두 "대표 판정에서 제외"(countsTowardOverall=false)이고,
// 연속 횟수에 따른 별도 알림만 만든다(decide.ts의 일). 본문·예외 원문은 결과에 담지 않는다.
import { base, out, safeUrl, type ProbeResult } from "./classify";
import { checkAllowedUrl } from "./allowed-hosts";

export type AuxObservation =
  | { kind: "response"; status: number; durationMs: number; location: string | null; body: string | null; url: string }
  | { kind: "timeout" }
  | { kind: "network_error" }
  | { kind: "host_not_allowed" }
  | { kind: "skipped" };

// 스텁 본문에서 이동 주소를 찾는다: location.replace("…") / location.assign("…") / location.href = "…" (앞에 window.가 있어도 됨). 첫 번째만 본다
export function extractRedirectTarget(body: string): string | null {
  const m = /(?:window\.)?location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)|(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/.exec(body);
  return m ? (m[1] ?? m[2]) : null;
}

type Common = { r: ProbeResult; extra: Partial<ProbeResult> };

// 두 보조 확인에 공통인 오류 처리. 처리했으면 결과를, 정상 응답(2xx)이면 null을 돌려준다
function commonFailures(obs: AuxObservation, { r, extra }: Common, notFoundIsFail: boolean): ProbeResult | null {
  if (obs.kind === "skipped") return out(r, "NOT_RUN", "BUDGET_SKIP");
  if (obs.kind === "host_not_allowed") return out(r, "UNVERIFIED", "HOST_NOT_ALLOWED");
  if (obs.kind === "timeout") return out(r, "FAIL", "TIMEOUT");
  if (obs.kind === "network_error") return out(r, "FAIL", "TCP_FAILED");
  const s = obs.status;
  if (s >= 500 && s <= 599) return out(r, "FAIL", "HTTP_5XX", extra);
  if (s === 401 || s === 403 || s === 429) return out(r, "UNVERIFIED", "HTTP_BLOCKED", extra);
  if (s === 404 || s === 410) return out(r, notFoundIsFail ? "FAIL" : "UNVERIFIED", "HTTP_NOT_FOUND", extra);
  if (s >= 400 && s <= 499) return out(r, "UNVERIFIED", "HTTP_4XX_OTHER", extra);
  return null;
}

const extraOf = (obs: AuxObservation): Partial<ProbeResult> =>
  obs.kind === "response" ? { httpStatus: obs.status, durationMs: obs.durationMs, finalUrl: safeUrl(obs.url) } : {};

// 진입 스텁: 이동 대상이 기대한 경로(expectedPath)일 때만 정상. 모양이 바뀌면 실패가 아니라 "검증 불가"(STUB_CHANGED)
export function classifyAuxStub(obs: AuxObservation, expectedPath: string): ProbeResult {
  const r = base("AUX_STUB", false);
  const extra = extraOf(obs);
  // 스텁의 404는 검증 불가 (실제 화면 판정은 main.do가 한다)
  const failed = commonFailures(obs, { r, extra }, false);
  if (failed) return failed;
  if (obs.kind !== "response") return out(r, "UNVERIFIED", "INTERNAL_ERROR");

  let target: string | null = null;
  if (obs.status >= 300 && obs.status <= 399) target = obs.location; // 서버가 직접 이동시키는 방식으로 바뀐 경우도 허용
  else if (obs.status >= 200 && obs.status <= 299 && obs.body !== null) target = extractRedirectTarget(obs.body);
  else return out(r, "UNVERIFIED", "INTERNAL_ERROR", extra);

  if (target === null) return out(r, "UNVERIFIED", "STUB_CHANGED", extra); // 이동 코드가 사라짐
  const check = checkAllowedUrl(target, obs.url);
  if (!check.ok) return out(r, "UNVERIFIED", "HOST_NOT_ALLOWED", extra); // 허용 밖(또는 http)으로 이동시키려 함 — 따라가지 않는다
  if (check.url.pathname !== expectedPath) return out(r, "UNVERIFIED", "STUB_CHANGED", extra); // 이동 대상이 달라짐
  return out(r, "PASS_DATA", null, extra);
}

// 대기열 설정 파일: 200이고 JSON 객체여야 정상. 5xx·시간 초과는 실패(이용자가 대기실에 막힐 수 있음)
export function classifyAuxQueue(obs: AuxObservation): ProbeResult {
  const r = base("AUX_QUEUE", false);
  const extra = extraOf(obs);
  const failed = commonFailures(obs, { r, extra }, true);
  if (failed) return failed;
  if (obs.kind !== "response") return out(r, "UNVERIFIED", "INTERNAL_ERROR");
  if (obs.status !== 200 || obs.body === null) return out(r, "UNVERIFIED", "INTERNAL_ERROR", extra);
  try {
    const parsed: unknown = JSON.parse(obs.body);
    // 닫힌 사유 목록에 형식 오류 전용 사유가 없어 "필수 요소 누락"(MARKER_MISSING)으로 기록한다
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return out(r, "FAIL", "MARKER_MISSING", extra);
    return out(r, "PASS_DATA", null, extra);
  } catch {
    return out(r, "FAIL", "MARKER_MISSING", extra);
  }
}

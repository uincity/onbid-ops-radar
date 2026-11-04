// W02 웹 점검 판정 규칙: PRD-hp §6.1~6.3·6.6 표의 모든 행과 경계값
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSIFY_CONFIG as CFG,
  certDaysLeft,
  classifyL1,
  classifyL2,
  classifyL3,
  classifyRun,
  representativeVerdict,
  safeUrl,
  type ContentRules,
  type L2Observation,
  type ProbeResult,
} from "@/lib/web-monitor/classify";

const NOW = Date.UTC(2026, 10, 4, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("L1 접속", () => {
  const conn = (notAfterMs: number, hostnameMatches = true) => classifyL1({ kind: "connected", certNotAfterMs: notAfterMs, hostnameMatches }, NOW);
  it("DNS·TCP·TLS 실패는 FAIL", () => {
    expect(classifyL1({ kind: "dns_failed" }, NOW).connect).toMatchObject({ verdict: "FAIL", reason: "DNS_FAILED", countsTowardOverall: true });
    expect(classifyL1({ kind: "tcp_failed" }, NOW).connect).toMatchObject({ verdict: "FAIL", reason: "TCP_FAILED" });
    expect(classifyL1({ kind: "tls_failed" }, NOW).connect).toMatchObject({ verdict: "FAIL", reason: "TLS_FAILED" });
  });
  it("시간 예산 소진은 NOT_RUN(BUDGET_SKIP)", () => {
    expect(classifyL1({ kind: "skipped" }, NOW).connect).toMatchObject({ verdict: "NOT_RUN", reason: "BUDGET_SKIP" });
  });
  it("인증서 남은 일수 경계: 15일은 임박 아님, 14일 정각·14일 23시간은 임박", () => {
    const d15 = conn(NOW + 15 * DAY);
    expect(d15.certDaysLeft).toBe(15);
    expect(d15.certExpiring).toBe(false);
    const d14 = conn(NOW + 14 * DAY);
    expect(d14.certDaysLeft).toBe(14);
    expect(d14.certExpiring).toBe(true);
    const d14b = conn(NOW + 14 * DAY + 23 * HOUR); // 내림 계산 → 14일
    expect(d14b.certDaysLeft).toBe(14);
    expect(d14b.certExpiring).toBe(true);
    const d15b = conn(NOW + 15 * DAY - 1); // 14일 23시간 59분 59.999초 → 14
    expect(d15b.certExpiring).toBe(true);
  });
  it("임박해도 연결 판정은 정상(대표 판정에 영향 없음)", () => {
    const r = conn(NOW + 3 * DAY);
    expect(r.connect).toMatchObject({ verdict: "PASS_DATA", reason: null });
    expect(r.certExpiring).toBe(true);
  });
  it("만료·호스트명 불일치는 FAIL(CERT_INVALID), 만료 시각이 정확히 지금이어도 만료", () => {
    expect(conn(NOW - 1).connect).toMatchObject({ verdict: "FAIL", reason: "CERT_INVALID" });
    expect(conn(NOW).connect).toMatchObject({ verdict: "FAIL", reason: "CERT_INVALID" });
    expect(conn(NOW + 1).connect.verdict).toBe("PASS_DATA");
    expect(conn(NOW + 30 * DAY, false).connect).toMatchObject({ verdict: "FAIL", reason: "CERT_INVALID" });
  });
  it("certDaysLeft는 내림 계산(음수 포함)", () => {
    expect(certDaysLeft(NOW + DAY - 1, NOW)).toBe(0);
    expect(certDaysLeft(NOW - 1, NOW)).toBe(-1);
  });
});

describe("L2 HTTP", () => {
  const resp = (status: number, durationMs = 500, over: Partial<Extract<L2Observation, { kind: "response" }>> = {}): L2Observation => ({
    kind: "response", status, durationMs, finalUrl: "https://www.onbid.co.kr/a/main.do?serviceKey=SECRET#x", redirectCount: 0, maintenanceUrlMatched: false, ...over,
  });
  const verdict = (o: L2Observation, opts?: { notFoundIsFail?: boolean }) => {
    const r = classifyL2(o, CFG, opts);
    return `${r.verdict}/${r.reason}`;
  };
  it("타임아웃·네트워크 오류·허용 호스트 밖·예산 소진", () => {
    expect(verdict({ kind: "timeout" })).toBe("FAIL/TIMEOUT");
    expect(verdict({ kind: "network_error" })).toBe("FAIL/TCP_FAILED");
    expect(verdict({ kind: "host_not_allowed" })).toBe("UNVERIFIED/HOST_NOT_ALLOWED");
    expect(verdict({ kind: "skipped" })).toBe("NOT_RUN/BUDGET_SKIP");
  });
  it("응답 시간 경계: 9999ms는 저하, 10000ms는 타임아웃 실패", () => {
    expect(verdict(resp(200, 9999))).toBe("DEGRADED/SLOW_RESPONSE");
    expect(verdict(resp(200, 10000))).toBe("FAIL/TIMEOUT");
    expect(verdict(resp(200, 10001))).toBe("FAIL/TIMEOUT");
  });
  it("응답 시간 경계: 3000ms는 정상, 3001ms는 저하", () => {
    expect(verdict(resp(200, 3000))).toBe("PASS_DATA/null");
    expect(verdict(resp(200, 3001))).toBe("DEGRADED/SLOW_RESPONSE");
    expect(verdict(resp(204, 0))).toBe("PASS_DATA/null");
  });
  it("2xx 범위 경계: 200·299 정상, 199·300은 정상이 아님", () => {
    expect(verdict(resp(299))).toBe("PASS_DATA/null");
    expect(verdict(resp(199))).toBe("UNVERIFIED/INTERNAL_ERROR");
    expect(verdict(resp(300))).toBe("UNVERIFIED/INTERNAL_ERROR");
  });
  it("5xx는 FAIL (500·503·599), 600은 기대 밖", () => {
    for (const s of [500, 503, 599]) expect(verdict(resp(s))).toBe("FAIL/HTTP_5XX");
    expect(verdict(resp(600))).toBe("UNVERIFIED/INTERNAL_ERROR");
  });
  it("401·403·429는 검증 불가(차단·제한), 실패로 세지 않음", () => {
    for (const s of [401, 403, 429]) expect(verdict(resp(s))).toBe("UNVERIFIED/HTTP_BLOCKED");
  });
  it("404·410은 FAIL(주 대상), 보조(스텁)에서는 검증 불가", () => {
    for (const s of [404, 410]) {
      expect(verdict(resp(s))).toBe("FAIL/HTTP_NOT_FOUND");
      expect(verdict(resp(s), { notFoundIsFail: false })).toBe("UNVERIFIED/HTTP_NOT_FOUND");
    }
  });
  it("그 밖의 4xx는 검증 불가 (400·402·405·418·499)", () => {
    for (const s of [400, 402, 405, 418, 499]) expect(verdict(resp(s))).toBe("UNVERIFIED/HTTP_4XX_OTHER");
  });
  it("리다이렉트 경계: 10회는 통과, 11회는 REDIRECT_LIMIT", () => {
    expect(verdict(resp(200, 500, { redirectCount: 10 }))).toBe("PASS_DATA/null");
    expect(verdict(resp(200, 500, { redirectCount: 11 }))).toBe("FAIL/REDIRECT_LIMIT");
    expect(classifyL2(resp(200, 500, { redirectCount: 3 }), { ...CFG, maxRedirects: 2 }).reason).toBe("REDIRECT_LIMIT");
  });
  it("점검 안내 경로 일치는 상태 코드와 관계없이 MAINTENANCE_DETECTED 실패", () => {
    expect(verdict(resp(200, 500, { maintenanceUrlMatched: true }))).toBe("FAIL/MAINTENANCE_DETECTED");
    expect(verdict(resp(503, 500, { maintenanceUrlMatched: true }))).toBe("FAIL/MAINTENANCE_DETECTED");
  });
  it("최종 주소의 질의·조각은 기록하지 않는다(키·토큰 보호)", () => {
    const r = classifyL2(resp(200), CFG);
    expect(r.finalUrl).toBe("https://www.onbid.co.kr/a/main.do");
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(safeUrl("not a url")).toBeNull();
  });
  it("설정값을 바꾸면 경계도 따라간다 (slow 1000)", () => {
    expect(classifyL2(resp(200, 1001), { ...CFG, slowMs: 1000 }).verdict).toBe("DEGRADED");
    expect(classifyL2(resp(200, 1000), { ...CFG, slowMs: 1000 }).verdict).toBe("PASS_DATA");
  });
});

describe("L3 내용", () => {
  const rules: ContentRules = { mustContain: ["물건검색", "로그인"], mustNotContain: ["시스템 점검", "점검 중"], blockedPhrases: ["Access Denied", "Forbidden"], minBytes: 1000 };
  const body = "물건검색 로그인 정상 화면";
  const v = (b: string, bytes = 1000) => {
    const r = classifyL3({ kind: "content", body: b, bytes }, rules);
    return `${r.verdict}/${r.reason}`;
  };
  it("모두 통과하면 PASS_DATA, 크기 경계: 1000 통과·999 실패", () => {
    expect(v(body, 1000)).toBe("PASS_DATA/null");
    expect(v(body, 999)).toBe("FAIL/TOO_SMALL");
  });
  it("필수 문구 하나라도 빠지면 MARKER_MISSING", () => {
    expect(v("물건검색만 있음")).toBe("FAIL/MARKER_MISSING");
    expect(v("")).toBe("FAIL/MARKER_MISSING");
  });
  it("점검 문구는 MAINTENANCE_DETECTED (필수 문구가 있어도 우선)", () => {
    expect(v(body + " 시스템 점검 안내")).toBe("FAIL/MAINTENANCE_DETECTED");
    expect(v("점검 중")).toBe("FAIL/MAINTENANCE_DETECTED");
  });
  it("'점검'만 있는 낱말은 점검 문구가 아니다(구 단위로 찾음)", () => {
    expect(v(body + " 점검")).toBe("PASS_DATA/null");
  });
  it("차단 문구는 검증 불가(대소문자 무시), 점검 문구보다 뒤·표식 누락보다 앞", () => {
    expect(v("Access Denied")).toBe("UNVERIFIED/BLOCK_PHRASE");
    expect(v("access denied by waf")).toBe("UNVERIFIED/BLOCK_PHRASE");
    expect(v(body + " forbidden")).toBe("UNVERIFIED/BLOCK_PHRASE");
    expect(v("시스템 점검 Access Denied")).toBe("FAIL/MAINTENANCE_DETECTED");
  });
  it("예산 소진은 NOT_RUN", () => {
    expect(classifyL3({ kind: "skipped" }, rules)).toMatchObject({ verdict: "NOT_RUN", reason: "BUDGET_SKIP" });
  });
  it("결과에 본문이 들어가지 않는다", () => {
    expect(JSON.stringify(classifyL3({ kind: "content", body: "비밀본문XYZ", bytes: 5000 }, rules))).not.toContain("비밀본문XYZ");
  });
});

describe("대표 판정", () => {
  const p = (verdict: ProbeResult["verdict"], counts = true): ProbeResult => ({ layer: "L2_HTTP", countsTowardOverall: counts, verdict, reason: null, httpStatus: null, durationMs: null, finalUrl: null, certDaysLeft: null });
  it("우선순위 FAIL > DEGRADED > UNVERIFIED > NOT_RUN > PASS_NO_DATA > PASS_DATA", () => {
    const order = ["PASS_DATA", "PASS_NO_DATA", "NOT_RUN", "UNVERIFIED", "DEGRADED", "FAIL"] as const;
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        expect(representativeVerdict([p(order[i]), p(order[j])])).toBe(order[Math.max(i, j)]);
      }
    }
  });
  it("대표 판정에 포함되지 않는 프로브는 무시, 포함 프로브가 없으면 NOT_RUN", () => {
    expect(representativeVerdict([p("PASS_DATA"), p("FAIL", false)])).toBe("PASS_DATA");
    expect(representativeVerdict([p("FAIL", false)])).toBe("NOT_RUN");
    expect(representativeVerdict([])).toBe("NOT_RUN");
  });
});

describe("classifyRun (L1→L2→L3 연결)", () => {
  const rules: ContentRules = { mustContain: ["로그인"], mustNotContain: ["점검 중"], blockedPhrases: ["Access Denied"], minBytes: 100 };
  const okL1 = { kind: "connected", certNotAfterMs: NOW + 60 * DAY, hostnameMatches: true } as const;
  const okL2 = (over: Partial<Extract<L2Observation, { kind: "response" }>> = {}): L2Observation => ({ kind: "response", status: 200, durationMs: 800, finalUrl: "https://www.onbid.co.kr/main.do", redirectCount: 1, maintenanceUrlMatched: false, ...over });
  const okL3 = { kind: "content", body: "로그인", bytes: 500 } as const;

  it("모두 정상이면 대표 PASS_DATA, 프로브 3줄", () => {
    const r = classifyRun({ l1: okL1, l2: okL2(), l3: okL3 }, rules, NOW);
    expect(r.overall).toBe("PASS_DATA");
    expect(r.probes.map((x) => x.layer)).toEqual(["L1_CONNECT", "L2_HTTP", "L3_CONTENT"]);
    expect(r.certExpiring).toBe(false);
    expect(r.maintenanceDetected).toBe(false);
  });
  it("L1 실패면 L2·L3는 UPSTREAM_FAILED(미점검), 대표는 FAIL", () => {
    const r = classifyRun({ l1: { kind: "dns_failed" }, l2: okL2(), l3: okL3 }, rules, NOW);
    expect(r.overall).toBe("FAIL");
    expect(r.probes.slice(1).map((x) => `${x.verdict}/${x.reason}`)).toEqual(["NOT_RUN/UPSTREAM_FAILED", "NOT_RUN/UPSTREAM_FAILED"]);
  });
  it("L2가 실패·검증 불가면 L3는 하지 않는다", () => {
    expect(classifyRun({ l1: okL1, l2: okL2({ status: 503 }), l3: okL3 }, rules, NOW).probes[2]).toMatchObject({ verdict: "NOT_RUN", reason: "UPSTREAM_FAILED" });
    const blocked = classifyRun({ l1: okL1, l2: okL2({ status: 403 }), l3: okL3 }, rules, NOW);
    expect(blocked.overall).toBe("UNVERIFIED");
    expect(blocked.probes[2].reason).toBe("UPSTREAM_FAILED");
  });
  it("L2가 저하(느림)여도 L3는 계속 진행하고 대표는 저하", () => {
    const r = classifyRun({ l1: okL1, l2: okL2({ durationMs: 3500 }), l3: okL3 }, rules, NOW);
    expect(r.probes[2].verdict).toBe("PASS_DATA");
    expect(r.overall).toBe("DEGRADED");
  });
  it("L3 표식 누락은 대표 FAIL, 점검 문구는 maintenanceDetected 표시", () => {
    expect(classifyRun({ l1: okL1, l2: okL2(), l3: { kind: "content", body: "없음", bytes: 500 } }, rules, NOW).overall).toBe("FAIL");
    const m = classifyRun({ l1: okL1, l2: okL2(), l3: { kind: "content", body: "로그인 점검 중", bytes: 500 } }, rules, NOW);
    expect(m.overall).toBe("FAIL");
    expect(m.maintenanceDetected).toBe(true);
  });
  it("점검 경로(L2)가 감지되면 L3를 하지 않아도 maintenanceDetected", () => {
    const r = classifyRun({ l1: okL1, l2: okL2({ maintenanceUrlMatched: true }), l3: okL3 }, rules, NOW);
    expect(r.maintenanceDetected).toBe(true);
    expect(r.overall).toBe("FAIL");
  });
  it("인증서 임박이 있어도 대표 판정은 저하가 되지 않는다(제외 줄이 따로 추가됨)", () => {
    const r = classifyRun({ l1: { kind: "connected", certNotAfterMs: NOW + 14 * DAY, hostnameMatches: true }, l2: okL2(), l3: okL3 }, rules, NOW);
    expect(r.overall).toBe("PASS_DATA");
    expect(r.certExpiring).toBe(true);
    expect(r.certDaysLeft).toBe(14);
    expect(r.probes).toHaveLength(4);
    expect(r.probes[3]).toMatchObject({ verdict: "DEGRADED", reason: "CERT_EXPIRING", countsTowardOverall: false });
  });
  it("인증서 임박 + 실제 느림이면 대표는 저하(느림 때문)", () => {
    const r = classifyRun({ l1: { kind: "connected", certNotAfterMs: NOW + 5 * DAY, hostnameMatches: true }, l2: okL2({ durationMs: 4000 }), l3: okL3 }, rules, NOW);
    expect(r.overall).toBe("DEGRADED");
  });
  it("인증서 만료는 FAIL이고 뒤 층은 하지 않는다", () => {
    const r = classifyRun({ l1: { kind: "connected", certNotAfterMs: NOW - DAY, hostnameMatches: true }, l2: okL2(), l3: okL3 }, rules, NOW);
    expect(r.overall).toBe("FAIL");
    expect(r.probes[0].reason).toBe("CERT_INVALID");
    expect(r.probes[1].reason).toBe("UPSTREAM_FAILED");
  });
  it("같은 입력이면 같은 결과(결정적)", () => {
    const a = classifyRun({ l1: okL1, l2: okL2(), l3: okL3 }, rules, NOW);
    const b = classifyRun({ l1: okL1, l2: okL2(), l3: okL3 }, rules, NOW);
    expect(a).toEqual(b);
  });
  it("예산 소진: L1 소진이면 전부 미점검(대표 NOT_RUN)", () => {
    const r = classifyRun({ l1: { kind: "skipped" }, l2: { kind: "skipped" }, l3: { kind: "skipped" } }, rules, NOW);
    expect(r.overall).toBe("NOT_RUN");
  });
});

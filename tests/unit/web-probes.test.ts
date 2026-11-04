// W03 프로브: 가짜 전송 계층으로 시나리오(503·타임아웃·점검 문구·표식 누락·차단·리다이렉트 루프·허용 밖 이동·인증서 만료·번들)를 시험
import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFY_CONFIG as CFG } from "@/lib/web-monitor/classify";
import { observeL1 } from "@/lib/web-monitor/probes/connect";
import { countBundleFailures, extractBundleUrls } from "@/lib/web-monitor/probes/content";
import { observeL2 } from "@/lib/web-monitor/probes/http";
import { probePrimary } from "@/lib/web-monitor/probes/primary";
import { ProbeTransportError, type ProbeClock, type TransportGetOptions, type TransportGetResult, type WebTransport } from "@/lib/web-monitor/probes/types";
import { findWebTarget } from "@/lib/web-monitor/registry";

const MAIN = "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
const DAY = 24 * 60 * 60 * 1000;
const NOW0 = Date.UTC(2026, 10, 4, 0, 0, 0);

type Reply = Partial<TransportGetResult> & { cost?: number; throwKind?: ProbeTransportError["kind"] };
// 가짜 전송 계층: 요청 기록(주소·옵션), 주소별 응답, 시계(응답마다 cost만큼 흐름)
function fake(routes: Record<string, Reply | Reply[]>, tlsReply: { notAfterMs: number; hostnameMatches: boolean } | ProbeTransportError = { notAfterMs: NOW0 + 60 * DAY, hostnameMatches: true }, lookupErr = false) {
  let t = NOW0;
  const calls: { url: string; opts: TransportGetOptions }[] = [];
  const sleeps: number[] = [];
  const counters: Record<string, number> = {};
  const transport: WebTransport = {
    async lookup() {
      if (lookupErr) throw new ProbeTransportError("dns_failed");
    },
    async tls() {
      if (tlsReply instanceof ProbeTransportError) throw tlsReply;
      return tlsReply;
    },
    async get(url, opts) {
      calls.push({ url, opts });
      const entry = routes[url];
      if (!entry) throw new ProbeTransportError("network_error");
      const list = Array.isArray(entry) ? entry : [entry];
      const i = (counters[url] = (counters[url] ?? -1) + 1);
      const r = list[Math.min(i, list.length - 1)];
      t += r.cost ?? 100;
      if (r.throwKind) throw new ProbeTransportError(r.throwKind);
      const body = r.body ?? null;
      return { status: r.status ?? 200, location: r.location ?? null, bytes: r.bytes ?? (body ? new TextEncoder().encode(body).length : 0), body };
    },
  };
  const clock: ProbeClock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
  return { transport, clock, calls, sleeps };
}

const GOOD_HTML = `<title>온비드</title> 조건검색 공고검색 회원가입 로그인 <script src="/js/op_main.js?version=123"></script>`;
const bigBody = (html: string) => html + "x".repeat(310_000); // 하한(300,000바이트) 이상
const opts = (o: Partial<{ timeoutMs: number; maxRedirects: number; requestGapMs: number }> = {}) => ({ timeoutMs: 10_000, maxRedirects: 10, requestGapMs: 0, ...o });
const target = findWebTarget("onbid-home")!;
const deps = (f: ReturnType<typeof fake>, over: Record<string, unknown> = {}) => ({ transport: f.transport, clock: f.clock, cfg: CFG, requestGapMs: 0, deadlineMs: NOW0 + 60_000, ...over });

describe("L1 접속 프로브", () => {
  it("정상이면 인증서 정보를 돌려준다", async () => {
    const f = fake({});
    expect(await observeL1(f.transport, "www.onbid.co.kr", 443, 1000)).toMatchObject({ kind: "connected", hostnameMatches: true });
  });
  it("DNS 실패 / TCP 실패 / TLS 실패 / 시간 초과(TCP로 분류)", async () => {
    expect(await observeL1(fake({}, undefined, true).transport, "h", 443, 1000)).toEqual({ kind: "dns_failed" });
    expect(await observeL1(fake({}, new ProbeTransportError("tcp_failed")).transport, "h", 443, 1000)).toEqual({ kind: "tcp_failed" });
    expect(await observeL1(fake({}, new ProbeTransportError("tls_failed")).transport, "h", 443, 1000)).toEqual({ kind: "tls_failed" });
    expect(await observeL1(fake({}, new ProbeTransportError("timeout")).transport, "h", 443, 1000)).toEqual({ kind: "tcp_failed" });
  });
  it("모르는 예외는 내부 문구 없이 TLS 실패", async () => {
    const t = fake({}).transport;
    t.tls = async () => { throw new Error("secret internal"); };
    expect(JSON.stringify(await observeL1(t, "h", 443, 1000))).not.toContain("secret");
  });
});

describe("L2 HTTP 프로브", () => {
  it("정상 응답: 상태·응답 시간·본문·최종 주소를 관측", async () => {
    const f = fake({ [MAIN]: { body: "abc", cost: 250 } });
    const r = await observeL2(f.transport, f.clock, MAIN, opts());
    expect(r.observation).toMatchObject({ kind: "response", status: 200, durationMs: 250, redirectCount: 0 });
    expect(r.body).toBe("abc");
  });
  it("리다이렉트를 따라가고 횟수를 센다 (이동마다 요청 간격을 둔다)", async () => {
    const f = fake({ "https://www.onbid.co.kr/": { status: 302, location: "/a" }, "https://www.onbid.co.kr/a": { status: 301, location: MAIN }, [MAIN]: { body: "ok" } });
    const r = await observeL2(f.transport, f.clock, "https://www.onbid.co.kr/", opts({ requestGapMs: 500 }));
    expect(r.observation).toMatchObject({ kind: "response", status: 200, redirectCount: 2, finalUrl: MAIN });
    expect(f.sleeps).toEqual([500, 500]);
  });
  it("리다이렉트 경계: 10회는 따라가 응답, 11회째는 멈추고 상한 초과로 관측", async () => {
    const chain = (n: number) => {
      const routes: Record<string, Reply> = {};
      for (let i = 0; i < n; i++) routes[`https://www.onbid.co.kr/h${i}`] = { status: 302, location: `/h${i + 1}` };
      routes[`https://www.onbid.co.kr/h${n}`] = { body: "end" };
      return routes;
    };
    const ten = await observeL2(fake(chain(10)).transport, fake(chain(10)).clock, "https://www.onbid.co.kr/h0", opts());
    expect(ten.observation).toMatchObject({ kind: "response", status: 200, redirectCount: 10 });
    const f11 = fake(chain(11));
    const eleven = await observeL2(f11.transport, f11.clock, "https://www.onbid.co.kr/h0", opts());
    expect(eleven.observation).toMatchObject({ redirectCount: 11 });
    expect(f11.calls).toHaveLength(11); // 12번째 요청은 보내지 않음
  });
  it("리다이렉트 루프는 상한에서 멈춘다 (무한 반복 없음)", async () => {
    const f = fake({ "https://www.onbid.co.kr/a": { status: 302, location: "/b" }, "https://www.onbid.co.kr/b": { status: 302, location: "/a" } });
    const r = await observeL2(f.transport, f.clock, "https://www.onbid.co.kr/a", opts());
    expect(r.observation).toMatchObject({ redirectCount: 11 });
    expect(f.calls.length).toBeLessThanOrEqual(11);
  });
  it("허용 호스트 밖으로 이동하면 그 주소로 요청하지 않는다", async () => {
    const f = fake({ [MAIN]: { status: 302, location: "https://evil.com/steal" }, "https://evil.com/steal": { body: "no" } });
    const r = await observeL2(f.transport, f.clock, MAIN, opts());
    expect(r.observation).toEqual({ kind: "host_not_allowed" });
    expect(f.calls.map((c) => c.url)).toEqual([MAIN]);
  });
  it("http로 낮추는 이동·내부망 이동도 요청하지 않는다", async () => {
    for (const loc of ["http://www.onbid.co.kr/x", "https://169.254.169.254/latest", "https://127.0.0.1/"]) {
      const f = fake({ [MAIN]: { status: 302, location: loc } });
      expect((await observeL2(f.transport, f.clock, MAIN, opts())).observation).toEqual({ kind: "host_not_allowed" });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("시작 주소가 허용 밖이면 한 번도 요청하지 않는다", async () => {
    const f = fake({});
    expect((await observeL2(f.transport, f.clock, "http://example.com/", opts())).observation).toEqual({ kind: "host_not_allowed" });
    expect(f.calls).toHaveLength(0);
  });
  it("타임아웃: 전송 계층 시간 초과 / 이동으로 합쳐 상한을 넘김", async () => {
    expect((await observeL2(fake({ [MAIN]: { throwKind: "timeout" } }).transport, fake({}).clock, MAIN, opts())).observation).toEqual({ kind: "timeout" });
    const f = fake({ "https://www.onbid.co.kr/a": { status: 302, location: "/b", cost: 6000 }, "https://www.onbid.co.kr/b": { status: 302, location: "/c", cost: 6000 }, "https://www.onbid.co.kr/c": { body: "x" } });
    expect((await observeL2(f.transport, f.clock, "https://www.onbid.co.kr/a", opts())).observation).toEqual({ kind: "timeout" });
  });
  it("요청에 남은 시간만 허용한다 (이동할수록 줄어듦)", async () => {
    const f = fake({ "https://www.onbid.co.kr/a": { status: 302, location: "/b", cost: 4000 }, "https://www.onbid.co.kr/b": { body: "x" } });
    await observeL2(f.transport, f.clock, "https://www.onbid.co.kr/a", opts());
    expect(f.calls[0].opts.timeoutMs).toBe(10_000);
    expect(f.calls[1].opts.timeoutMs).toBe(6000);
  });
  it("네트워크 오류는 network_error", async () => {
    expect((await observeL2(fake({ [MAIN]: { throwKind: "network_error" } }).transport, fake({}).clock, MAIN, opts())).observation).toEqual({ kind: "network_error" });
  });
  it("점검 안내 경로 패턴과 맞으면 표시", async () => {
    const f = fake({ [MAIN]: { status: 302, location: "/maintenance/notice.do" }, "https://www.onbid.co.kr/maintenance/notice.do": { body: "x" } });
    const r = await observeL2(f.transport, f.clock, MAIN, { ...opts(), maintenanceUrlPatterns: ["^/maintenance/"] });
    expect(r.observation).toMatchObject({ maintenanceUrlMatched: true });
  });
  it("요청은 모두 읽기(GET) 전용 옵션이다 — 전송 계층에 쓰기 메서드가 없다", () => {
    const f = fake({});
    expect(Object.keys(f.transport).sort()).toEqual(["get", "lookup", "tls"]);
  });
});

describe("L3 번들 확인", () => {
  it("HTML에서 등록된 경로의 번들 주소를 뽑는다 (version 값은 그대로, 허용 밖·다른 경로는 무시)", () => {
    const html = `<script src="/js/op_main.js?version=9"></script><script src="https://evil.com/js/op_main.js"></script><script src='/js/other.js'></script>`;
    const r = extractBundleUrls(html, MAIN, ["/js/op_main.js", "/js/component.js"]);
    expect(r.found.get("/js/op_main.js")).toBe("https://www.onbid.co.kr/js/op_main.js?version=9");
    expect(r.missing).toEqual(["/js/component.js"]);
  });
  it("번들 실패 수: 정상 0, 404 1, 오류 1, HTML에 없음 1, 빈 응답 1", async () => {
    const url = "https://www.onbid.co.kr/js/op_main.js?version=1";
    const html = `<script src="/js/op_main.js?version=1"></script>`;
    const count = async (route: Reply | null, h = html) => {
      const f = fake(route ? { [url]: route } : {});
      return countBundleFailures(f.transport, f.clock, h, MAIN, ["/js/op_main.js"], { timeoutMs: 5000, requestGapMs: 0 });
    };
    expect(await count({ status: 200, bytes: 5000 })).toBe(0);
    expect(await count({ status: 404, bytes: 100 })).toBe(1);
    expect(await count({ throwKind: "timeout" })).toBe(1);
    expect(await count({ status: 200, bytes: 0 })).toBe(1);
    expect(await count(null, "<html></html>")).toBe(1);
  });
});

describe("주 대상 전체 흐름 (probePrimary)", () => {
  const route = (over: Reply = {}) => ({
    [MAIN]: { body: bigBody(GOOD_HTML), cost: 400, ...over },
    "https://www.onbid.co.kr/js/op_main.js?version=123": { status: 200, bytes: 5000, cost: 50 },
  });

  it("정상: 대표 PASS_DATA, 요청은 GET만, 본문은 L2와 같은 요청을 재사용", async () => {
    const f = fake(route());
    const r = await probePrimary(target, deps(f));
    expect(r.verdict.overall).toBe("PASS_DATA");
    expect(f.calls.filter((c) => c.url === MAIN)).toHaveLength(1);
    expect(f.calls.map((c) => c.url)).toEqual([MAIN, "https://www.onbid.co.kr/js/op_main.js?version=123"]);
  });
  it("503이면 FAIL이고 L3·번들 요청은 보내지 않는다", async () => {
    const f = fake(route({ status: 503, body: "err" }));
    const r = await probePrimary(target, deps(f));
    expect(r.verdict.overall).toBe("FAIL");
    expect(r.verdict.probes[1].reason).toBe("HTTP_5XX");
    expect(r.verdict.probes[2].reason).toBe("UPSTREAM_FAILED");
    expect(f.calls).toHaveLength(1);
  });
  it("타임아웃이면 FAIL(TIMEOUT)", async () => {
    const r = await probePrimary(target, deps(fake(route({ throwKind: "timeout" }))));
    expect(r.verdict.overall).toBe("FAIL");
    expect(r.verdict.probes[1].reason).toBe("TIMEOUT");
  });
  it("점검 문구면 FAIL(MAINTENANCE_DETECTED)이고 점검 감지 표시", async () => {
    const r = await probePrimary(target, deps(fake(route({ body: bigBody(GOOD_HTML + " 시스템 점검 중입니다") }))));
    expect(r.verdict.overall).toBe("FAIL");
    expect(r.verdict.maintenanceDetected).toBe(true);
  });
  it("표식 누락이면 FAIL(MARKER_MISSING)", async () => {
    const r = await probePrimary(target, deps(fake(route({ body: bigBody("<title>온비드</title> 조건검색") }))));
    expect(r.verdict.probes[2].reason).toBe("MARKER_MISSING");
  });
  it("차단 페이지(Access Denied)는 UNVERIFIED(BLOCK_PHRASE)", async () => {
    const r = await probePrimary(target, deps(fake(route({ body: "Access Denied", status: 200 }))));
    expect(r.verdict.overall).toBe("UNVERIFIED");
    expect(r.verdict.probes[2].reason).toBe("BLOCK_PHRASE");
  });
  it("403은 UNVERIFIED(HTTP_BLOCKED)이고 L3는 하지 않는다", async () => {
    const f = fake(route({ status: 403, body: "no" }));
    const r = await probePrimary(target, deps(f));
    expect(r.verdict.overall).toBe("UNVERIFIED");
    expect(f.calls).toHaveLength(1);
  });
  it("본문이 하한보다 작으면 FAIL(TOO_SMALL)", async () => {
    const r = await probePrimary(target, deps(fake(route({ body: GOOD_HTML }))));
    expect(r.verdict.probes[2].reason).toBe("TOO_SMALL");
  });
  it("JS 번들이 404면 FAIL", async () => {
    const f = fake({ [MAIN]: { body: bigBody(GOOD_HTML) }, "https://www.onbid.co.kr/js/op_main.js?version=123": { status: 404, bytes: 10 } });
    expect((await probePrimary(target, deps(f))).verdict.overall).toBe("FAIL");
  });
  it("리다이렉트 루프는 FAIL(REDIRECT_LIMIT), 허용 밖 이동은 UNVERIFIED(HOST_NOT_ALLOWED)", async () => {
    const loop = fake({ [MAIN]: { status: 302, location: MAIN } });
    expect((await probePrimary(target, deps(loop))).verdict.probes[1].reason).toBe("REDIRECT_LIMIT");
    const off = fake({ [MAIN]: { status: 302, location: "https://evil.com/" } });
    const r = await probePrimary(target, deps(off));
    expect(r.verdict.overall).toBe("UNVERIFIED");
    expect(r.verdict.probes[1].reason).toBe("HOST_NOT_ALLOWED");
    expect(off.calls.map((c) => c.url)).toEqual([MAIN]);
  });
  it("인증서: 만료는 FAIL이고 뒤 층 요청을 보내지 않음 / 14일 남음은 대표 판정에 영향 없이 임박 신호", async () => {
    const expired = fake(route(), { notAfterMs: NOW0 - DAY, hostnameMatches: true });
    const r1 = await probePrimary(target, deps(expired));
    expect(r1.verdict.overall).toBe("FAIL");
    expect(expired.calls).toHaveLength(0);
    const soon = fake(route(), { notAfterMs: NOW0 + 14 * DAY, hostnameMatches: true });
    const r2 = await probePrimary(target, deps(soon));
    expect(r2.verdict.overall).toBe("PASS_DATA");
    expect(r2.verdict.certExpiring).toBe(true);
  });
  it("DNS 실패·TLS 실패면 L2 요청 없이 FAIL", async () => {
    const dns = fake(route(), undefined, true);
    expect((await probePrimary(target, deps(dns))).verdict.probes[0].reason).toBe("DNS_FAILED");
    expect(dns.calls).toHaveLength(0);
    const tlsFail = fake(route(), new ProbeTransportError("tls_failed"));
    expect((await probePrimary(target, deps(tlsFail))).verdict.probes[0].reason).toBe("TLS_FAILED");
  });
  it("응답이 느리면 저하(3001ms), 정상이면 3000ms", async () => {
    expect((await probePrimary(target, deps(fake(route({ cost: 3001 }))))).verdict.overall).toBe("DEGRADED");
    expect((await probePrimary(target, deps(fake(route({ cost: 3000 }))))).verdict.overall).toBe("PASS_DATA");
  });
  it("시간 예산이 이미 끝났으면 요청 없이 전부 NOT_RUN", async () => {
    const f = fake(route());
    const r = await probePrimary(target, deps(f, { deadlineMs: NOW0 }));
    expect(r.verdict.overall).toBe("NOT_RUN");
    expect(f.calls).toHaveLength(0);
  });
  it("L2 뒤 예산이 끝나면 L3는 미점검", async () => {
    const f = fake(route({ cost: 400 }));
    const r = await probePrimary(target, deps(f, { deadlineMs: NOW0 + 300 }));
    expect(r.verdict.probes[2].verdict).toBe("NOT_RUN");
  });
  it("요청 사이에 설정한 간격만큼 쉰다 (번들 요청 전)", async () => {
    const f = fake(route());
    await probePrimary(target, deps(f, { requestGapMs: 500 }));
    expect(f.sleeps).toEqual([500]);
  });
  it("결과에 본문·질의 문자열이 남지 않는다", async () => {
    const f = fake(route({ status: 302, location: `${MAIN}?serviceKey=SECRET` }));
    f.transport.get = async (url) => (url.includes("serviceKey") ? { status: 200, location: null, bytes: 320_000, body: bigBody(GOOD_HTML) } : { status: 302, location: `${MAIN}?serviceKey=SECRET`, bytes: 0, body: null });
    const r = await probePrimary(target, deps(f));
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(JSON.stringify(r)).not.toContain("조건검색");
  });
});

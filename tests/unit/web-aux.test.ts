// W03a 보조 프로브: 진입 스텁·대기열 설정 판정(순수), 프로브 동작(가짜 전송 계층), 대표 판정에 영향 없음
import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFY_CONFIG as CFG } from "@/lib/web-monitor/classify";
import { classifyAuxQueue, classifyAuxStub, extractRedirectTarget, type AuxObservation } from "@/lib/web-monitor/classify-aux";
import { probeAux } from "@/lib/web-monitor/probes/aux-probe";
import { probeTarget } from "@/lib/web-monitor/probes/target";
import { ProbeTransportError, type ProbeClock, type TransportGetOptions, type TransportGetResult, type WebTransport } from "@/lib/web-monitor/probes/types";
import { findWebTarget } from "@/lib/web-monitor/registry";

const MAIN_PATH = "/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do";
const MAIN = `https://www.onbid.co.kr${MAIN_PATH}`;
const STUB_URL = "https://www.onbid.co.kr/";
const QUEUE_URL = "https://wait.onbid.co.kr/assets/nf-setting/1/nf-setting.json";
const STUB_HTML = `<html><script src="https://www.onbid.co.kr/x.js"></script><script>
window.location.replace("${MAIN}");
</script></html>`;

const resp = (over: Partial<Extract<AuxObservation, { kind: "response" }>> = {}): AuxObservation => ({ kind: "response", status: 200, durationMs: 40, location: null, body: STUB_HTML, url: STUB_URL, ...over });

describe("extractRedirectTarget", () => {
  it("replace·assign·href 방식을 찾고 첫 번째만 본다", () => {
    expect(extractRedirectTarget('window.location.replace("https://a/")')).toBe("https://a/");
    expect(extractRedirectTarget("location.assign('/b')")).toBe("/b");
    expect(extractRedirectTarget('window.location.href = "/c"')).toBe("/c");
    expect(extractRedirectTarget('location.replace("/first"); location.replace("/second")')).toBe("/first");
  });
  it("이동 코드가 없으면 null", () => {
    expect(extractRedirectTarget("<html>no script</html>")).toBeNull();
    expect(extractRedirectTarget("")).toBeNull();
  });
});

describe("진입 스텁 판정", () => {
  const v = (o: AuxObservation) => {
    const r = classifyAuxStub(o, MAIN_PATH);
    return `${r.verdict}/${r.reason}`;
  };
  it("이동 코드와 이동 대상이 맞으면 정상, 대표 판정에서 제외", () => {
    expect(v(resp())).toBe("PASS_DATA/null");
    expect(classifyAuxStub(resp(), MAIN_PATH)).toMatchObject({ layer: "AUX_STUB", countsTowardOverall: false });
  });
  it("이동 코드가 사라지면 검증 불가(STUB_CHANGED) — 실패가 아니다", () => {
    expect(v(resp({ body: "<html>정상 화면처럼 보임</html>" }))).toBe("UNVERIFIED/STUB_CHANGED");
    expect(v(resp({ body: "" }))).toBe("UNVERIFIED/STUB_CHANGED");
  });
  it("이동 대상이 다른 경로로 바뀌면 STUB_CHANGED", () => {
    expect(v(resp({ body: 'location.replace("https://www.onbid.co.kr/other.do")' }))).toBe("UNVERIFIED/STUB_CHANGED");
  });
  it("이동 대상이 허용 밖·http면 HOST_NOT_ALLOWED (따라가지 않음)", () => {
    expect(v(resp({ body: 'location.replace("https://evil.com/")' }))).toBe("UNVERIFIED/HOST_NOT_ALLOWED");
    expect(v(resp({ body: `location.replace("http://www.onbid.co.kr${MAIN_PATH}")` }))).toBe("UNVERIFIED/HOST_NOT_ALLOWED");
  });
  it("상대 경로 이동도 허용 (/op/…/main.do)", () => {
    expect(v(resp({ body: `location.replace("${MAIN_PATH}")` }))).toBe("PASS_DATA/null");
  });
  it("서버 이동(302 Location)으로 바뀌어도 대상이 맞으면 정상, 틀리면 STUB_CHANGED", () => {
    expect(v(resp({ status: 302, body: null, location: MAIN }))).toBe("PASS_DATA/null");
    expect(v(resp({ status: 302, body: null, location: "/elsewhere" }))).toBe("UNVERIFIED/STUB_CHANGED");
    expect(v(resp({ status: 302, body: null, location: null }))).toBe("UNVERIFIED/STUB_CHANGED");
  });
  it("상태 코드: 404·410은 검증 불가, 5xx·시간 초과·네트워크는 실패, 401·403·429는 검증 불가", () => {
    expect(v(resp({ status: 404 }))).toBe("UNVERIFIED/HTTP_NOT_FOUND");
    expect(v(resp({ status: 410 }))).toBe("UNVERIFIED/HTTP_NOT_FOUND");
    expect(v(resp({ status: 503 }))).toBe("FAIL/HTTP_5XX");
    expect(v({ kind: "timeout" })).toBe("FAIL/TIMEOUT");
    expect(v({ kind: "network_error" })).toBe("FAIL/TCP_FAILED");
    for (const s of [401, 403, 429]) expect(v(resp({ status: s }))).toBe("UNVERIFIED/HTTP_BLOCKED");
    expect(v(resp({ status: 400 }))).toBe("UNVERIFIED/HTTP_4XX_OTHER");
  });
  it("허용 호스트 밖·예산 소진", () => {
    expect(v({ kind: "host_not_allowed" })).toBe("UNVERIFIED/HOST_NOT_ALLOWED");
    expect(v({ kind: "skipped" })).toBe("NOT_RUN/BUDGET_SKIP");
  });
  it("결과에 본문·질의가 남지 않는다", () => {
    const r = classifyAuxStub(resp({ url: `${STUB_URL}?serviceKey=SECRET`, body: STUB_HTML + "비밀본문" }), MAIN_PATH);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(JSON.stringify(r)).not.toContain("비밀본문");
  });
});

describe("대기열 설정 파일 판정", () => {
  const q = (o: AuxObservation) => {
    const r = classifyAuxQueue(o);
    return `${r.verdict}/${r.reason}`;
  };
  const json = (over: Partial<Extract<AuxObservation, { kind: "response" }>> = {}) => resp({ url: QUEUE_URL, body: '{"statusCode":200,"status":"OK"}', ...over });
  it("200과 JSON 객체면 정상, 대표 판정 제외", () => {
    expect(q(json())).toBe("PASS_DATA/null");
    expect(classifyAuxQueue(json())).toMatchObject({ layer: "AUX_QUEUE", countsTowardOverall: false });
  });
  it("JSON이 아니거나 객체가 아니면 실패(MARKER_MISSING)", () => {
    expect(q(json({ body: "<html>error</html>" }))).toBe("FAIL/MARKER_MISSING");
    expect(q(json({ body: "[1,2]" }))).toBe("FAIL/MARKER_MISSING");
    expect(q(json({ body: "null" }))).toBe("FAIL/MARKER_MISSING");
    expect(q(json({ body: "" }))).toBe("FAIL/MARKER_MISSING");
  });
  it("5xx·시간 초과·404는 실패 (설정 파일이 없으면 대기실이 깨질 수 있음)", () => {
    expect(q(json({ status: 500 }))).toBe("FAIL/HTTP_5XX");
    expect(q({ kind: "timeout" })).toBe("FAIL/TIMEOUT");
    expect(q(json({ status: 404 }))).toBe("FAIL/HTTP_NOT_FOUND");
  });
  it("차단·제한은 검증 불가", () => {
    for (const s of [401, 403, 429]) expect(q(json({ status: s }))).toBe("UNVERIFIED/HTTP_BLOCKED");
  });
  it("200이 아닌 2xx는 기대 밖(검증 불가)", () => {
    expect(q(json({ status: 204, body: "" }))).toBe("UNVERIFIED/INTERNAL_ERROR");
  });
});

// ---- 프로브 동작: 가짜 전송 계층 ----
type Reply = Partial<TransportGetResult> & { throwKind?: ProbeTransportError["kind"] };
function fake(routes: Record<string, Reply>, baseTime = 0) {
  let t = baseTime;
  const calls: { url: string; opts: TransportGetOptions }[] = [];
  const sleeps: number[] = [];
  const transport: WebTransport = {
    async lookup() {},
    async tls() {
      return { notAfterMs: baseTime + 60 * 86_400_000, hostnameMatches: true };
    },
    async get(url, opts) {
      calls.push({ url, opts });
      const r = routes[url];
      if (!r) throw new ProbeTransportError("network_error");
      t += 50;
      if (r.throwKind) throw new ProbeTransportError(r.throwKind);
      return { status: r.status ?? 200, location: r.location ?? null, bytes: r.bytes ?? (r.body ? r.body.length : 0), body: r.body ?? null };
    },
  };
  const clock: ProbeClock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
  return { transport, clock, calls, sleeps };
}
const target = findWebTarget("onbid-home")!;
const GOOD = { [STUB_URL]: { body: STUB_HTML }, [QUEUE_URL]: { body: '{"statusCode":200}' } };

describe("probeAux (프로브 동작)", () => {
  it("등록부의 보조 2개를 순서대로 GET 한 번씩, 간격을 두고 요청", async () => {
    const f = fake(GOOD);
    const r = await probeAux(f.transport, f.clock, target.aux, { timeoutMs: 10_000, requestGapMs: 500, deadlineMs: 60_000 });
    expect(r.results.map((x) => `${x.layer}:${x.verdict}`)).toEqual(["AUX_STUB:PASS_DATA", "AUX_QUEUE:PASS_DATA"]);
    expect(f.calls.map((c) => c.url)).toEqual([STUB_URL, QUEUE_URL]);
    expect(f.sleeps).toEqual([500]); // 첫 요청 전에는 쉬지 않고 요청 사이에만 쉰다
    expect(r.requestCount).toBe(2);
  });
  it("스텁 이동 코드가 사라져도 대기열은 계속 점검된다", async () => {
    const f = fake({ ...GOOD, [STUB_URL]: { body: "<html></html>" } });
    const r = await probeAux(f.transport, f.clock, target.aux, { timeoutMs: 10_000, requestGapMs: 0, deadlineMs: 60_000 });
    expect(r.results.map((x) => x.reason)).toEqual(["STUB_CHANGED", null]);
  });
  it("대기열 5xx·타임아웃, 네트워크 오류가 각각 실패로 남는다", async () => {
    expect((await probeAux(fake({ ...GOOD, [QUEUE_URL]: { status: 503 } }).transport, fake({}).clock, target.aux, { timeoutMs: 1000, requestGapMs: 0, deadlineMs: 1e9 })).results[1].reason).toBe("HTTP_5XX");
    expect((await probeAux(fake({ ...GOOD, [QUEUE_URL]: { throwKind: "timeout" } }).transport, fake({}).clock, target.aux, { timeoutMs: 1000, requestGapMs: 0, deadlineMs: 1e9 })).results[1].reason).toBe("TIMEOUT");
    expect((await probeAux(fake({ [STUB_URL]: GOOD[STUB_URL] }).transport, fake({}).clock, target.aux, { timeoutMs: 1000, requestGapMs: 0, deadlineMs: 1e9 })).results[1].reason).toBe("TCP_FAILED");
  });
  it("요청에는 남은 시간 이하의 타임아웃을 건다", async () => {
    const f = fake(GOOD);
    await probeAux(f.transport, f.clock, target.aux, { timeoutMs: 10_000, requestGapMs: 0, deadlineMs: 3_000 });
    expect(f.calls[0].opts.timeoutMs).toBe(3_000);
    expect(f.calls[1].opts.timeoutMs).toBeLessThan(3_000);
  });
  it("시간 예산이 끝나면 요청 없이 미점검", async () => {
    const f = fake(GOOD, 5_000);
    const r = await probeAux(f.transport, f.clock, target.aux, { timeoutMs: 10_000, requestGapMs: 0, deadlineMs: 5_000 });
    expect(r.results.every((x) => x.verdict === "NOT_RUN" && x.reason === "BUDGET_SKIP")).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect(r.requestCount).toBe(0);
  });
  it("허용 호스트 밖 주소는 요청하지 않는다 (등록부가 바뀌어도 이중 방어)", async () => {
    const f = fake({});
    const bad = [{ ...target.aux[1], url: "https://evil.com/x.json" }];
    const r = await probeAux(f.transport, f.clock, bad, { timeoutMs: 1000, requestGapMs: 0, deadlineMs: 1e9 });
    expect(r.results[0].reason).toBe("HOST_NOT_ALLOWED");
    expect(f.calls).toHaveLength(0);
  });
});

describe("probeTarget (주 대상 + 보조)", () => {
  const BODY = "<title>온비드</title> 조건검색 공고검색 회원가입 로그인 /js/op_main.js <script src=\"/js/op_main.js\"></script>" + "x".repeat(310_000);
  const routes = { [MAIN]: { body: BODY }, "https://www.onbid.co.kr/js/op_main.js": { status: 200, bytes: 5000 }, ...GOOD };
  const deps = (f: ReturnType<typeof fake>) => ({ transport: f.transport, clock: f.clock, cfg: CFG, requestGapMs: 0, deadlineMs: 60_000 });

  it("모두 정상: 대표 PASS_DATA, 보조 2개 정상, 요청 수 합산", async () => {
    const f = fake(routes);
    const r = await probeTarget(target, deps(f));
    expect(r.verdict.overall).toBe("PASS_DATA");
    expect(r.aux.map((a) => a.verdict)).toEqual(["PASS_DATA", "PASS_DATA"]);
    expect(r.requestCount).toBe(1 + 1 + 1 + 2); // L1 + main + 번들 + 보조 2
    expect(r.verdict.probes.some((p) => p.layer.startsWith("AUX"))).toBe(false); // 대표 판정 계산에 보조가 들어가지 않는다
  });
  it("보조가 전부 실패해도 대표 판정은 영향받지 않는다", async () => {
    const f = fake({ ...routes, [STUB_URL]: { status: 503 }, [QUEUE_URL]: { status: 503 } });
    const r = await probeTarget(target, deps(f));
    expect(r.verdict.overall).toBe("PASS_DATA");
    expect(r.aux.map((a) => a.verdict)).toEqual(["FAIL", "FAIL"]);
    expect(r.aux.every((a) => a.countsTowardOverall === false)).toBe(true);
  });
  it("주 대상이 실패해도 보조 확인은 계속한다", async () => {
    const f = fake({ ...routes, [MAIN]: { status: 503 } });
    const r = await probeTarget(target, deps(f));
    expect(r.verdict.overall).toBe("FAIL");
    expect(r.aux.map((a) => a.verdict)).toEqual(["PASS_DATA", "PASS_DATA"]);
  });
});

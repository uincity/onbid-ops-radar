// W03 실제 전송 계층(node-transport): 내 컴퓨터의 임시 서버(127.0.0.1)로 GET·리다이렉트 수동·본문 상한·시간 초과·인증서 결과 변환을 시험
// 외부 네트워크에는 접속하지 않는다. (허용 호스트 검사는 http.ts의 일이라 여기서는 로컬 주소를 그대로 쓴다)
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapTlsResult, nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { PROBE_USER_AGENT, ProbeTransportError } from "@/lib/web-monitor/probes/types";

let server: http.Server;
let base = "";
const seen: { method?: string; ua?: string; url?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, ua: req.headers["user-agent"], url: req.url });
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/target" }).end();
    } else if (req.url === "/slow") {
      setTimeout(() => res.writeHead(200).end("late"), 1500);
    } else if (req.url === "/big") {
      // 15,000바이트를 500바이트씩 30조각으로, 조각마다 잠깐 쉬며 보낸다(한 덩어리로 도착하면 상한 시험이 안 된다)
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      let n = 0;
      const timer = setInterval(() => {
        if (n++ >= 30 || res.destroyed) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write("a".repeat(500));
      }, 5);
    } else if (req.url === "/empty") {
      res.writeHead(200).end();
    } else if (req.url === "/err") {
      res.writeHead(503).end("down");
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("안녕 로그인");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("nodeTransport.get", () => {
  const o = { timeoutMs: 2000, readBody: true, maxBytes: 1_000_000 };
  it("GET만 보내고 고정 User-Agent를 쓴다", async () => {
    seen.length = 0;
    await nodeTransport.get(`${base}/`, o);
    expect(seen[0]).toMatchObject({ method: "GET", ua: PROBE_USER_AGENT });
  });
  it("본문을 읽고 바이트 수를 센다 (한글 UTF-8)", async () => {
    const r = await nodeTransport.get(`${base}/`, o);
    expect(r).toMatchObject({ status: 200, body: "안녕 로그인", bytes: new TextEncoder().encode("안녕 로그인").length });
  });
  it("리다이렉트를 따라가지 않고 상태와 Location을 돌려준다", async () => {
    seen.length = 0;
    const r = await nodeTransport.get(`${base}/redirect`, o);
    expect(r).toMatchObject({ status: 302, location: "/target", body: null });
    expect(seen.map((s) => s.url)).toEqual(["/redirect"]); // 따라가지 않음
  });
  it("2xx가 아니면 본문을 보관하지 않는다 (503)", async () => {
    const r = await nodeTransport.get(`${base}/err`, o);
    expect(r.status).toBe(503);
    expect(r.body).toBeNull();
  });
  it("readBody=false면 본문을 보관하지 않지만 비어 있는지는 알 수 있다", async () => {
    const full = await nodeTransport.get(`${base}/`, { timeoutMs: 2000, readBody: false, maxBytes: 0 });
    expect(full.body).toBeNull();
    expect(full.bytes).toBeGreaterThan(0);
    const empty = await nodeTransport.get(`${base}/empty`, { timeoutMs: 2000, readBody: false, maxBytes: 0 });
    expect(empty.bytes).toBe(0);
  });
  it("본문 상한(maxBytes)에서 읽기를 멈춘다", async () => {
    const r = await nodeTransport.get(`${base}/big`, { timeoutMs: 2000, readBody: true, maxBytes: 4000 });
    expect(r.bytes).toBeGreaterThanOrEqual(4000);
    expect(r.bytes).toBeLessThan(15_000);
  });
  it("시간 초과는 timeout 오류, 접속 불가는 network_error (내부 문구 없음)", async () => {
    await expect(nodeTransport.get(`${base}/slow`, { ...o, timeoutMs: 200 })).rejects.toMatchObject({ kind: "timeout" });
    const e = await nodeTransport.get("http://127.0.0.1:1/", o).catch((x) => x);
    expect(e).toBeInstanceOf(ProbeTransportError);
    expect(e.kind).toBe("network_error");
    expect(e.message).toBe("network_error");
  });
});

describe("mapTlsResult (인증서 검증 결과 변환)", () => {
  const T = 123456;
  it("정상", () => expect(mapTlsResult({ authorized: true, authorizationError: null, notAfterMs: T, identityError: false })).toEqual({ notAfterMs: T, hostnameMatches: true }));
  it("만료는 던지지 않고 판정에 넘긴다", () => expect(mapTlsResult({ authorized: false, authorizationError: "CERT_HAS_EXPIRED", notAfterMs: T, identityError: false }).notAfterMs).toBe(T));
  it("호스트 불일치는 hostnameMatches=false", () => expect(mapTlsResult({ authorized: false, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID", notAfterMs: T, identityError: true }).hostnameMatches).toBe(false));
  it("신뢰할 수 없는 체인(자체 서명 등)은 TLS 실패", () => {
    for (const code of ["DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"]) {
      expect(() => mapTlsResult({ authorized: false, authorizationError: code, notAfterMs: T, identityError: false })).toThrow(ProbeTransportError);
    }
  });
});

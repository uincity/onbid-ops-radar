// Design Ref: docs/design-homepage-monitoring.md §5.1·§11 / Plan W03 — 실제 네트워크를 쓰는 전송 계층 (Node 내장 dns·tls·fetch)
// GET만 보낸다. 리다이렉트는 따라가지 않고(manual) 호출한 쪽이 허용 호스트 검사를 하며 한 단계씩 따라간다.
// 허용 호스트 검사는 http.ts의 책임이다. 이 파일은 받은 주소로 그대로 요청하므로 직접 쓰지 말고 프로브를 거쳐 쓴다.
import dns from "node:dns/promises";
import tls from "node:tls";
import { PROBE_USER_AGENT, ProbeTransportError, type TransportGetOptions, type TransportGetResult, type WebTransport } from "./types";

const TCP_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED"]);

// 인증서 검증 결과를 L1 관측값으로 바꾼다 (순수 함수, 시험 가능). 만료·호스트 불일치는 정보로 넘기고 그 밖의 신뢰 체인 문제는 TLS 실패로 던진다
export function mapTlsResult(input: { authorized: boolean; authorizationError: string | null; notAfterMs: number; identityError: boolean }): { notAfterMs: number; hostnameMatches: boolean } {
  const tolerated = new Set(["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "HOSTNAME_MISMATCH"]);
  if (!input.authorized && input.authorizationError && !tolerated.has(input.authorizationError)) throw new ProbeTransportError("tls_failed");
  return { notAfterMs: input.notAfterMs, hostnameMatches: !input.identityError };
}

export const nodeTransport: WebTransport = {
  async lookup(host, timeoutMs) {
    const timer = AbortSignal.timeout(timeoutMs);
    await Promise.race([
      dns.lookup(host),
      new Promise<never>((_, reject) => timer.addEventListener("abort", () => reject(new ProbeTransportError("timeout")), { once: true })),
    ]).catch(() => {
      throw new ProbeTransportError("dns_failed");
    });
  },

  tls(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
        try {
          const cert = socket.getPeerCertificate();
          const notAfterMs = Date.parse(cert.valid_to);
          if (!cert || Number.isNaN(notAfterMs)) throw new ProbeTransportError("tls_failed");
          const identityError = tls.checkServerIdentity(host, cert) !== undefined;
          const authorizationError = socket.authorizationError ? String(socket.authorizationError) : null;
          // 호스트 불일치는 identityError로 따로 보므로 authorizationError가 호스트 불일치뿐이면 허용 처리
          resolve(mapTlsResult({ authorized: socket.authorized, authorizationError, notAfterMs, identityError }));
        } catch (e) {
          reject(e instanceof ProbeTransportError ? e : new ProbeTransportError("tls_failed"));
        } finally {
          socket.end();
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new ProbeTransportError("tcp_failed"));
      });
      socket.on("error", (err: NodeJS.ErrnoException) => {
        reject(new ProbeTransportError(err.code && TCP_CODES.has(err.code) ? "tcp_failed" : "tls_failed"));
      });
    });
  },

  async get(url: string, opts: TransportGetOptions): Promise<TransportGetResult> {
    try {
      const res = await fetch(url, {
        method: "GET", // 읽기 전용: 다른 메서드는 이 계층에 없다
        redirect: "manual",
        cache: "no-store",
        headers: { "User-Agent": PROBE_USER_AGENT, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      const status = res.status;
      const location = res.headers.get("location");
      const wantBody = opts.readBody && status >= 200 && status <= 299;
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (res.body) {
        const reader = res.body.getReader();
        // 크기를 재려고 본문을 읽는다. 상한(maxBytes)을 넘으면 읽기를 멈춘다. 상한이 0이면 본문을 받지 않고 닫는다
        for (;;) {
          if (opts.maxBytes <= 0 && !wantBody) {
            const first = await reader.read();
            if (!first.done) bytes += first.value.byteLength; // 비어 있지 않은지만 확인
            await reader.cancel();
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (wantBody) chunks.push(value);
          if (bytes >= opts.maxBytes) {
            await reader.cancel();
            break;
          }
        }
      }
      const body = wantBody ? new TextDecoder("utf-8").decode(Buffer.concat(chunks)) : null;
      return { status, location, bytes, body };
    } catch (e) {
      if (e instanceof ProbeTransportError) throw e;
      const name = e instanceof Error ? e.name : "";
      throw new ProbeTransportError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error");
    }
  },
};

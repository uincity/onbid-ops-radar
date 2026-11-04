// Design Ref: docs/design-homepage-monitoring.md §5.1(3단계 L1) / PRD-hp §6.1 / Plan W03 — L1 접속 프로브 (DNS → TCP/TLS → 인증서)
// 관측만 한다(판정은 classify.ts). 오류 원문은 버리고 종류만 남긴다.
import type { L1Observation } from "../classify";
import { ProbeTransportError, type WebTransport } from "./types";

export async function observeL1(transport: WebTransport, host: string, port: number, timeoutMs: number): Promise<L1Observation> {
  try {
    await transport.lookup(host, timeoutMs);
  } catch {
    return { kind: "dns_failed" }; // 이름을 못 찾거나 시간 초과
  }
  try {
    const cert = await transport.tls(host, port, timeoutMs);
    return { kind: "connected", certNotAfterMs: cert.notAfterMs, hostnameMatches: cert.hostnameMatches };
  } catch (e) {
    const kind = e instanceof ProbeTransportError ? e.kind : "tls_failed";
    // 연결 자체가 안 된 것(거부·시간 초과·네트워크)은 TCP 실패, 연결 뒤 협상이 깨진 것은 TLS 실패
    return { kind: kind === "tls_failed" ? "tls_failed" : "tcp_failed" };
  }
}

// Design Ref: docs/design-homepage-monitoring.md §5.1(3단계)·§11 / Plan W03 — 프로브가 쓰는 "밖으로 나가는 문"(전송 계층) 약속
// DNS·TLS·HTTP를 이 약속 뒤에 숨겨 두고 시험에서는 가짜로 바꿔 끼운다. 프로브 로직은 시각·네트워크를 직접 쓰지 않는다.
// 이 약속에는 읽기(GET)와 접속 확인뿐이다 — 쓰기 요청을 보내는 방법이 아예 없다.

export type TransportErrorKind = "dns_failed" | "tcp_failed" | "tls_failed" | "timeout" | "network_error";

// 전송 계층 오류. 원문 메시지는 담지 않는다(내부 정보·주소 노출 방지)
export class ProbeTransportError extends Error {
  constructor(public readonly kind: TransportErrorKind) {
    super(kind);
    this.name = "ProbeTransportError";
  }
}

export type TransportGetOptions = {
  timeoutMs: number; // 이 요청에 남은 시간
  readBody: boolean; // 2xx일 때만 본문을 읽는다
  maxBytes: number; // 읽는 본문 상한(넘으면 여기까지만 세고 멈춤)
};
export type TransportGetResult = { status: number; location: string | null; bytes: number; body: string | null };

export interface WebTransport {
  lookup(host: string, timeoutMs: number): Promise<void>; // DNS 확인 (실패하면 던짐)
  tls(host: string, port: number, timeoutMs: number): Promise<{ notAfterMs: number; hostnameMatches: boolean }>; // 연결 후 인증서 정보
  get(url: string, options: TransportGetOptions): Promise<TransportGetResult>; // 리다이렉트를 따라가지 않는 GET 1번
}

export type ProbeClock = {
  now: () => number; // 밀리초
  sleep: (ms: number) => Promise<void>; // 요청 간격 (시험에서는 즉시 끝나는 가짜)
};

export const PROBE_USER_AGENT = "OnBidOpsRadar-Monitor/1.0"; // 연락처·개인정보 없는 고정 값 (계획서 7장)
export const MAX_BODY_BYTES = 2_000_000; // 홈페이지 본문 읽기 상한 (관측 약 609KB)

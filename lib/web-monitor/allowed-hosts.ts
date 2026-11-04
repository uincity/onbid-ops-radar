// Design Ref: docs/design-homepage-monitoring.md §3(원칙 1)·§8.2 / Plan W01 — 요청마다 https와 허용 호스트만 통과시키는 검사
// 점검기가 리다이렉트·HTML에서 뽑은 주소를 따라 엉뚱한 곳(내부망 포함)에 접속하지 않게 하는 보안 경계다.
// 순수 함수라 네트워크 없이 시험한다. 허용 밖이면 요청하지 않고 호출한 쪽이 "검증 불가"로 남긴다.

// 허용 호스트: 정확히 일치하는 이름만(하위 도메인·접미사 일치는 허용하지 않는다)
export const ALLOWED_HOSTS = ["www.onbid.co.kr", "wait.onbid.co.kr"] as const;

export type HostCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: "INVALID_URL" | "NOT_HTTPS" | "HOST_NOT_ALLOWED" | "PORT_NOT_ALLOWED" | "CREDENTIALS_NOT_ALLOWED" };

// raw가 상대 주소면 base 기준으로 풀어서(리다이렉트 Location, HTML의 상대 주소) 검사한다
export function checkAllowedUrl(raw: string, base?: string | URL): HostCheck {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" };
  // https://www.onbid.co.kr@evil.com 같은 사용자 정보 속임수를 막는다 (실제 호스트는 @ 뒤)
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "CREDENTIALS_NOT_ALLOWED" };
  // URL은 호스트를 소문자로 정규화한다. 끝에 점이 붙은 이름(www.onbid.co.kr.)도 허용 목록과 달라서 거부된다
  if (!(ALLOWED_HOSTS as readonly string[]).includes(url.hostname)) return { ok: false, reason: "HOST_NOT_ALLOWED" };
  // 기본 포트(443)만 허용한다. 빈 값은 기본 포트다
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "PORT_NOT_ALLOWED" };
  return { ok: true, url };
}

export const isAllowedUrl = (raw: string, base?: string | URL): boolean => checkAllowedUrl(raw, base).ok;

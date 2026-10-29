// Design Ref: DESIGN §4.1·§7 — 로그인 후 돌아갈 주소(next)를 안전하게 다듬는다.
// 주소 뒤에 ?next=... 를 붙여 두면 로그인 뒤 원래 보려던 화면으로 돌려보낼 수 있다.
// 하지만 이 값은 누구나 바꿀 수 있으므로, 우리 사이트 안의 주소가 아니면 모두 "/"(첫 화면)로 바꾼다.
// (외부 사이트로 보내는 "열린 리다이렉트" 공격 방지)

const FALLBACK = "/";

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return FALLBACK;

  // 반드시 "/"로 시작하는 우리 사이트 안의 경로여야 한다. "//evil.com"이나 "/\evil.com"은 외부 주소로 해석될 수 있다.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return FALLBACK;
  // 줄바꿈·제어 문자 금지
  if (/[\u0000-\u001f\u007f]/.test(value)) return FALLBACK;

  // 실제로 우리 사이트 주소로 해석되는지 한 번 더 확인한다.
  let parsed: URL;
  try {
    parsed = new URL(value, "http://localhost");
  } catch {
    return FALLBACK;
  }
  if (parsed.origin !== "http://localhost") return FALLBACK;

  // 로그인 화면으로 다시 돌려보내면 의미가 없다.
  if (parsed.pathname === "/login") return FALLBACK;

  return `${parsed.pathname}${parsed.search}`;
}

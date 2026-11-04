// W01 허용 호스트 검사: 허용 한 칸 안·밖 경계와 주소 속임수 시험
import { describe, expect, it } from "vitest";
import { ALLOWED_HOSTS, checkAllowedUrl, isAllowedUrl } from "@/lib/web-monitor/allowed-hosts";

describe("허용 호스트 안", () => {
  it("허용 호스트 2개는 https 기본 포트에서 통과", () => {
    for (const h of ALLOWED_HOSTS) expect(isAllowedUrl(`https://${h}/a/b?x=1`)).toBe(true);
  });
  it("대문자 호스트·명시적 443은 정규화되어 통과", () => {
    expect(isAllowedUrl("https://WWW.OnBid.co.kr/")).toBe(true);
    expect(isAllowedUrl("https://www.onbid.co.kr:443/")).toBe(true);
  });
  it("상대 주소(리다이렉트 Location·HTML 경로)는 base 기준으로 풀어서 검사", () => {
    const r = checkAllowedUrl("/js/op_main.js?version=1", "https://www.onbid.co.kr/main.do");
    expect(r.ok && r.url.href).toBe("https://www.onbid.co.kr/js/op_main.js?version=1");
    expect(isAllowedUrl("//wait.onbid.co.kr/x", "https://www.onbid.co.kr/")).toBe(true);
  });
});

describe("허용 호스트 밖", () => {
  const reason = (u: string, b?: string) => {
    const r = checkAllowedUrl(u, b);
    return r.ok ? "OK" : r.reason;
  };
  it("http는 NOT_HTTPS", () => expect(reason("http://www.onbid.co.kr/")).toBe("NOT_HTTPS"));
  it("다른 프로토콜(ftp·file·javascript)은 거부", () => {
    expect(reason("ftp://www.onbid.co.kr/")).toBe("NOT_HTTPS");
    expect(reason("file:///etc/passwd")).toBe("NOT_HTTPS");
    expect(reason("javascript:alert(1)")).toBe("NOT_HTTPS");
  });
  it("다른 호스트·하위 도메인·접미사 속임수는 HOST_NOT_ALLOWED", () => {
    for (const u of [
      "https://evil.com/",
      "https://sub.www.onbid.co.kr/",
      "https://onbid.co.kr/",
      "https://www.onbid.co.kr.evil.com/",
      "https://evilwww.onbid.co.kr/",
      "https://www.onbid.co.kr./", // 끝에 점
      "https://xn--onbid-9pa.co.kr/", // 비슷한 글자 도메인
    ]) {
      expect(reason(u), u).toBe("HOST_NOT_ALLOWED");
    }
  });
  it("내부망·로컬 주소는 거부", () => {
    for (const u of ["https://127.0.0.1/", "https://localhost/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://10.0.0.1/"]) {
      expect(reason(u), u).toBe("HOST_NOT_ALLOWED");
    }
  });
  it("사용자 정보 속임수(@)는 거부", () => {
    expect(reason("https://www.onbid.co.kr@evil.com/")).toBe("CREDENTIALS_NOT_ALLOWED"); // 실제 호스트는 evil.com, 사용자 정보 검사에서 먼저 거부
    expect(isAllowedUrl("https://www.onbid.co.kr@evil.com/")).toBe(false);
    expect(reason("https://user:pw@www.onbid.co.kr/")).toBe("CREDENTIALS_NOT_ALLOWED");
  });
  it("443이 아닌 포트는 PORT_NOT_ALLOWED", () => {
    expect(reason("https://www.onbid.co.kr:8443/")).toBe("PORT_NOT_ALLOWED");
    expect(reason("https://www.onbid.co.kr:444/")).toBe("PORT_NOT_ALLOWED");
  });
  it("상대 주소가 허용 밖으로 풀리면 거부", () => {
    expect(reason("//evil.com/x", "https://www.onbid.co.kr/")).toBe("HOST_NOT_ALLOWED");
    expect(reason("http://www.onbid.co.kr/x", "https://www.onbid.co.kr/")).toBe("NOT_HTTPS");
  });
  it("깨진 주소·빈 문자열은 INVALID_URL", () => {
    expect(reason("")).toBe("INVALID_URL");
    expect(reason("not a url")).toBe("INVALID_URL");
    expect(reason("https://")).toBe("INVALID_URL");
  });
});

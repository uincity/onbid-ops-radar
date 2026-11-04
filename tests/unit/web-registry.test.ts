// W01 웹 대상 등록부: 실제 파일이 스키마를 통과하는지, 잘못된 값을 거부하는지 시험
import { describe, expect, it } from "vitest";
import webTargetsJson from "@/data/registry/web-targets.json";
import { WEB_TARGETS, allWebTargets, findWebTarget, parseWebTargets } from "@/lib/web-monitor/registry";

const clone = () => structuredClone(webTargetsJson) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rejects = (mutate: (r: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = clone();
  mutate(r);
  expect(() => parseWebTargets(r)).toThrow(/웹 대상 등록부/);
};

describe("실제 등록부 파일", () => {
  it("통과하고 대상 onbid-home 1개와 보조 점검 2개가 있다", () => {
    expect(allWebTargets()).toHaveLength(1);
    const t = findWebTarget("onbid-home");
    expect(t?.primary.url).toContain("/main.do");
    expect(t?.aux.map((a) => a.key)).toEqual(["entry-stub", "queue-config"]);
    expect(WEB_TARGETS.version).toBe(1);
  });
  it("없는 대상 키는 undefined", () => expect(findWebTarget("nope")).toBeUndefined());
  it("주소가 모두 허용 호스트의 https다", () => {
    const t = findWebTarget("onbid-home")!;
    for (const u of [t.primary.url, ...t.aux.map((a) => a.url)]) expect(u.startsWith("https://")).toBe(true);
  });
});

describe("잘못된 등록부는 멈춘다", () => {
  it("http 주소", () => rejects((r) => (r.targets[0].primary.url = "http://www.onbid.co.kr/main.do")));
  it("허용 호스트 밖 주소", () => rejects((r) => (r.targets[0].aux[1].url = "https://evil.com/x.json")));
  it("깨진 주소", () => rejects((r) => (r.targets[0].primary.url = "not a url")));
  it("인증서 호스트가 허용 밖", () => rejects((r) => (r.targets[0].cert.host = "evil.com")));
  it("인증서 포트가 443이 아님", () => rejects((r) => (r.targets[0].cert.port = 8443)));
  it("버전 불일치", () => rejects((r) => (r.version = 2)));
  it("모르는 칸(오타) 거부", () => rejects((r) => (r.targets[0].conent = {})));
  it("대상 키 형식(대문자·공백)", () => {
    rejects((r) => (r.targets[0].key = "OnBid Home"));
    rejects((r) => (r.targets[0].key = "-a"));
  });
  it("대상 없음 / 대상 키 중복", () => {
    rejects((r) => (r.targets = []));
    rejects((r) => r.targets.push(structuredClone(r.targets[0])));
  });
  it("필수 문구·점검 문구·차단 문구가 비어 있음(점검 감지가 꺼지는 것 방지)", () => {
    rejects((r) => (r.targets[0].content.mustContain = []));
    rejects((r) => (r.targets[0].content.mustNotContain = []));
    rejects((r) => (r.targets[0].content.blockedPhrases = []));
  });
  it("빈 문구·앞뒤 공백 문구·중복 문구", () => {
    rejects((r) => (r.targets[0].content.mustContain = [""]));
    rejects((r) => (r.targets[0].content.mustNotContain = [" 점검 중"]));
    rejects((r) => (r.targets[0].content.mustContain = ["로그인", "로그인"]));
  });
  it("필수 문구와 금지 문구가 같음(어떤 응답도 정상이 될 수 없음)", () =>
    rejects((r) => {
      r.targets[0].content.mustNotContain = ["로그인"];
    }));
  it("minBytes 경계: 999 거부, 1000 통과", () => {
    rejects((r) => (r.targets[0].content.minBytes = 999));
    const ok = clone();
    ok.targets[0].content.minBytes = 1000;
    expect(() => parseWebTargets(ok)).not.toThrow();
    rejects((r) => (r.targets[0].content.minBytes = 1.5));
  });
  it("번들 경로가 주소 전체이거나 물음표 포함", () => {
    rejects((r) => (r.targets[0].content.bundlePaths = ["https://www.onbid.co.kr/js/a.js"]));
    rejects((r) => (r.targets[0].content.bundlePaths = ["/js/a.js?version=1"]));
    rejects((r) => (r.targets[0].content.bundlePaths = ["js/a.js"]));
  });
  it("보조 점검: 키 중복, stub에 이동 경로 없음, json에 이동 경로 있음, 모르는 종류", () => {
    rejects((r) => (r.targets[0].aux[1].key = "entry-stub"));
    rejects((r) => delete r.targets[0].aux[0].expectedRedirectPath);
    rejects((r) => (r.targets[0].aux[1].expectedRedirectPath = "/x"));
    rejects((r) => (r.targets[0].aux[0].kind = "html"));
  });
});

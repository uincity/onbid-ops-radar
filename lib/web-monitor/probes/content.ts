// Design Ref: docs/design-homepage-monitoring.md §5.1(3단계 L3) / PRD-hp §6.3 / Plan W03 — L3 JS 번들 확인
// 본문 표식·점검 문구 판단은 classify.ts(순수)가 한다. 여기서는 HTML에서 번들 주소를 뽑아 GET으로 받을 수 있는지만 본다.
// 번들 주소의 ?version= 값은 배포마다 바뀌므로 등록부에는 경로만 두고, 실제 주소는 HTML에서 뽑는다.
import { checkAllowedUrl } from "../allowed-hosts";
import type { ProbeClock, WebTransport } from "./types";

// <script src="..."> 주소 중 등록된 번들 경로와 같은 것을 찾는다 (경로가 같으면 질의는 달라도 됨). 허용 호스트 밖은 버린다
export function extractBundleUrls(html: string, baseUrl: string, bundlePaths: readonly string[]): { found: Map<string, string>; missing: string[] } {
  const found = new Map<string, string>();
  const re = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    const check = checkAllowedUrl(m[1].trim(), baseUrl);
    if (!check.ok) continue;
    if (bundlePaths.includes(check.url.pathname) && !found.has(check.url.pathname)) found.set(check.url.pathname, check.url.href);
  }
  return { found, missing: bundlePaths.filter((p) => !found.has(p)) };
}

// 받지 못한 번들 수를 센다: HTML에 주소가 없음, 200 아님, 빈 응답, 오류·시간 초과
export async function countBundleFailures(transport: WebTransport, clock: ProbeClock, html: string, baseUrl: string, bundlePaths: readonly string[], opts: { timeoutMs: number; requestGapMs: number }): Promise<number> {
  const { found, missing } = extractBundleUrls(html, baseUrl, bundlePaths);
  let failures = missing.length;
  for (const url of found.values()) {
    if (opts.requestGapMs > 0) await clock.sleep(opts.requestGapMs);
    try {
      const res = await transport.get(url, { timeoutMs: opts.timeoutMs, readBody: false, maxBytes: 0 });
      if (res.status !== 200 || res.bytes <= 0) failures++;
    } catch {
      failures++; // 오류 종류는 판정에 필요 없다(실패 1건으로만 센다)
    }
  }
  return failures;
}

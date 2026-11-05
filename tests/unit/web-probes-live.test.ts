// W03 실제 온비드 홈페이지에 붙여 보는 시험 (읽기 전용 GET 약 3번, DB에는 쓰지 않음)
// 기본으로는 건너뛴다. 실행: WEB_LIVE=1 npx vitest run tests/unit/web-probes-live.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFY_CONFIG } from "@/lib/web-monitor/classify";
import { nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { probeTarget } from "@/lib/web-monitor/probes/target";
import { findWebTarget } from "@/lib/web-monitor/registry";

const live = process.env.WEB_LIVE === "1";

describe.skipIf(!live)("실제 온비드 홈페이지 (라이브)", () => {
  it("주 대상 점검이 끝까지 돌고, 정상 계열 또는 사유가 있는 판정이 나온다", async () => {
    const target = findWebTarget("onbid-home")!;
    const t0 = Date.now();
    const out = await probeTarget(target, {
      transport: nodeTransport,
      clock: { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
      cfg: DEFAULT_CLASSIFY_CONFIG,
      requestGapMs: 500,
      deadlineMs: t0 + 60_000,
    });
    // 내용(본문)은 출력하지 않고 판정·사유만 확인한다
    const summary = out.verdict.probes.map((p) => `${p.layer}:${p.verdict}/${p.reason}/${p.httpStatus}/${p.durationMs}ms/cert${p.certDaysLeft}`);
    console.log("WEB LIVE:", out.verdict.overall, summary.join(" | "), `요청 ${out.requestCount}번`);
    console.log("WEB LIVE AUX:", out.aux.map((a) => `${a.layer}:${a.verdict}/${a.reason}/${a.httpStatus}`).join(" | "));
    expect(["PASS_DATA", "DEGRADED"]).toContain(out.verdict.overall);
    expect(out.aux.map((a) => a.verdict)).toEqual(["PASS_DATA", "PASS_DATA"]);
    expect(out.verdict.probes[0].certDaysLeft).toBeGreaterThan(0);
  }, 70_000);
});

// W00-1 서울 리전 진단 경로: 인증 경계와 결과 형식 시험 (네트워크 없이 가짜 fetch 사용)
import { describe, expect, it } from "vitest";
import { REGION_PROBE_TARGETS, runRegionProbe, type RegionProbeDeps } from "@/lib/web/region-probe";

const respond = (status: number, body = "") => (async () => new Response(body, { status })) as typeof fetch;
const deps = (over: Partial<RegionProbeDeps> = {}): RegionProbeDeps => {
  let t = 0;
  return { secret: () => "s3cret", region: () => "icn1", fetchImpl: respond(200, "x".repeat(10)), now: () => (t += 5), timeoutMs: 1000, ...over };
};

describe("runRegionProbe 인증", () => {
  it("서버에 비밀값이 없으면 503", async () => {
    expect((await runRegionProbe("Bearer s3cret", deps({ secret: () => undefined }))).httpStatus).toBe(503);
  });
  it("헤더 없음·틀린 값·한 글자 짧은/긴 값·Bearer 아님은 401, 정확한 값만 200", async () => {
    for (const h of [null, "Bearer wrong", "Bearer s3cre", "Bearer s3cret1", "Basic s3cret"]) {
      expect((await runRegionProbe(h, deps())).httpStatus).toBe(401);
    }
    expect((await runRegionProbe("Bearer s3cret", deps())).httpStatus).toBe(200);
  });
  it("인증 실패 때는 점검 요청을 보내지 않는다", async () => {
    let calls = 0;
    const spy = (async () => {
      calls++;
      return new Response("");
    }) as typeof fetch;
    await runRegionProbe("Bearer wrong", deps({ fetchImpl: spy }));
    expect(calls).toBe(0);
  });
});

describe("runRegionProbe 결과", () => {
  it("대상마다 GET 1번, 지역과 상태·크기를 돌려준다", async () => {
    const methods: string[] = [];
    const spy = (async (_u: unknown, init?: RequestInit) => {
      methods.push(init?.method ?? "");
      return new Response("abc", { status: 200 });
    }) as typeof fetch;
    const r = await runRegionProbe("Bearer s3cret", deps({ fetchImpl: spy }));
    expect(methods).toEqual(REGION_PROBE_TARGETS.map(() => "GET"));
    expect(r.body.region).toBe("icn1");
    expect(r.body.items?.[0]).toMatchObject({ key: "main", ok: true, status: 200, bytes: 3, error: null });
  });
  it("경계: 302(이동)는 성공, 400·403(차단)·500은 실패이고 상태 코드는 남는다", async () => {
    for (const [status, ok] of [[302, true], [400, false], [403, false], [500, false]] as const) {
      const r = await runRegionProbe("Bearer s3cret", deps({ fetchImpl: respond(status) }));
      expect(r.body.items?.[0]).toMatchObject({ ok, status });
    }
  });
  it("네트워크 오류·시간 초과는 내부 문구 없이 분류만 남긴다", async () => {
    const boom = (async () => {
      throw new Error("secret internal detail");
    }) as typeof fetch;
    const net = await runRegionProbe("Bearer s3cret", deps({ fetchImpl: boom }));
    expect(net.body.items?.[0]).toMatchObject({ ok: false, status: null, error: "network" });
    expect(JSON.stringify(net.body)).not.toContain("secret internal detail");
    const slow = (async () => {
      throw new DOMException("t", "TimeoutError");
    }) as typeof fetch;
    const to = await runRegionProbe("Bearer s3cret", deps({ fetchImpl: slow }));
    expect(to.body.items?.[0].error).toBe("timeout");
  });
  it("지역 값이 없으면 unknown", async () => {
    expect((await runRegionProbe("Bearer s3cret", deps({ region: () => undefined }))).body.region).toBe("unknown");
  });
});

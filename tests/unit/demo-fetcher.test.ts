// DEMO 조회기 시험 (PLAN 작업 21): 정상 · 오류 · 타임아웃 · 0건, 그리고 타임아웃 경계(10초 안/밖)
import { describe, expect, it } from "vitest";
import { DEMO_ENDPOINTS, DEMO_MODES, fetchDemo } from "@/lib/checks/demo-fetcher";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { DEFAULT_SETTING_VALUES } from "@/lib/settings/schema";

const TIMEOUT = DEFAULT_SETTING_VALUES.api_timeout_seconds; // 10초
const BASE = Date.parse("2026-03-01T00:00:00Z");
const run = (over: Partial<Parameters<typeof fetchDemo>[0]> = {}) => fetchDemo({ endpoint: "demo-list", timeoutSeconds: TIMEOUT, baseMs: BASE, ...over });

describe("정상 응답", () => {
  it("목록은 목록이 있는 물건 159건을 돌려준다 (DEMO-0159는 목록이 없다)", () => {
    const r = run();
    expect(r).toMatchObject({ endpointName: "demo-list", httpStatus: 200, outcome: "success", dataValid: true });
    expect(r.recordCount).toBe(159);
    expect(r.records.map((x) => x.itemKey)).not.toContain("DEMO-0159");
  });

  it("상세는 상세가 있는 물건 159건을 돌려준다 (DEMO-0158은 상세가 없다)", () => {
    const r = run({ endpoint: "demo-detail" });
    expect(r.recordCount).toBe(159);
    expect(r.records.map((x) => x.itemKey)).not.toContain("DEMO-0158");
  });

  it("상세의 수집 시각은 목록 기준 detailOffsetSeconds만큼 떨어져 있다 (599·600·601초 경계 포함)", () => {
    const detail = run({ endpoint: "demo-detail" }).records;
    for (const s of DEMO_SCENARIOS.filter((x) => x.detail)) {
      expect(detail.find((x) => x.itemKey === s.id)?.collectedAtMs, s.id).toBe(BASE + s.detailOffsetSeconds * 1000);
    }
    expect(run().records.every((x) => x.collectedAtMs === BASE)).toBe(true);
  });

  it("itemIds를 주면 그 물건만 돌려준다", () => {
    expect(run({ itemIds: ["DEMO-0001", "DEMO-0002"] }).records.map((x) => x.itemKey)).toEqual(["DEMO-0001", "DEMO-0002"]);
  });

  it("같은 입력이면 항상 같은 결과다", () => {
    expect(run()).toEqual(run());
  });
});

describe("오류 · 타임아웃 · 0건", () => {
  it("HTTP 오류: 500, 줄 없음, 결과는 http_error", () => {
    expect(run({ mode: "http_error" })).toMatchObject({ httpStatus: 500, outcome: "http_error", recordCount: null, dataValid: null, records: [] });
  });

  it("타임아웃: 응답 코드 없음, 응답시간은 제한 시간(10000ms)", () => {
    expect(run({ mode: "timeout" })).toMatchObject({ httpStatus: null, outcome: "timeout", durationMs: 10_000, recordCount: null, records: [] });
  });

  it("0건: HTTP 200이지만 데이터는 비어 있다 (응답 성공과 데이터 유효성은 따로 기록)", () => {
    expect(run({ mode: "empty" })).toMatchObject({ httpStatus: 200, outcome: "empty_result", recordCount: 0, dataValid: null, records: [] });
  });

  it("조회 대상이 없어 정상 응답이 0건이면 빈 결과로 구분한다", () => {
    expect(run({ itemIds: ["DEMO-9999"] })).toMatchObject({ httpStatus: 200, outcome: "empty_result", recordCount: 0 });
  });
});

describe("타임아웃 경계 (제한 10초)", () => {
  it("9999ms · 10000ms는 성공, 10001ms는 타임아웃", () => {
    expect(run({ latencyMs: 9_999 }).outcome).toBe("success");
    expect(run({ latencyMs: 10_000 }).outcome).toBe("success");
    expect(run({ latencyMs: 10_001 }).outcome).toBe("timeout");
  });

  it("제한 시간은 설정값을 따른다 (5초로 줄이면 6초 응답은 타임아웃)", () => {
    const r = run({ timeoutSeconds: 5, latencyMs: 6_000 });
    expect(r.outcome).toBe("timeout");
    expect(r.durationMs).toBe(5_000);
  });
});

describe("잘못된 입력은 조용히 넘기지 않고 멈춘다", () => {
  it("모르는 조회 이름 · 응답 종류 · 0 이하 타임아웃", () => {
    expect(() => run({ endpoint: "x" as never })).toThrow();
    expect(() => run({ mode: "x" as never })).toThrow();
    expect(() => run({ timeoutSeconds: 0 })).toThrow();
  });

  it("조회 이름은 api_checks 형식(영문·숫자·_.-)을 지키고 설정값의 빈 결과 허용표에도 있다", () => {
    for (const name of DEMO_ENDPOINTS) {
      expect(name).toMatch(/^[A-Za-z0-9_.-]{1,60}$/);
      expect(Object.keys(DEFAULT_SETTING_VALUES.empty_allowed_by_endpoint)).toContain(name);
    }
    expect(DEMO_MODES).toHaveLength(4);
  });
});

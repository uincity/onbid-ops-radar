// W05 웹 설정: 범위 경계(한 칸 안·밖), 항목 사이 관계, 누락·모르는 항목, 기존 설정과의 분리, 읽기 함수
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSettings, SettingsError, DEFAULT_SETTING_VALUES, SETTING_KEYS } from "@/lib/settings/schema";
import {
  DEFAULT_WEB_SETTING_VALUES,
  DEFAULT_WEB_SETTINGS,
  WEB_INT_RANGES,
  WEB_SETTING_KEYS,
  WebSettingsError,
  findWebRelationProblems,
  parseWebSettings,
  type WebSettingKey,
} from "@/lib/web-monitor/settings";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

const rows = (over: Partial<Record<WebSettingKey, unknown>> = {}) =>
  WEB_SETTING_KEYS.map((key) => ({ key, value: key in over ? over[key] : DEFAULT_WEB_SETTING_VALUES[key] }));
const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof WebSettingsError) return [...e.problems];
    throw e;
  }
  return [];
};

describe("기본값", () => {
  it("20개 항목이 모두 있고 규칙에 맞다 (불러오는 순간 검증됨)", () => {
    expect(WEB_SETTING_KEYS).toHaveLength(20);
    expect(DEFAULT_WEB_SETTINGS).toMatchObject({ httpTimeoutMs: 10000, httpSlowMs: 3000, certWarnDays: 14, runTimeLimitSeconds: 60, staleRunningSeconds: 180, monitorEnabled: true });
  });
});

describe("정수 범위 경계 (모든 항목: 최소·최대는 통과, 한 칸 밖은 거부)", () => {
  for (const [key, range] of Object.entries(WEB_INT_RANGES) as [WebSettingKey & keyof typeof WEB_INT_RANGES, { min: number; max: number }][]) {
    it(`${key} ${range.min}~${range.max}`, () => {
      // 관계 검사에 걸리지 않게 관련 항목을 안전한 값으로 맞춘 뒤 이 항목만 바꾼다
      const base = { web_http_timeout_ms: 20000, web_http_slow_ms: 500, web_run_time_limit_seconds: 30, web_stale_running_seconds: 200 } as Partial<Record<WebSettingKey, unknown>>;
      const ok = (v: unknown) => problemsOf(() => parseWebSettings(rows({ ...base, [key]: v })));
      const rule = problemsOf(() => parseWebSettings(rows({ ...base, [key]: range.min - 1 }))).find((p) => p.startsWith(key));
      if (key !== "web_http_slow_ms") expect(ok(range.min)).toEqual([]);
      if (key !== "web_http_slow_ms") expect(ok(range.max).filter((p) => p.startsWith(key))).toEqual([]);
      expect(rule).toBeDefined(); // 한 칸 아래는 거부
      expect(ok(range.max + 1).some((p) => p.startsWith(key))).toBe(true); // 한 칸 위는 거부
      expect(ok(range.min + 0.5).some((p) => p.startsWith(key))).toBe(true); // 소수 거부
      expect(ok("10").some((p) => p.startsWith(key))).toBe(true); // 문자 거부
      expect(ok(null).some((p) => p.startsWith(key))).toBe(true); // null 거부
    });
  }
  it("web_monitor_enabled는 true/false만", () => {
    expect(problemsOf(() => parseWebSettings(rows({ web_monitor_enabled: false })))).toEqual([]);
    for (const bad of [1, 0, "true", null]) expect(problemsOf(() => parseWebSettings(rows({ web_monitor_enabled: bad }))).some((p) => p.startsWith("web_monitor_enabled"))).toBe(true);
  });
});

describe("항목 사이의 관계", () => {
  it("느림 기준은 타임아웃보다 작아야 한다 (한 칸 안·밖)", () => {
    expect(problemsOf(() => parseWebSettings(rows({ web_http_timeout_ms: 5000, web_http_slow_ms: 4999 })))).toEqual([]);
    expect(problemsOf(() => parseWebSettings(rows({ web_http_timeout_ms: 5000, web_http_slow_ms: 5000 }))).join()).toContain("web_http_slow_ms");
    expect(problemsOf(() => parseWebSettings(rows({ web_http_timeout_ms: 1000, web_http_slow_ms: 3000 }))).join()).toContain("web_http_slow_ms");
  });
  it("멈춘 실행 기준은 실행 시간 제한보다 커야 한다 (한 칸 안·밖)", () => {
    expect(problemsOf(() => parseWebSettings(rows({ web_run_time_limit_seconds: 60, web_stale_running_seconds: 61 })))).toEqual([]);
    expect(problemsOf(() => parseWebSettings(rows({ web_run_time_limit_seconds: 60, web_stale_running_seconds: 60 }))).join()).toContain("web_stale_running_seconds");
    expect(problemsOf(() => parseWebSettings(rows({ web_run_time_limit_seconds: 85, web_stale_running_seconds: 84 }))).join()).toContain("web_stale_running_seconds");
  });
  it("실행 시간 제한은 점검 경로 최대 실행 시간(90초) 미만 (85는 통과, 90은 범위 밖)", () => {
    expect(problemsOf(() => parseWebSettings(rows({ web_run_time_limit_seconds: 85 })))).toEqual([]);
    expect(findWebRelationProblems({ ...DEFAULT_WEB_SETTINGS, runTimeLimitSeconds: 90, staleRunningSeconds: 200 }).join()).toContain("최대 실행 시간");
    expect(findWebRelationProblems({ ...DEFAULT_WEB_SETTINGS, runTimeLimitSeconds: 89, staleRunningSeconds: 200 })).toEqual([]);
  });
  it("문제가 여럿이면 모아서 한 번에 알린다", () => {
    const p = problemsOf(() => parseWebSettings(rows({ web_http_timeout_ms: 0, web_cert_warn_days: 99 })));
    expect(p.length).toBeGreaterThanOrEqual(2);
  });
});

describe("누락·모르는 항목·중복", () => {
  it("항목이 하나라도 없으면 기본값으로 대신하지 않고 멈춘다", () => {
    const p = problemsOf(() => parseWebSettings(rows().filter((r) => r.key !== "web_cert_warn_days")));
    expect(p).toEqual(["항목이 없음: web_cert_warn_days"]);
    expect(problemsOf(() => parseWebSettings([]))).toHaveLength(20);
  });
  it("모르는 항목·중복 항목은 거부", () => {
    expect(problemsOf(() => parseWebSettings([...rows(), { key: "web_unknown", value: 1 }]))).toContain("알 수 없는 항목: web_unknown");
    expect(problemsOf(() => parseWebSettings([...rows(), { key: "web_cert_warn_days", value: 14 }]))).toContain("항목이 중복됨: web_cert_warn_days");
  });
  it("삭제된 알림 설정(web_notify_on_manual_check)은 알 수 없는 항목", () => {
    expect(problemsOf(() => parseWebSettings([...rows(), { key: "web_notify_on_manual_check", value: false }]))).toContain("알 수 없는 항목: web_notify_on_manual_check");
  });
});

describe("기존 설정과의 분리 (웹 설정이 틀려도 기존 설정 읽기는 영향 없음)", () => {
  const existingRows = () => SETTING_KEYS.map((key) => ({ key, value: DEFAULT_SETTING_VALUES[key] }));
  it("기존 settings 줄만으로 기존 읽기가 성공한다", () => {
    expect(() => parseSettings(existingRows())).not.toThrow();
  });
  it("웹 항목이 기존 settings 쪽에 섞여 들어오면 기존 읽기는 거부한다 → 그래서 테이블을 분리했다", () => {
    expect(() => parseSettings([...existingRows(), { key: "web_http_timeout_ms", value: 10000 }])).toThrow(SettingsError);
  });
  it("웹 설정이 틀려도 기존 읽기와 서로 독립이다", () => {
    expect(() => parseWebSettings(rows({ web_http_timeout_ms: -1 }))).toThrow(WebSettingsError);
    expect(() => parseSettings(existingRows())).not.toThrow();
  });
});

describe("loadWebSettings (DB 읽기 함수)", () => {
  type Result = { data: { key: string; value: unknown }[] | null; error: { message: string } | null };
  const clientWith = (res: Result, spy?: (table: string) => void) =>
    ({ from: (table: string) => { spy?.(table); return { select: async () => res }; } }) as never;
  let load: typeof import("@/lib/web-monitor/settings-load").loadWebSettings;
  beforeEach(async () => {
    load = (await import("@/lib/web-monitor/settings-load")).loadWebSettings;
  });

  it("web_settings 테이블(기존 settings가 아님)을 읽고 검증된 설정을 돌려준다", async () => {
    const tables: string[] = [];
    const s = await load(clientWith({ data: rows(), error: null }, (t) => tables.push(t)));
    expect(tables).toEqual(["web_settings"]);
    expect(s.httpTimeoutMs).toBe(10000);
  });
  it("DB 오류는 내부 문구 없이 WebSettingsError", async () => {
    const e = await load(clientWith({ data: null, error: { message: "secret db detail host=10.0.0.1" } })).catch((x) => x);
    expect(e).toBeInstanceOf(WebSettingsError);
    expect(String(e.message)).not.toContain("secret");
    expect(String(e.message)).not.toContain("10.0.0.1");
  });
  it("값이 틀리면 기본값으로 대신하지 않고 멈춘다", async () => {
    await expect(load(clientWith({ data: rows({ web_cert_warn_days: 0 }), error: null }))).rejects.toBeInstanceOf(WebSettingsError);
    await expect(load(clientWith({ data: [], error: null }))).rejects.toBeInstanceOf(WebSettingsError);
    await expect(load(clientWith({ data: null, error: null }))).rejects.toBeInstanceOf(WebSettingsError);
  });
});

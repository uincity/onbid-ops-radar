// 수동 점검 실행 로직 시험 (PLAN 작업 24) — 권한·입력 검사·결과 문구. DB 없이 가짜 엔진으로 돌린다.
import { describe, expect, it, vi } from "vitest";
import { runManualCheck, type ManualCheckDeps, type ManualCheckUser } from "@/lib/checks/manual-check";
import type { RunCheckInput, RunCheckResult } from "@/lib/checks/run-check";
import { DEFAULT_SETTING_VALUES, parseSettings } from "@/lib/settings/schema";
import type { CheckStore } from "@/lib/checks/types";

const settings = parseSettings(Object.entries(DEFAULT_SETTING_VALUES).map(([key, value]) => ({ key, value })));
const ADMIN: ManualCheckUser = { id: "admin-1", role: "admin" };
const OPERATOR: ManualCheckUser = { id: "op-1", role: "operator" };
const store = {} as CheckStore;

const result = (over: Partial<RunCheckResult> = {}): RunCheckResult => ({
  runId: 5,
  status: "succeeded",
  apiCallCount: 2,
  detections: [],
  registered: { created: 3, recurred: 1, detected_again: 2, suppressed: 4 },
  ...over,
});

function setup(user: ManualCheckUser | null, engine: Partial<RunCheckResult> | Error = {}) {
  const runCheck = vi.fn(async (input: RunCheckInput) => {
    void input;
    if (engine instanceof Error) throw engine;
    return result(engine);
  });
  const prepare = vi.fn(async () => ({ settings, store }));
  const deps: ManualCheckDeps = { getUser: async () => user, prepare, runCheck, now: () => 1_000_000 };
  return { deps, runCheck, prepare };
}

const good = { source: "DEMO", mode: "normal" };

describe("수동 점검 권한", () => {
  it("로그인하지 않았으면 거부하고 엔진을 부르지 않는다", async () => {
    const { deps, runCheck, prepare } = setup(null);
    const r = await runManualCheck(good, deps);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("로그인");
    expect(runCheck).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("운영 담당자는 거부하고 서버 관리용 연결도 만들지 않는다", async () => {
    const { deps, runCheck, prepare } = setup(OPERATOR);
    const r = await runManualCheck(good, deps);
    expect(r).toMatchObject({ ok: false, message: "수동 점검은 팀장만 실행할 수 있습니다." });
    expect(runCheck).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("팀장은 통과하고 수동·DEMO·실행한 사람 정보로 엔진을 부른다", async () => {
    const { deps, runCheck } = setup(ADMIN);
    const r = await runManualCheck(good, deps);
    expect(r.ok).toBe(true);
    expect(r.runId).toBe(5);
    expect(runCheck).toHaveBeenCalledTimes(1);
    expect(runCheck.mock.calls[0][0]).toMatchObject({ trigger: "manual", source: "DEMO", triggeredBy: "admin-1" });
  });
});

describe("입력 검사", () => {
  it.each([
    [{ source: "OTHER", mode: "normal" }],
    [{ source: "DEMO", mode: "weird" }],
    [{ source: "DEMO" }],
    [{ source: null, mode: null }],
    [null],
    ["DEMO"],
  ])("잘못된 입력 %j 는 거부하고 엔진을 부르지 않는다", async (input) => {
    const { deps, runCheck } = setup(ADMIN);
    const r = await runManualCheck(input, deps);
    expect(r.ok).toBe(false);
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("PUBLIC은 아직 조회기가 없어 거부한다", async () => {
    const { deps, runCheck } = setup(ADMIN);
    const r = await runManualCheck({ source: "PUBLIC", mode: "normal" }, deps);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("PLAN 33번");
    expect(runCheck).not.toHaveBeenCalled();
  });

  it.each(["normal", "http_error", "timeout", "empty"])("응답 종류 %s 를 받아들인다", async (mode) => {
    const { deps, runCheck } = setup(ADMIN);
    const r = await runManualCheck({ source: "DEMO", mode }, deps);
    expect(r.ok).toBe(true);
    expect(runCheck).toHaveBeenCalledTimes(1);
  });
});

describe("결과 문구", () => {
  it("완료: 호출 수와 등록 집계를 알려 준다", async () => {
    const { deps } = setup(ADMIN);
    const r = await runManualCheck(good, deps);
    expect(r.tone).toBe("success");
    expect(r.message).toContain("API 호출 2회");
    expect(r.message).toContain("새 건 3");
    expect(r.message).toContain("재발 1");
    expect(r.message).toContain("다시 탐지 2");
    expect(r.message).toContain("정상 판정 건과 같은 값 4");
  });

  it("일부 완료는 주의, 실패는 오류로 표시한다", async () => {
    const partial = await runManualCheck(good, setup(ADMIN, { status: "partial" }).deps);
    expect(partial).toMatchObject({ ok: true, tone: "warning" });
    const failed = await runManualCheck(good, setup(ADMIN, { status: "failed" }).deps);
    expect(failed).toMatchObject({ ok: false, tone: "error" });
  });

  it("이미 실행 중이면 차단 안내 문구를 준다", async () => {
    const { deps } = setup(ADMIN, { status: "blocked", apiCallCount: 0 });
    const r = await runManualCheck(good, deps);
    expect(r).toMatchObject({ ok: false, tone: "warning", message: "이미 점검이 실행 중입니다. 끝난 뒤 다시 실행해 주세요." });
  });

  it("엔진이 예외를 던져도 내부 오류 문구를 내지 않는다", async () => {
    const { deps } = setup(ADMIN, new Error("secret internal detail"));
    const r = await runManualCheck(good, deps);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain("secret");
    expect(r.runId).toBeUndefined();
  });

  it("설정을 읽지 못해도 내부 오류 문구를 내지 않는다", async () => {
    const { deps } = setup(ADMIN);
    deps.prepare = async () => {
      throw new Error("SUPABASE_SECRET_KEY missing");
    };
    const r = await runManualCheck(good, deps);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain("SUPABASE");
  });
});

// 예약 점검 입구와 오늘 예약 상태 판단 시험 (R07) — DB 없이 의존 주입으로 돌린다
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bearerToken, runScheduledCheck, type CronCheckDeps } from "@/lib/schedule/cron-check";
import { evaluateSchedule, type ScheduleRun } from "@/lib/schedule/status";
import type { RunCheckInput, RunCheckResult } from "@/lib/checks/run-check";
import { DEFAULT_SETTING_VALUES, parseSettings, type Settings } from "@/lib/settings/schema";
import { SCHEDULED_RUN_UTC } from "@/lib/time";
import type { CheckStore } from "@/lib/checks/types";

const settings = (over: Record<string, unknown> = {}): Settings => parseSettings(Object.entries({ ...DEFAULT_SETTING_VALUES, ...over }).map(([key, value]) => ({ key, value })));
const result = (over: Partial<RunCheckResult> = {}): RunCheckResult => ({ runId: 9, status: "succeeded", apiCallCount: 2, detections: [], registered: { created: 0, recurred: 0, detected_again: 0, suppressed: 0 }, probes: [], unprobeable: [], ...over });

function setup(over: Partial<CronCheckDeps> & { cfg?: Settings; engine?: RunCheckResult | Error } = {}) {
  const calls: RunCheckInput[] = [];
  const deps: CronCheckDeps = {
    secret: () => "s3cret-value",
    prepare: async () => ({ settings: over.cfg ?? settings(), store: {} as CheckStore }),
    runCheck: vi.fn(async (input: RunCheckInput) => {
      calls.push(input);
      if (over.engine instanceof Error) throw over.engine;
      return over.engine ?? result();
    }),
    now: () => 0,
    serviceKey: () => "key",
    ...over,
  };
  return { deps, calls };
}
const AUTH = "Bearer s3cret-value";

describe("bearerToken", () => {
  it("Bearer 형식만 받는다", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBeNull();
    expect(bearerToken("abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("예약 점검 입구 (SEC-09)", () => {
  it("헤더가 없거나 값이 틀리거나 길이가 달라도 401이고 점검은 실행되지 않는다", async () => {
    for (const header of [null, "Bearer wrong-value", "Bearer s3cret-valu", "Bearer s3cret-value-extra", "s3cret-value"]) {
      const { deps, calls } = setup();
      const res = await runScheduledCheck(header, deps);
      expect(res.httpStatus, String(header)).toBe(401);
      expect(calls).toHaveLength(0);
    }
  });

  it("서버에 CRON_SECRET이 없으면 어떤 헤더도 통과시키지 않고 503", async () => {
    const { deps, calls } = setup({ secret: () => undefined });
    expect((await runScheduledCheck("Bearer ", deps)).httpStatus).toBe(503);
    expect((await runScheduledCheck("Bearer anything", deps)).httpStatus).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("올바른 비밀값이면 예약(scheduled) 점검을 설정한 출처(기본 DEMO)로 실행하고 사람 없이 시작한다", async () => {
    const { deps, calls } = setup();
    const res = await runScheduledCheck(AUTH, deps);
    expect(res).toEqual({ httpStatus: 200, body: { ok: true, message: "예약 점검 요청을 처리했습니다.", runId: 9, status: "succeeded" } });
    expect(calls[0]).toMatchObject({ trigger: "scheduled", source: "DEMO", triggeredBy: null });
  });

  it("점검이 차단·실패로 끝나도 요청은 처리된 것이라 200이고 상태를 돌려준다", async () => {
    const { deps } = setup({ engine: result({ status: "blocked" }) });
    expect((await runScheduledCheck(AUTH, deps)).body).toMatchObject({ ok: true, status: "blocked" });
  });

  it("출처가 PUBLIC이면 서비스키가 있을 때만 실행하고, 없으면 요청 없이 503 (누락 감지가 알린다)", async () => {
    const pub = settings({ scheduled_source: "PUBLIC" });
    const withKey = setup({ cfg: pub });
    expect((await runScheduledCheck(AUTH, withKey.deps)).httpStatus).toBe(200);
    expect(withKey.calls[0].source).toBe("PUBLIC");
    const noKey = setup({ cfg: pub, serviceKey: () => undefined });
    expect((await runScheduledCheck(AUTH, noKey.deps)).httpStatus).toBe(503);
    expect(noKey.calls).toHaveLength(0);
  });

  it("예상 못 한 오류가 나도 내부 문구는 응답에 없다", async () => {
    const { deps } = setup({ engine: new Error("password=secret db detail") });
    const res = await runScheduledCheck(AUTH, deps);
    expect(res.httpStatus).toBe(500);
    expect(JSON.stringify(res)).not.toContain("secret");
    const failedPrepare = setup({ prepare: async () => { throw new Error("internal host"); } });
    expect(JSON.stringify(await runScheduledCheck(AUTH, failedPrepare.deps))).not.toContain("internal");
  });
});

describe("evaluateSchedule (오늘의 예약 점검 상태)", () => {
  // KST 2026-10-29: 09:00 = 2026-10-29T00:00Z, 확인 기한 09:30 = 00:30Z
  const at = (utc: string) => new Date(`2026-10-29T${utc}Z`);
  const run = (status: string, over: Partial<ScheduleRun> = {}): ScheduleRun => ({ id: 5, trigger: "scheduled", status, started_at: "2026-10-29T00:00:05Z", ...over });
  const ev = (now: Date, runs: ScheduleRun[] = [], missedRecorded = false) => evaluateSchedule({ now, runs, missedRecorded, graceMinutes: 30 });

  it("경계 시각: 08:59:59 KST는 예정, 정확히 09:00은 시작 대기, 09:29:59는 아직 대기, 09:30:00부터 누락", () => {
    expect(ev(new Date("2026-10-28T23:59:59Z")).state).toBe("NOT_DUE");
    expect(ev(at("00:00:00")).state).toBe("WAITING");
    expect(ev(at("00:29:59")).state).toBe("WAITING");
    expect(ev(at("00:30:00")).state).toBe("MISSED");
    expect(ev(at("00:30:00")).level).toBe("warning");
  });
  it("누락 문구는 DB에 기록되었는지에 따라 다르다", () => {
    expect(ev(at("01:00:00"), [], true).detail).toContain("누락이 기록되었습니다");
    expect(ev(at("01:00:00"), [], false).detail).toContain("아직 남지 않았습니다");
  });
  it("정상 완료·진행 중·일부 완료·차단·실패를 구분하고, 정상 완료만 ok다", () => {
    const now = at("02:00:00");
    expect(ev(now, [run("succeeded")])).toMatchObject({ state: "COMPLETED", level: "ok", runId: 5 });
    expect(ev(now, [run("running")])).toMatchObject({ state: "RUNNING", level: "info" });
    expect(ev(now, [run("partial")])).toMatchObject({ state: "PARTIAL", level: "warning" });
    expect(ev(now, [run("blocked")])).toMatchObject({ state: "BLOCKED", level: "warning" });
    expect(ev(now, [run("failed")])).toMatchObject({ state: "FAILED", level: "warning" });
  });
  it("차단 뒤 재시도로 정상 완료된 기록이 있으면 완료로 본다", () => {
    expect(ev(at("02:00:00"), [run("blocked", { id: 4 }), run("succeeded", { id: 6, started_at: "2026-10-29T00:10:00Z" })]).state).toBe("COMPLETED");
  });
  it("수동 점검과 어제 예약 점검은 오늘 예약 점검을 대신하지 않는다", () => {
    expect(ev(at("01:00:00"), [run("succeeded", { trigger: "manual" })]).state).toBe("MISSED");
    expect(ev(at("01:00:00"), [run("succeeded", { started_at: "2026-10-28T00:00:05Z" })]).state).toBe("MISSED");
  });
  it("KST 하루 경계: 오늘 00:00:00 KST에 시작한 예약 점검은 오늘 것, 전날 23:59:59 KST는 어제 것", () => {
    expect(ev(at("01:00:00"), [run("succeeded", { started_at: "2026-10-28T15:00:00Z" })]).state).toBe("COMPLETED");
    expect(ev(at("01:00:00"), [run("succeeded", { started_at: "2026-10-28T14:59:59Z" })]).state).toBe("MISSED");
  });
});

describe("예약 시각 값의 일치", () => {
  it("scripts/lib/schedule-clock.mjs의 UTC 시각이 lib/time.ts의 SCHEDULED_RUN_UTC와 같다", () => {
    const text = readFileSync(path.join(process.cwd(), "scripts", "lib", "schedule-clock.mjs"), "utf8");
    const m = /SCHEDULED_RUN_UTC = \{ hour: (\d+), minute: (\d+) \}/.exec(text);
    expect({ hour: Number(m?.[1]), minute: Number(m?.[2]) }).toEqual(SCHEDULED_RUN_UTC);
  });
});

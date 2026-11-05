// `/web` 화면의 Supabase 읽기(view-supabase.ts)를 "진짜 DB"에 대 보는 시험 (W13) — 읽기만 한다(아무것도 쓰지 않는다).
// 보통의 `npm run test:unit`에서는 건너뛴다. 실행: LIVE_DB=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-view-live.test.ts
// 서버 관리용 연결로 읽으므로 로그인 사용자(RLS) 권한 확인은 아니지만, 질의 모양(칸 이름, 조건, 정렬)이 실제 표와 맞는지는 확인한다.
// (RLS 읽기 허용은 check:db·pgTAP이 따로 확인한다)
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

const live = process.env.LIVE_DB === "1" && !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!live)("홈페이지 모니터링 화면 읽기 + 실제 DB", () => {
  const make = async () => {
    const { createSupabaseViewSource } = await import("@/lib/web-monitor/view-supabase");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    return createSupabaseViewSource(db);
  };

  it("개요: 모든 칸이 읽히고(ok), 점검 이력·상태·설정이 화면 모델 모양이다", async () => {
    const source = await make();
    const o = await source.loadOverview(new Date(), "onbid-home", "온비드 홈페이지");
    for (const key of ["settings", "state", "runs", "lastGoodFinishedAt", "notifications", "anomalyByIncident"] as const) expect(o[key].ok, key).toBe(true);
    if (o.settings.ok) {
      expect(typeof o.settings.data.enabled).toBe("boolean");
      expect(o.settings.data.staleMin).toBeGreaterThanOrEqual(90);
    }
    if (o.runs.ok && o.runs.data.length > 0) {
      const r = o.runs.data[0];
      expect(r).toMatchObject({ targetKey: "onbid-home" });
      expect(["scheduled", "retry", "manual"]).toContain(r.trigger);
      expect(r.probes.length).toBeGreaterThan(0);
      // 최신순
      const times = o.runs.data.map((x) => x.startedAt);
      expect([...times].sort().reverse()).toEqual(times);
    }
    if (o.state.ok && o.state.data) expect(["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"]).toContain(o.state.data.currentVerdict);
  });

  it("경고 띠 입력과 점검 상세: 가장 최근 정시 점검의 상세가 읽힌다", async () => {
    const source = await make();
    const b = await source.loadBannerInputs(new Date(), "onbid-home");
    expect(b.settings.ok && b.lastGoodFinishedAt.ok && b.notifications.ok).toBe(true);
    const o = await source.loadOverview(new Date(), "onbid-home", "온비드 홈페이지");
    if (o.runs.ok && o.runs.data.length > 0) {
      const id = o.runs.data[0].id;
      const detail = await source.loadRun(id);
      expect(detail?.run.id).toBe(id);
    }
    expect(await source.loadRun(999_999_999)).toBeNull();
  });
});

// 웹 설정을 "진짜 Supabase DB"에서 읽어 규칙 검사를 통과하는지 보는 시험 (W05, 읽기 전용 — DB에 아무것도 쓰지 않음)
// 보통의 `npm run test:unit`에서는 건너뛴다. 실행: node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-settings-live.test.ts (환경변수 LIVE_DB=1 필요)
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { parseSettings } from "@/lib/settings/schema";
import { DEFAULT_WEB_SETTINGS, parseWebSettings } from "@/lib/web-monitor/settings";

const live = process.env.LIVE_DB === "1" && !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!live)("웹 설정 + 실제 DB (읽기 전용)", () => {
  const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

  it("web_settings를 읽어 검증을 통과하고 기본값과 같다", async () => {
    const { data, error } = await db().from("web_settings").select("key, value");
    expect(error).toBeNull();
    const s = parseWebSettings(data ?? []);
    expect(s).toEqual({ ...DEFAULT_WEB_SETTINGS, monitorEnabled: s.monitorEnabled }); // 켜기/끄기만 운영 중 바뀔 수 있다
  });

  it("기존 settings는 웹 설정과 무관하게 계속 읽힌다 (격리)", async () => {
    const { data, error } = await db().from("settings").select("key, value");
    expect(error).toBeNull();
    expect(() => parseSettings(data ?? [])).not.toThrow();
  });
});

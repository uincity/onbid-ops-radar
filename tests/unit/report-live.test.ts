// 일일 점검보고서를 실제 DB에서 10번 만들어 "60초 이내"를 확인하는 시험 (R08, PRD 3-1 보고서 기준, PLAN 35)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run test:success`로만 실행한다 (.env의 서버 관리용 키 필요).
// 보고서 "만들기"(읽기·계산)만 하고 저장(reports 추가)은 하지 않으므로 DB에 아무것도 남지 않는다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// 설정값 읽기(loadSettings)가 Next.js의 요청 범위를 요구하므로 요청 바깥(시험)에서는 대체한다. 화면·서버 액션에서는 실제 요청 안에서 실행된다.
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const live = process.env.LIVE_DB === "1" && !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;
const RUNS = 10;
const LIMIT_MS = 60_000;

describe.skipIf(!live)("일일 점검보고서 60초 기준 (실제 DB, 10회)", () => {
  let db: SupabaseClient;
  beforeAll(() => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  for (const source of ["DEMO", "PUBLIC"] as const) {
    it(`${source}: 같은 날짜 보고서를 ${RUNS}번 만들면 매번 60초 안에 끝나고 집계가 같다`, async () => {
      const { generateReportModel } = await import("@/lib/reports/generate");
      const { toKstDateString } = await import("@/lib/time");
      const now = new Date();
      const date = toKstDateString(now);
      const durations: number[] = [];
      const models: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const started = Date.now();
        const model = await generateReportModel(db, { date, source, now });
        durations.push(Date.now() - started);
        // 생성 시각·걸린 시간은 매번 다르므로 빼고 비교한다
        const { generatedAt, generationMs, ...rest } = model;
        void generatedAt;
        void generationMs;
        models.push(JSON.stringify(rest));
      }
      console.log(`${source} 보고서 생성 시간(ms): ${durations.join(", ")}`);
      expect(Math.max(...durations)).toBeLessThan(LIMIT_MS);
      expect(new Set(models).size).toBe(1); // 같은 DB 상태에서는 같은 숫자 (결정적 집계)
    }, 120_000);
  }
});

// 예약 점검 입구 시험 (R07, SEC-09) — 로그인 없이, 비밀값 없이는 점검이 시작되지 않는지 확인한다
import { expect, test } from "@playwright/test";

test.describe("예약 점검 입구 /api/cron/daily-check", () => {
  test("비밀값 없이 부르면 거부된다 (401, 서버에 비밀값이 없으면 503)", async ({ request }) => {
    const res = await request.post("/api/cron/daily-check");
    expect([401, 503]).toContain(res.status());
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/secret|key|password/i);
  });

  test("틀린 비밀값으로 불러도 거부된다", async ({ request }) => {
    const res = await request.post("/api/cron/daily-check", { headers: { Authorization: "Bearer definitely-wrong" } });
    expect([401, 503]).toContain(res.status());
  });

  test("GET으로는 열 수 없다 (POST만 허용)", async ({ request }) => {
    const res = await request.get("/api/cron/daily-check");
    expect(res.status()).toBe(405);
  });
});

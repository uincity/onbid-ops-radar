// 이상징후 목록·상세 화면 시험 (PLAN 25·28번) — 데이터가 있는지 없는지에 관계없이 통과하도록 만든다.
import { expect, test } from "@playwright/test";
import { OPERATOR, requireDemoAccounts, signInThroughForm } from "./helpers";

test.beforeAll(requireDemoAccounts);

test.describe("이상징후 목록", () => {
  test("제목·빠른 필터 버튼·표 또는 빈 안내가 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/anomalies");

    await expect(page.getByRole("heading", { name: "이상징후", level: 1 })).toBeVisible();
    const quick = page.getByRole("navigation", { name: "빠른 필터" });
    for (const label of ["전체", "미확인", "내 담당", "담당자 없음", "검토 중", "종결"]) {
      await expect(quick.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // 데이터가 있으면 표, 없으면 빈 안내 (둘 중 하나)
    await expect(page.getByTestId("anomaly-table").or(page.getByTestId("anomaly-empty"))).toBeVisible();
    await expect(page.getByTestId("anomaly-total")).toContainText("총");
  });

  test("필터 버튼을 누르면 주소가 바뀌고, 잘못된 쿼리 값은 무시된다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/anomalies");
    await page.getByRole("navigation", { name: "빠른 필터" }).getByRole("link", { name: "미확인", exact: true }).click();
    await expect(page).toHaveURL(/status=open/);

    await page.goto("/anomalies?status=hacked&page=-5&rule=%27%3B--");
    await expect(page.getByRole("heading", { name: "이상징후", level: 1 })).toBeVisible();
    await expect(page.getByTestId("anomaly-table").or(page.getByTestId("anomaly-empty"))).toBeVisible();
  });
});

test.describe("이상징후 상세", () => {
  test("존재하지 않는 번호는 404 안내가 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/anomalies/999999999");
    await expect(page.getByRole("heading", { name: /찾을 수 없습니다/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "이상징후 목록으로 돌아가기" })).toBeVisible();
  });

  test("숫자가 아닌 번호도 404 안내가 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/anomalies/abc");
    await expect(page.getByRole("heading", { name: /찾을 수 없습니다/ })).toBeVisible();
  });

  test("목록에 건이 있으면 첫 건의 상세에 근거·원본 데이터·이력이 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/anomalies");
    const firstLink = page.getByTestId("anomaly-row").first().getByRole("link").first();
    test.skip((await firstLink.count()) === 0, "이상징후 데이터가 없어 건너뜁니다.");

    await firstLink.click();
    await expect(page.getByRole("heading", { name: /^이상징후 #\d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /탐지 근거/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /원본 데이터/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "이벤트 이력" })).toBeVisible();
    await expect(page.getByText("추가만 되는 장부")).toBeVisible();
  });
});

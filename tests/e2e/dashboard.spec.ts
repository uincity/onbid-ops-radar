// 통합 대시보드 화면 시험 (PLAN 작업 29번) — 작성만 해 두었고 실행은 나중에 한꺼번에 한다.
// Design Ref: DESIGN §4.3, PRD 5-6
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm } from "./helpers";

test.beforeAll(requireDemoAccounts);

test.describe("통합 대시보드", () => {
  test("팀장: 제목·요약 카드·최근 실행 영역이 보이고 내 담당 카드는 없다", async ({ page }) => {
    await signInThroughForm(page, ADMIN);

    await expect(page).toHaveTitle("대시보드 · OnBid Ops Radar");
    await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
    await expect(page.getByTestId("dashboard-basis")).toContainText("KST");
    await expect(page.getByTestId("today-runs")).toBeVisible();
    await expect(page.getByTestId("card-unassigned")).toBeVisible();
    await expect(page.getByTestId("card-unresolved")).toBeVisible();
    await expect(page.getByTestId("card-status-open")).toBeVisible();
    await expect(page.getByTestId("new-by-rule")).toBeVisible();
    await expect(page.getByTestId("recent-runs")).toBeVisible();
    await expect(page.getByTestId("card-mine")).toHaveCount(0);
  });

  test("운영 담당자: 내 담당 미처리 카드가 보이고 누르면 담당자 조건 목록으로 이동한다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);

    const mine = page.getByTestId("card-mine");
    await expect(mine).toBeVisible();
    await expect(mine).toHaveAttribute("href", "/anomalies?assignee=me");
    await expect(page.getByTestId("card-unassigned")).toHaveAttribute("href", "/anomalies?assignee=unassigned");
    await expect(page.getByTestId("card-status-open")).toHaveAttribute("href", "/anomalies?status=open");
  });

  test("모든 수치 옆에 출처(DEMO/PUBLIC) 구분이 보인다", async ({ page }) => {
    await signInThroughForm(page, ADMIN);

    const card = page.getByTestId("card-unresolved");
    await expect(card.getByText("DEMO", { exact: true })).toBeVisible();
    await expect(card.getByText("PUBLIC", { exact: true })).toBeVisible();
  });
});

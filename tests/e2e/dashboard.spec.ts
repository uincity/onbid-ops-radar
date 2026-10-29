// 통합 대시보드 화면 시험 (PLAN 작업 29번) — 작성만 해 두었고 실행은 나중에 한꺼번에 한다.
// Design Ref: DESIGN §4.3, PRD 5-6
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm } from "./helpers";

test.beforeAll(requireDemoAccounts);

test.describe("통합 대시보드", () => {
  test("26종 가용성: 한계 문구·6종 상태·지표 4개가 보이고, 합계가 맞으며, 서비스별 표가 열린다 (R05)", async ({ page }) => {
    await signInThroughForm(page, ADMIN);

    const section = page.getByTestId("availability");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: /가용성/ })).toBeVisible();
    await expect(page.getByTestId("availability-basis")).toContainText("온비드 서버 전체의 가용성이 아닙니다");
    await expect(page.getByTestId("availability-registry")).toContainText("목표 26종");
    for (const status of ["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"]) {
      await expect(page.getByTestId(`availability-count-${status}`)).toBeVisible();
    }
    await expect(page.getByTestId("availability-sum")).toContainText("(일치)");
    for (const id of ["metric-attempt", "metric-basic", "metric-realdata", "metric-coverage"]) await expect(page.getByTestId(id)).toBeVisible();

    await page.getByTestId("availability-details").locator("summary").click();
    await expect(page.getByTestId("availability-row").first()).toBeVisible();
    expect(await page.getByTestId("availability-row").count()).toBeGreaterThanOrEqual(28);
    // 규칙별 신규: 이전 4개 + 품질 4개 + API 7개
    await expect(page.getByTestId("new-by-rule").getByRole("listitem")).toHaveCount(15);
  });

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

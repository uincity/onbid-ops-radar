// 보고서 화면 시험 (PLAN 30번): 팀장은 생성 폼이 보이고, 운영 담당자는 안내만 보인다. 목록은 있거나 빈 안내가 나온다.
// 보고서는 한번 저장하면 지울 수 없는 장부라서, 이 시험은 [보고서 생성]을 누르지 않는다.
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm } from "./helpers";

test.beforeAll(requireDemoAccounts);

test.describe("보고서 화면: 팀장", () => {
  test("생성 폼(날짜·출처·버튼)과 목록 영역이 보인다", async ({ page }) => {
    await signInThroughForm(page, ADMIN, "/login?next=%2Freports");
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole("heading", { name: "보고서", exact: true })).toBeVisible();

    await expect(page.getByTestId("report-form")).toBeVisible();
    await expect(page.getByLabel("보고 날짜 (KST)")).toBeVisible();
    await expect(page.getByLabel("데이터 출처")).toBeVisible();
    await expect(page.getByRole("button", { name: "보고서 생성" })).toBeVisible();
    await expect(page.getByTestId("report-admin-only")).toHaveCount(0);

    // 저장된 보고서가 없으면 빈 안내, 있으면 표가 보인다 (둘 중 하나)
    await expect(page.getByTestId("report-list-empty").or(page.getByTestId("report-list"))).toBeVisible();
  });

  test("저장된 보고서가 있으면 번호를 눌러 미리보기와 다운로드 링크를 볼 수 있다", async ({ page }) => {
    await signInThroughForm(page, ADMIN, "/login?next=%2Freports");
    await expect(page).toHaveURL(/\/reports$/);

    const rows = page.getByTestId("report-row");
    test.skip((await rows.count()) === 0, "저장된 보고서가 아직 없어 미리보기 시험을 건너뜁니다.");

    await rows.first().getByRole("link").first().click();
    await expect(page).toHaveURL(/\/reports\/\d+$/);
    await expect(page.getByTestId("report-view")).toBeVisible();
    await expect(page.getByRole("link", { name: "Markdown 다운로드" })).toHaveAttribute("href", /\/reports\/\d+\/download$/);
  });

  test("없는 보고서 번호는 찾을 수 없음 화면이 나온다", async ({ page }) => {
    await signInThroughForm(page, ADMIN, "/login?next=%2Freports%2F999999999");
    await expect(page.getByText(/찾을 수 없|404/).first()).toBeVisible();
  });
});

test.describe("보고서 화면: 운영 담당자", () => {
  test("생성 폼 대신 '팀장만 할 수 있습니다' 안내가 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/login?next=%2Freports");
    await expect(page).toHaveURL(/\/reports$/);

    await expect(page.getByTestId("report-admin-only")).toContainText("보고서 생성은 팀장만 할 수 있습니다.");
    await expect(page.getByTestId("report-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "보고서 생성" })).toHaveCount(0);
    await expect(page.getByTestId("report-list-empty").or(page.getByTestId("report-list"))).toBeVisible();
  });
});

test.describe("보고서 다운로드: 비로그인", () => {
  test("로그인하지 않은 다운로드 요청은 401로 거부된다", async ({ request }) => {
    const res = await request.get("/reports/1/download", { maxRedirects: 0 });
    // 비로그인 차단(proxy)이 먼저 로그인 화면으로 보내거나(307), 다운로드 처리기가 직접 401로 거부한다. 어느 쪽이든 파일은 내려가지 않는다
    expect([307, 401]).toContain(res.status());
    if (res.status() === 307) expect(res.headers()["location"] ?? "").toContain("/login");
  });
});

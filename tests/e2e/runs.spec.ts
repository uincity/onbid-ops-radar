// 점검 이력 화면 시험 (PLAN 작업 24번) — 팀장은 수동 점검 패널, 운영 담당자는 안내만 보인다.
// 테스트 데이터가 DB에 있다고 가정하지 않는다: 목록은 "표 또는 빈 안내" 중 하나가 보이면 통과한다.
// 주의: 수동 점검을 실제로 눌러 실행하지는 않는다(점검 이력은 지울 수 없기 때문).
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireTestAccounts, signInThroughForm, signOutThroughButton } from "./helpers";

test.beforeAll(requireTestAccounts);

test.describe("점검 이력 /runs", () => {
  test("팀장: 수동 점검 패널이 보이고 출처는 PUBLIC만 쓴다(DEMO·응답 시뮬레이션은 보이지 않는다)", async ({ page }) => {
    await signInThroughForm(page, ADMIN, "/runs");
    await expect(page.getByRole("heading", { level: 1, name: "점검 이력" })).toBeVisible();

    const panel = page.getByTestId("manual-check-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "수동 점검 실행" })).toBeEnabled();
    await expect(panel.getByText("PUBLIC", { exact: true })).toBeVisible();
    await expect(panel.getByText("DEMO")).toHaveCount(0);
    await expect(panel.getByLabel("응답 시뮬레이션")).toHaveCount(0);
    await expect(page.getByTestId("manual-check-notice")).toHaveCount(0);
    // 서버 검사를 통과하도록 출처(PUBLIC)와 응답 모드(normal)는 숨은 칸으로 함께 전송된다
    await expect(panel.locator('input[type="hidden"][name="source"]')).toHaveValue("PUBLIC");
    await expect(panel.locator('input[type="hidden"][name="mode"]')).toHaveValue("normal");

    await signOutThroughButton(page);
  });

  test("운영 담당자: 패널 대신 안내만 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/runs");
    await expect(page.getByRole("heading", { level: 1, name: "점검 이력" })).toBeVisible();

    await expect(page.getByTestId("manual-check-notice")).toHaveText("수동 점검은 팀장만 실행할 수 있습니다.");
    await expect(page.getByTestId("manual-check-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "수동 점검 실행" })).toHaveCount(0);

    await signOutThroughButton(page);
  });

  test("목록: 표 또는 빈 안내가 보이고, 번호를 누르면 상세로 이동한다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/runs");
    const table = page.getByTestId("runs-table");
    const empty = page.getByTestId("runs-empty");
    await expect(table.or(empty)).toBeVisible();

    if (await table.isVisible()) {
      await expect(table.getByRole("columnheader", { name: "상태" })).toBeVisible();
      await table.getByRole("link", { name: /^#\d+$/ }).first().click();
      await expect(page).toHaveURL(/\/runs\/\d+$/);
      await expect(page.getByRole("heading", { level: 1, name: /^점검 실행 #\d+$/ })).toBeVisible();
      await expect(page.getByTestId("run-summary")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "API 호출" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "실행 메모" })).toBeVisible();
    }

    await signOutThroughButton(page);
  });

  test("상세: 없는 번호는 찾을 수 없음 화면", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/runs/999999999");
    await expect(page.getByRole("heading", { level: 1, name: /^점검 실행 #/ })).toHaveCount(0);
    await expect(page.getByText(/404|찾을 수 없|not found/i).first()).toBeVisible();
  });
});

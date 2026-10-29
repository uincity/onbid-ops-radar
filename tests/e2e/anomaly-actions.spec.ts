// 이상징후 상세의 처리 조작 버튼 노출 시험 (PLAN 26·27) — 작성만 해 둔 시험. 실제 DB를 바꾸는 버튼은 누르지 않는다.
// 이상징후가 하나도 없으면 건너뛴다. 역할별로 "보이는 버튼이 다른지"만 확인한다.
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm } from "./helpers";

test.beforeAll(requireDemoAccounts);

// 목록에서 첫 이상징후 상세로 들어간다. 없으면 false.
async function openFirstAnomaly(page: Page): Promise<boolean> {
  await page.goto("/anomalies");
  const link = page.locator('a[href^="/anomalies/"]').first();
  if ((await link.count()) === 0) return false;
  await link.click();
  await expect(page.getByTestId("anomaly-actions")).toBeVisible();
  return true;
}

test.describe("이상징후 처리 조작: 역할별 버튼 노출", () => {
  test("팀장: 담당자 선택칸이 보인다", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    test.skip(!(await openFirstAnomaly(page)), "이상징후가 없어 건너뜀 (npm run seed:demo 후 다시)");
    await expect(page.getByLabel("담당자", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(지정|재배정)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "내가 맡기" })).toHaveCount(0);
  });

  test("운영 담당자: 담당자 선택칸은 없고, 담당자가 없는 건에는 [내가 맡기]만 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    test.skip(!(await openFirstAnomaly(page)), "이상징후가 없어 건너뜀 (npm run seed:demo 후 다시)");
    await expect(page.getByLabel("담당자", { exact: true })).toHaveCount(0);

    const selfAssign = page.getByRole("button", { name: "내가 맡기" });
    if ((await selfAssign.count()) > 0) {
      // 담당자 없음: 처리 버튼은 없고 안내만 있다
      await expect(page.getByRole("button", { name: "검토 시작" })).toHaveCount(0);
      await expect(page.getByTestId("action-blocked")).toBeVisible();
    }
  });

  test("사유 입력: 글자 수 안내가 바뀌고 10자 미만이면 닫기 버튼이 꺼져 있다 (입력만, 제출 안 함)", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    test.skip(!(await openFirstAnomaly(page)), "이상징후가 없어 건너뜀 (npm run seed:demo 후 다시)");
    const field = page.getByLabel(/^(조치내용|판정 사유|재개 사유)$/).first();
    test.skip((await field.count()) === 0, "사유 입력칸이 있는 상태(검토 중/종결)의 건이 아니라 건너뜀");

    await field.fill("짧은 글");
    await expect(page.getByText(/현재 3자 \/ 10자 이상/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^(조치 완료로 닫기|정상 판정으로 닫기|검토 재개)$/ }).first()).toBeDisabled();

    await field.fill("충분히 길게 적은 사유입니다");
    await expect(page.getByRole("button", { name: /^(조치 완료로 닫기|정상 판정으로 닫기|검토 재개)$/ }).first()).toBeEnabled();
  });
});

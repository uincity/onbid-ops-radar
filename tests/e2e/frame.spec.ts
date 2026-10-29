// 로그인 뒤 공통 화면 틀 시험 (PLAN 작업 15번)
// Design Ref: DESIGN §4.2(공통 화면 틀: 앱 이름·메뉴 4개·출처 배지·사용자·로그아웃, 좁은 화면에서는 메뉴가 접힘)
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm, signOutThroughButton } from "./helpers";

test.beforeAll(requireDemoAccounts);

const MENUS = [
  { label: "대시보드", href: "/", title: "대시보드" },
  { label: "이상징후", href: "/anomalies", title: "이상징후" },
  { label: "점검 이력", href: "/runs", title: "점검 이력" },
  { label: "보고서", href: "/reports", title: "보고서" },
];

test.describe("공통 화면 틀 (넓은 화면)", () => {
  test("운영 담당자: 앱 이름·메뉴 4개·출처 배지·사용자·로그아웃이 보인다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);

    await expect(page.getByRole("banner").getByRole("link", { name: "OnBid Ops Radar" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "주 메뉴", exact: true });
    for (const menu of MENUS) await expect(nav.getByRole("link", { name: menu.label, exact: true })).toBeVisible();

    await expect(page.getByTestId("source-badge")).toHaveText("DEMO");
    await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
    await expect(page.getByTestId("user-role")).toHaveText(OPERATOR.roleLabel);
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
    await expect(page).toHaveTitle("대시보드 · OnBid Ops Radar");

    await signOutThroughButton(page);
  });

  test("팀장: 역할이 팀장으로 표시된다", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    await expect(page.getByTestId("user-name")).toHaveText(ADMIN.name);
    await expect(page.getByTestId("user-role")).toHaveText(ADMIN.roleLabel);
    await signOutThroughButton(page);
  });

  test("메뉴를 누르면 해당 화면으로 이동하고, 지금 화면의 메뉴가 강조된다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    const nav = page.getByRole("navigation", { name: "주 메뉴", exact: true });

    for (const menu of [...MENUS.slice(1), MENUS[0]]) {
      await nav.getByRole("link", { name: menu.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`localhost:\\d+${menu.href === "/" ? "/$" : `${menu.href}$`}`));
      await expect(page.getByRole("heading", { level: 1, name: menu.title })).toBeVisible();
      await expect(page).toHaveTitle(`${menu.title} · OnBid Ops Radar`);
      // 지금 화면의 메뉴만 강조(aria-current)된다
      await expect(nav.getByRole("link", { name: menu.label, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
      // 메뉴를 옮겨 다녀도 사용자 정보는 그대로 보인다
      await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
    }

    await signOutThroughButton(page);
  });

  test("앱 이름을 누르면 대시보드로 돌아간다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "보고서", exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.getByRole("banner").getByRole("link", { name: "OnBid Ops Radar" }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await signOutThroughButton(page);
  });

  test("키보드: Tab 키를 한 번 누르면 '본문으로 건너뛰기'가 보이고, 누르면 본문으로 이동한다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    await expect(page.getByTestId("user-name")).toBeVisible();
    // 화면을 새로 열어서(포커스가 처음 상태) 키보드로 처음 Tab을 누르는 상황을 만든다
    await page.goto("/");
    await expect(page.getByTestId("user-name")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await page.goto("/");
    await signOutThroughButton(page);
  });
});

test.describe("로그인하지 않고 각 화면 주소로 들어갈 때", () => {
  for (const menu of MENUS.slice(1)) {
    test(`${menu.href}: 로그인 화면으로 갔다가 로그인하면 그 화면으로 돌아온다`, async ({ page }) => {
      await page.goto(menu.href);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(menu.href).replace(/%/g, "%")}$`));
      await signInThroughForm(page, OPERATOR, page.url());
      await expect(page).toHaveURL(new RegExp(`localhost:\\d+${menu.href}$`));
      await expect(page.getByRole("heading", { level: 1, name: menu.title })).toBeVisible();
      await signOutThroughButton(page);
    });
  }
});

test.describe("공통 화면 틀 (좁은 화면, 모바일)", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("가로 메뉴는 숨고 [메뉴] 버튼 안에 메뉴·사용자·로그아웃이 들어 있다. 메뉴를 누르면 이동하고 메뉴가 닫힌다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);

    // 가로 메뉴와 넓은 화면용 사용자 정보는 보이지 않는다
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true })).toBeHidden();
    await expect(page.getByTestId("user-name")).toBeHidden();
    // 출처 배지는 좁은 화면에서도 보인다
    await expect(page.getByTestId("source-badge")).toHaveText("DEMO");

    const menuButton = page.locator("summary", { hasText: "메뉴" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const mobileNav = page.getByRole("navigation", { name: "주 메뉴(모바일)", exact: true });
    for (const menu of MENUS) await expect(mobileNav.getByRole("link", { name: menu.label, exact: true })).toBeVisible();
    await expect(page.getByTestId("mobile-user-name")).toHaveText(OPERATOR.name);
    await expect(page.getByTestId("mobile-user-role")).toHaveText(OPERATOR.roleLabel);

    // 펼친 메뉴 상자가 화면(너비 390) 밖으로 삐져나가지 않는다. ("보인다"만으로는 일부가 잘린 것을 알 수 없어 위치까지 확인한다)
    const box = await page.locator("details > div").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    // 화면을 옮기면 메뉴가 저절로 닫힌다
    await mobileNav.getByRole("link", { name: "이상징후", exact: true }).click();
    await expect(page).toHaveURL(/\/anomalies$/);
    await expect(page.getByRole("heading", { level: 1, name: "이상징후" })).toBeVisible();
    await expect(page.locator("details")).not.toHaveAttribute("open", "");

    // 메뉴 안의 [로그아웃]
    await page.locator("summary", { hasText: "메뉴" }).click();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("좁은 화면에서도 옆으로 스크롤되지 않는다 (가로 넘침 없음)", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    await expect(page.getByTestId("source-badge")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator("summary", { hasText: "메뉴" }).click();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("데이터 출처 배지", () => {
  test("배지는 설정값(scheduled_source)을 따른다: PUBLIC으로 바꾸면 PUBLIC, 되돌리면 DEMO", async ({ page }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    test.skip(!url || !secret, "서버 관리용 키가 없어 설정값을 바꿔 볼 수 없습니다.");

    const admin = createClient(url!, secret!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: before, error } = await admin.from("settings").select("value").eq("key", "scheduled_source").single();
    expect(error).toBeNull();
    expect(before?.value).toBe("DEMO");

    try {
      await signInThroughForm(page, OPERATOR);
      await expect(page.getByTestId("source-badge")).toHaveText("DEMO");

      const { error: updateError } = await admin.from("settings").update({ value: "PUBLIC" }).eq("key", "scheduled_source");
      expect(updateError).toBeNull();
      await page.reload();
      await expect(page.getByTestId("source-badge")).toHaveText("PUBLIC");
    } finally {
      // 어떤 경우에도 원래 값으로 되돌린다
      await admin.from("settings").update({ value: before?.value ?? "DEMO" }).eq("key", "scheduled_source");
    }

    await page.reload();
    await expect(page.getByTestId("source-badge")).toHaveText("DEMO");
    await signOutThroughButton(page);
  });
});

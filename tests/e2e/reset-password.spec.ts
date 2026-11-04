// 비밀번호 설정 링크 → 비밀번호 설정 화면 → 새 비밀번호로 로그인 시험 (npm run add:account가 만드는 링크와 같은 방식)
// 시험용 임시 계정(example.com)을 만들어 쓰고, 끝나면 지운다. 비밀번호는 시험 안에서 무작위로 만들며 어디에도 출력하지 않는다.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { signInThroughForm, signOutThroughButton } from "./helpers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

test.describe("비밀번호 설정 링크", () => {
  test.skip(!url || !secret, "서버 관리용 키가 없어 임시 계정을 만들 수 없습니다.");

  const email = `e2e-reset-${Date.now()}@example.com`;
  const admin = createClient(url ?? "http://localhost", secret ?? "unset", { auth: { autoRefreshToken: false, persistSession: false } });
  let userId = "";

  async function newLink() {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    expect(error).toBeNull();
    return `/auth/confirm?token_hash=${encodeURIComponent(data!.properties!.hashed_token)}&type=recovery`;
  }

  test.beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
    expect(error).toBeNull();
    userId = data.user!.id;
    const { error: profileError } = await admin.from("profiles").upsert({ id: userId, display_name: "시험 임시 담당자", role: "operator" }, { onConflict: "id" });
    expect(profileError).toBeNull();
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  test("잘못된 링크는 로그인 화면으로 돌아가 안내 문구를 보여 준다", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=zzzzzzzzzzzzzzzz&type=recovery");
    await expect(page).toHaveURL(/\/login\?error=link$/);
    await expect(page.getByText("비밀번호 설정 링크가 올바르지 않거나 만료되었습니다")).toBeVisible();

    await page.goto("/auth/confirm");
    await expect(page).toHaveURL(/\/login\?error=link$/);
  });

  test("링크로 들어와 비밀번호를 정하고, 그 비밀번호로 로그인한다. 링크는 한 번만 쓸 수 있다", async ({ page, browser }) => {
    const link = await newLink();
    const password = randomBytes(18).toString("base64url"); // 24자

    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole("heading", { name: "비밀번호 설정" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // 짧거나 서로 다르면 저장하지 않고 이유를 알려 준다
    await page.getByLabel("새 비밀번호", { exact: true }).fill("short");
    await page.getByLabel("새 비밀번호 확인").fill("short");
    await page.getByRole("button", { name: "비밀번호 저장" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "12자 이상" })).toBeVisible();

    await page.getByLabel("새 비밀번호", { exact: true }).fill(password);
    await page.getByLabel("새 비밀번호 확인").fill(`${password}x`);
    await page.getByRole("button", { name: "비밀번호 저장" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "서로 다릅니다" })).toBeVisible();

    // 올바르게 입력하면 저장되고 첫 화면으로 간다
    await page.getByLabel("새 비밀번호", { exact: true }).fill(password);
    await page.getByLabel("새 비밀번호 확인").fill(password);
    await page.getByRole("button", { name: "비밀번호 저장" }).click();
    await expect(page).toHaveURL(/\/\/[^/]+\/$/);
    await expect(page.getByTestId("user-name")).toHaveText("시험 임시 담당자");
    await signOutThroughButton(page);

    // 새 비밀번호로 로그인된다
    await signInThroughForm(page, { email, password });
    await expect(page.getByTestId("user-name")).toHaveText("시험 임시 담당자");
    await signOutThroughButton(page);

    // 같은 링크를 다시 쓰면 거부된다
    const second = await (await browser.newContext()).newPage();
    await second.goto(link);
    await expect(second).toHaveURL(/\/login\?error=link$/);
    await second.context().close();
  });

  test("로그인하지 않고 비밀번호 설정 화면 주소로 들어가면 로그인 화면으로 간다", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login\?next=%2Freset-password$/);
  });
});

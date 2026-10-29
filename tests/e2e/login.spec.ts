// 로그인·로그아웃과 비로그인 차단 시험 (PLAN 작업 14번, 보안 테스트 SEC-01)
// Design Ref: DESIGN §4.1(/login), §7(signIn/signOut), §9(로그인 없이 접근 → proxy 차단), §10(화면 동작 시험)
//
// 시연 계정(팀장·운영 담당자)으로 실제 로그인한다. 비밀번호는 .env에서 읽어 입력창에만 넣고 어디에도 출력하지 않는다.
// 계정은 `npm run setup:accounts`가 만든다.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, OPERATOR, requireDemoAccounts, signInThroughForm, signOutThroughButton } from "./helpers";

test.beforeAll(requireDemoAccounts);

test.describe("비로그인 차단 (SEC-01)", () => {
  test("로그인하지 않고 첫 화면을 열면 /login으로 이동한다", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "OnBid Ops Radar" })).toBeVisible();
    await expect(page.getByLabel("이메일")).toBeVisible();
    await expect(page.getByLabel("비밀번호")).toBeVisible();
  });

  test("로그인하지 않고 다른 화면 주소를 열면 /login으로 이동하고 원래 주소를 기억한다", async ({ page }) => {
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/login\?next=%2Fno-access$/);
  });

  test("로그인하지 않은 API 요청은 401로 거부된다", async ({ request }) => {
    const res = await request.get("/api/anything", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("예약 점검 입구(/api/cron/)는 로그인 검사 대상이 아니다 (CRON_SECRET으로 따로 인증, PLAN 31번)", async ({ request }) => {
    const res = await request.get("/api/cron/daily-check", { maxRedirects: 0 });
    // 아직 입구를 만들지 않아 404이다. 중요한 것은 로그인 화면으로 넘기거나(3xx) 401로 막지 않는다는 점이다.
    expect(res.status()).not.toBe(401);
    expect(res.status() >= 300 && res.status() < 400).toBe(false); // 3xx(로그인 화면으로 넘기기)가 아니어야 한다
  });

  test("정적 파일은 로그인 없이 열린다 (화면이 깨지지 않음)", async ({ request }) => {
    const res = await request.get("/favicon.ico", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});

test.describe("로그인 실패", () => {
  test("틀린 비밀번호로는 로그인되지 않고 안내 문구가 나온다", async ({ page }) => {
    await signInThroughForm(page, { email: ADMIN.email, password: "wrong-password-for-test" });
    await expect(page.locator("#login-error")).toContainText("이메일 또는 비밀번호가 올바르지 않습니다.");
    await expect(page).toHaveURL(/\/login/);
    // 이메일은 다시 채워 주고, 비밀번호 칸은 비워 둔다
    await expect(page.getByLabel("이메일")).toHaveValue(ADMIN.email);
    await expect(page.getByLabel("비밀번호")).toHaveValue("");
  });

  test("존재하지 않는 계정도 같은 문구로 안내한다 (계정 존재 여부를 알려 주지 않음)", async ({ page }) => {
    await signInThroughForm(page, { email: "nobody-here@example.com", password: "wrong-password-for-test" });
    await expect(page.locator("#login-error")).toContainText("이메일 또는 비밀번호가 올바르지 않습니다.");
  });

  test("이메일 형식이 틀리면 입력을 다시 하라고 안내한다", async ({ page }) => {
    await signInThroughForm(page, { email: "not-an-email", password: "anything" });
    await expect(page.locator("#login-error")).toContainText("이메일과 비밀번호를 올바르게 입력해 주세요.");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("로그인·로그아웃", () => {
  test("팀장 계정으로 로그인하면 이름과 역할이 보이고, 로그아웃하면 다시 막힌다", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByTestId("user-name")).toHaveText(ADMIN.name);
    await expect(page.getByTestId("user-role")).toHaveText(ADMIN.roleLabel);

    await signOutThroughButton(page);

    // 로그아웃 뒤에는 첫 화면도 열 수 없다
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("운영 담당자 계정으로 로그인하면 이름과 역할이 보인다. 로그인한 채 /login을 열면 첫 화면으로 돌아간다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
    await expect(page.getByTestId("user-role")).toHaveText(OPERATOR.roleLabel);

    await page.goto("/login");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);

    await signOutThroughButton(page);
  });

  test("로그인한 사용자도 새로고침하면 로그인이 유지된다 (세션 쿠키)", async ({ page }) => {
    await signInThroughForm(page, OPERATOR);
    await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
    await page.reload();
    await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
    await signOutThroughButton(page);
  });
});

test.describe("로그인 뒤 돌아갈 주소(next)", () => {
  test("우리 사이트 안의 주소는 로그인 뒤 그 주소로 돌아간다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/login?next=%2F%3Fwelcome%3D1");
    await expect(page).toHaveURL(/localhost:\d+\/\?welcome=1$/);
    await signOutThroughButton(page);
  });

  for (const evil of ["https://evil.example/phish", "//evil.example/phish", "/\\evil.example"]) {
    test(`외부 주소(${evil})로는 보내지 않고 첫 화면으로 보낸다 (열린 리다이렉트 방지)`, async ({ page }) => {
      await signInThroughForm(page, OPERATOR, `/login?next=${encodeURIComponent(evil)}`);
      await expect(page.getByTestId("user-name")).toHaveText(OPERATOR.name);
      const url = new URL(page.url());
      expect(url.hostname).toBe("localhost");
      expect(url.pathname).toBe("/");
      await signOutThroughButton(page);
    });
  }
});

test.describe("역할이 없는 계정", () => {
  test("로그인은 되지만 사용 권한 없음 화면으로 가고 운영 화면은 보이지 않는다", async ({ page }) => {
    // 이 시험 안에서만 쓰는 임시 계정(역할 없음)을 만들고, 끝나면 반드시 지운다.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    test.skip(!url || !secret, "서버 관리용 키가 없어 임시 계정을 만들 수 없습니다.");

    const admin = createClient(url!, secret!, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `e2e-no-role-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    const userId = data.user!.id;

    try {
      await signInThroughForm(page, { email, password });
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(page.getByText("이 계정에는 사용 권한(역할)이 부여되지 않았습니다")).toBeVisible();
      // 운영 화면(첫 화면)을 열어도 사용 권한 없음 화면으로 돌려보낸다
      await page.goto("/");
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(page.getByTestId("user-name")).toHaveCount(0);
      await signOutThroughButton(page);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});

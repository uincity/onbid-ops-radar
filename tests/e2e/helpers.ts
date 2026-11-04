// 화면 자동 테스트가 함께 쓰는 도우미: 시험 전용 계정 정보와 로그인·로그아웃 동작
// 시험 전용 계정(팀장·운영 담당자)은 global-setup.ts가 시험 시작 때 준비하고 비밀번호를 환경변수(E2E_*)에 둔다. 입력창에만 넣고 어디에도 출력하지 않는다.
import { expect, type Page } from "@playwright/test";

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "",
  password: process.env.E2E_ADMIN_PASSWORD ?? "",
  name: "시험 팀장",
  roleLabel: "팀장",
};

export const OPERATOR = {
  email: process.env.E2E_OPERATOR_EMAIL ?? "",
  password: process.env.E2E_OPERATOR_PASSWORD ?? "",
  name: "시험 담당자",
  roleLabel: "운영 담당자",
};

// test.beforeAll에 넘겨 쓴다: 시험 계정 정보가 없으면 이유를 알려 주며 멈춘다.
export function requireTestAccounts() {
  const missing = ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD", "E2E_OPERATOR_EMAIL", "E2E_OPERATOR_PASSWORD"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(`시험 계정 정보가 준비되지 않았습니다: ${missing.join(", ")} — npm run test:e2e로 실행해 주세요(.env를 읽고 시험 계정을 자동으로 준비합니다).`);
  }
}

// 로그인 화면(또는 로그인 화면으로 넘어가는 주소)에서 이메일·비밀번호를 입력하고 [로그인]을 누른다.
export async function signInThroughForm(page: Page, account: { email: string; password: string }, startUrl = "/login") {
  await page.goto(startUrl);
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호").fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

// 화면의 [로그아웃] 버튼을 누르고 로그인 화면으로 돌아왔는지 확인한다. (넓은 화면용. 좁은 화면은 메뉴를 먼저 연다)
export async function signOutThroughButton(page: Page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

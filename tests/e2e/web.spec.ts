// 홈페이지 모니터링 화면 시험 (W13) — /web, /web/runs/[id], 대시보드의 경고 띠, 메뉴
// 이 시험은 개발 서버를 WEB_MONITOR_STORE=mock으로 띄워(playwright.config.ts) 운영 DB의 점검 기록을 읽지도 쓰지도 않고 가짜 데이터로 화면만 확인한다.
// 이미 떠 있는 개발 서버를 재사용하면 목 데이터가 아닐 수 있다 → 시작할 때 목 안내 문구가 없으면 이유를 알려 주며 건너뛴다. 배포 주소(E2E_BASE_URL)에는 돌리지 않는다.
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, OPERATOR, requireTestAccounts, signInThroughForm, signOutThroughButton } from "./helpers";

test.beforeAll(requireTestAccounts);
test.skip(!!process.env.E2E_BASE_URL, "목 데이터가 필요한 시험이라 배포 주소에는 돌리지 않습니다");

async function openWeb(page: Page, account = OPERATOR) {
  await signInThroughForm(page, account, "/web");
  await expect(page.getByRole("heading", { level: 1, name: "홈페이지 모니터링" })).toBeVisible();
  // 본문은 제목보다 늦게 도착하므로(Suspense) 안내 문구가 나타나기를 기다려 본다
  const isMock = await page.getByTestId("web-mock-notice").waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
  test.skip(!isMock, "개발 서버가 목 저장소(WEB_MONITOR_STORE=mock)로 떠 있지 않습니다. 떠 있는 개발 서버를 끄고 npm run test:e2e로 다시 실행해 주세요.");
}

test.describe("홈페이지 모니터링 /web", () => {
  test("운영 담당자·팀장 모두 같은 화면을 본다: 현재 상태·24시간 띠·보조 확인·점검 이력·알림 기록", async ({ page }) => {
    await openWeb(page, OPERATOR);

    const status = page.getByTestId("web-status-card");
    await expect(status).toBeVisible();
    await expect(page.getByTestId("web-status-verdict")).toHaveText("정상");
    await expect(page.getByTestId("web-status-span")).toContainText("지속");
    await expect(status).toContainText("단일 지점, 1시간 간격 외부 관측");
    await expect(page.getByTestId("web-status-monitor")).toContainText("정상 작동");

    await expect(page.getByTestId("web-strip")).toBeVisible();
    await expect(page.getByTestId("web-aux")).toContainText("진입 스텁");
    await expect(page.getByTestId("web-aux")).toContainText("홈페이지 판정에는 반영되지 않습니다");
    await expect(page.getByTestId("web-notifications")).toBeVisible();
    await expect(page.getByTestId("web-runs")).toBeVisible();

    // 계획 점검 창·지금 점검은 뒤 작업이라 아직 없다 (팀장 전용 기능 노출 없음)
    await expect(page.getByRole("button", { name: /지금 점검|창 등록/ })).toHaveCount(0);
    await signOutThroughButton(page);

    await signInThroughForm(page, ADMIN, "/web");
    await expect(page.getByRole("heading", { level: 1, name: "홈페이지 모니터링" })).toBeVisible();
    await expect(page.getByTestId("web-status-card")).toBeVisible();
    await signOutThroughButton(page);
  });

  test("24시간 띠: 24칸에 확인 중·계획 점검·미등록 점검·일시 실패·성능 저하가 있고, 글자 목록으로도 볼 수 있다", async ({ page }) => {
    await openWeb(page);
    const cells = page.getByTestId("web-strip-cell");
    await expect(cells).toHaveCount(24);
    for (const kind of ["PASS_DATA", "checking", "planned", "unplanned", "DEGRADED"]) {
      expect(await page.locator(`[data-testid="web-strip-cell"][data-kind="${kind}"]`).count(), kind).toBeGreaterThan(0);
    }
    expect(await page.locator('[data-testid="web-strip-cell"][data-flap="true"]').count()).toBeGreaterThan(0);
    // 칸마다 글자로 뜻을 알 수 있다 (색만으로 전하지 않음)
    await expect(page.locator('[data-testid="web-strip-cell"][data-kind="checking"] [aria-label]').first()).toHaveAttribute("aria-label", /확인 중/);
    await expect(page.locator('[data-testid="web-strip-cell"][data-kind="planned"] [aria-label]').first()).toHaveAttribute("aria-label", /계획 점검/);
    await page.getByText("글자로 보기").click();
    await expect(page.getByTestId("web-strip-text")).toContainText("미등록 점검");
  });

  test("점검 이력: 정시·재확인·수동·차단을 구분하고, 수동은 상태에 반영 안 됨을 표시한다", async ({ page }) => {
    await openWeb(page);
    const table = page.getByTestId("web-runs-table");
    await expect(table.getByRole("columnheader", { name: "응답시간" })).toBeVisible();
    await expect(table).toContainText("정시");
    await expect(table).toContainText("재확인");
    await expect(table).toContainText("수동(상태에 반영 안 됨)");
    await expect(table).toContainText("차단됨");
    await expect(table).toContainText("일시 실패 해소");
  });

  test("알림 기록: 발송됨과 발송 실패(붉게)가 보이고, 같은 알림의 시도는 한 줄로 모인다", async ({ page }) => {
    await openWeb(page);
    const rows = page.getByTestId("web-notification");
    await expect(rows).toHaveCount(3); // 장애 감지 · 복구 · 인증서 (시도는 한 줄로 모임)
    const problem = page.locator('[data-testid="web-notification"][data-problem="true"]');
    await expect(problem).toHaveCount(1);
    await expect(problem).toContainText("복구");
    await expect(problem).toContainText("발송 실패");
    await expect(problem).toContainText("시도 3회");
    await expect(page.getByTestId("web-notifications")).toContainText("발송됨");
    await expect(page.getByTestId("web-notifications").getByRole("link", { name: /이상징후 #123/ }).first()).toBeVisible();
  });

  test("경고 띠: 알림 발송 실패가 있으면 /web과 대시보드 맨 위에 보이고, 점검 정지 띠는 없다", async ({ page }) => {
    await openWeb(page);
    await expect(page.getByTestId("web-banner-notify")).toBeVisible();
    await expect(page.getByTestId("web-banner-notify")).toContainText("알림이 발송되지 않았습니다");
    await expect(page.getByTestId("web-banner-stale")).toHaveCount(0);
    await expect(page.getByTestId("web-banner-off")).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
    await expect(page.getByTestId("web-banner-notify")).toBeVisible();
    // 띠의 링크로 /web의 알림 기록으로 이동한다
    await page.getByTestId("web-banner-notify").getByRole("link", { name: "자세히 보기" }).click();
    await expect(page).toHaveURL(/\/web#web-notifications$/);
  });

  test("띠 칸을 누르면 점검 상세로 가고, 층별 결과·반영 여부·원래/재확인 링크가 보인다", async ({ page }) => {
    await openWeb(page);
    // 일시 실패 칸(재확인에서 정상) → 상세에 재확인 결과 링크가 있다
    await page.locator('[data-testid="web-strip-cell"][data-flap="true"] a').first().click();
    await expect(page).toHaveURL(/\/web\/runs\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: "홈페이지 점검 상세" })).toBeVisible();
    const summary = page.getByTestId("web-run-summary");
    await expect(summary).toContainText("정시");
    await expect(summary).toContainText("일시 실패");
    await expect(page.getByTestId("web-run-followup")).toContainText("재확인 결과");

    const layers = page.getByTestId("web-run-layers");
    await expect(layers.getByTestId("web-run-layer-row")).toHaveCount(5);
    await expect(layers).toContainText("L2 HTTP");
    await expect(layers).toContainText("서버 오류(5xx)");
    await expect(layers).toContainText("반영 안 됨"); // 보조 확인·인증서 제외
    await expect(layers).toContainText("응답 본문은 저장하지 않으므로");

    // 재확인 실행으로 이동하면 '원래 실행' 링크가 보인다
    await page.getByTestId("web-run-followup").getByRole("link").click();
    await expect(page.getByTestId("web-run-origin")).toContainText("원래 실행");
    await page.getByRole("link", { name: /홈페이지 모니터링으로 돌아가기/ }).click();
    await expect(page).toHaveURL(/\/web$/);
  });

  test("없는 점검 번호·숫자가 아닌 번호는 찾을 수 없음 화면이다", async ({ page }) => {
    await openWeb(page);
    for (const id of ["abc", "99999999", "0123456789012345678"]) {
      await page.goto(`/web/runs/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "홈페이지 점검 상세" })).toHaveCount(0);
    }
  });

  // ----- W15 계획 점검 창 (목 저장소) -----
  // datetime-local 값(KST 벽시계)을 지금으로부터 days일 뒤 hour시로 만든다
  const kstLocal = (days: number, hour: number) => new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, "0")}:00`;

  test("계획 점검 창: 운영 담당자는 목록만 보고 등록 폼·취소 버튼은 없다", async ({ page }) => {
    await openWeb(page, OPERATOR);
    const section = page.getByTestId("web-windows");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("web-window").first()).toBeVisible(); // 목 저장소가 심어 둔 예정된 창
    await expect(section).toContainText("팀장만 할 수 있습니다");
    await expect(page.getByTestId("web-window-form")).toHaveCount(0);
    await expect(page.getByTestId("web-window-cancel")).toHaveCount(0);
  });

  test("계획 점검 창: 팀장이 등록하고(목록에 KST로 보임), 겹치면 거부되고, 취소하면 취소됨으로 바뀐다", async ({ page }) => {
    await openWeb(page, ADMIN);
    const form = page.getByTestId("web-window-form");
    await expect(form).toBeVisible();

    const start = kstLocal(40, 23);
    const end = kstLocal(41, 2);
    await page.getByTestId("web-window-start").fill(start);
    await page.getByTestId("web-window-end").fill(end);
    await page.getByTestId("web-window-reason").fill("화면 시험 창");
    await page.getByTestId("web-window-submit").click();
    await expect(page.getByTestId("web-window-message")).toContainText("등록했습니다");

    const mine = page.getByTestId("web-window").filter({ hasText: "화면 시험 창" });
    await expect(mine).toHaveCount(1);
    await expect(mine).toHaveAttribute("data-state", "upcoming");
    await expect(mine).toContainText(`${start.slice(0, 10)} 23:00 ~ ${end.slice(0, 10)} 02:00`); // 입력한 KST 그대로 보인다(9시간이 밀리지 않는다)

    // 같은 시간대를 다시 등록하면 겹침으로 거부
    await page.getByTestId("web-window-start").fill(kstLocal(40, 22));
    await page.getByTestId("web-window-end").fill(kstLocal(41, 1));
    await page.getByTestId("web-window-reason").fill("겹치는 창");
    await page.getByTestId("web-window-submit").click();
    await expect(page.getByTestId("web-window-message")).toContainText("이미 등록된 점검 창");
    await expect(page.getByTestId("web-window").filter({ hasText: "겹치는 창" })).toHaveCount(0);

    // 종료가 시작보다 이르면 거부
    await page.getByTestId("web-window-start").fill(kstLocal(50, 10));
    await page.getByTestId("web-window-end").fill(kstLocal(50, 9));
    await page.getByTestId("web-window-reason").fill("거꾸로 된 창");
    await page.getByTestId("web-window-submit").click();
    await expect(page.getByTestId("web-window-message")).toContainText("점검 시간 또는 사유를 확인해 주세요");

    // 취소: 줄은 남고 상태가 '취소됨'이 되며, 취소 버튼은 사라진다
    await mine.getByTestId("web-window-cancel").click();
    await expect(page.getByTestId("web-window").filter({ hasText: "화면 시험 창" })).toHaveAttribute("data-state", "cancelled");
    await expect(page.getByTestId("web-window").filter({ hasText: "화면 시험 창" }).getByTestId("web-window-cancel")).toHaveCount(0);
  });

  test("로그인하지 않으면 /web과 상세는 로그인 화면으로 간다", async ({ page }) => {
    for (const path of ["/web", "/web/runs/5000"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

test.describe("홈페이지 모니터링 /web (좁은 화면)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("메뉴에 '홈페이지'가 있고, 가로로 넘치지 않으며, 이력은 카드 목록이고 띠는 여러 줄로 접힌다", async ({ page }) => {
    await signInThroughForm(page, OPERATOR, "/");
    await page.locator("summary", { hasText: "메뉴" }).click();
    await expect(page.getByRole("navigation", { name: "주 메뉴(모바일)" }).getByRole("link", { name: "홈페이지", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "주 메뉴(모바일)" }).getByRole("link", { name: "홈페이지", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "홈페이지 모니터링" })).toBeVisible();
    const isMock = await page.getByTestId("web-mock-notice").waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    test.skip(!isMock, "목 저장소가 아닌 개발 서버입니다");

    await expect(page.getByTestId("web-runs-cards")).toBeVisible();
    await expect(page.getByTestId("web-runs-table")).toBeHidden();
    // 24칸이 한 줄에 몰리지 않고 6칸씩 접힌다
    const tops = await page.getByTestId("web-strip-cell").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(tops).toBeGreaterThanOrEqual(4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

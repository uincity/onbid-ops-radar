// Design Ref: DESIGN §3(Playwright), §10(화면 동작 시험) — 브라우저를 자동으로 열어 화면을 눌러 보는 테스트 설정
// 실행: npm run test:e2e  (.env의 시연 계정 정보를 읽어서 쓴다)
// 브라우저는 컴퓨터에 이미 설치된 Microsoft Edge를 쓴다. (Playwright 전용 브라우저를 따로 내려받지 않는다)
import { defineConfig } from "@playwright/test";

// 이 컴퓨터에서 다른 프로그램이 흔히 쓰는 3000번을 피하고, 개발 서버를 테스트 전용 포트로 띄운다.
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  // 로그인 시험은 순서대로 하나씩 돌린다 (같은 개발 서버·같은 계정을 쓰므로)
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "msedge",
    headless: true,
    locale: "ko-KR",
    trace: "off",
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

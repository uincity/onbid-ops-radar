// Design Ref: DESIGN §3(Vitest), §10(단위 시험) — 규칙 계산 같은 "순수한 코드"를 빠르게 채점하는 단위 테스트 설정
// 실행: npm run test:unit  (DB·네트워크·브라우저 없이 1~2초 안에 끝난다)
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // 코드의 "@/lib/..." 주소를 프로젝트 루트 기준으로 읽는다 (tsconfig.json의 paths와 같다)
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

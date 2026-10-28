// Supabase CLI와 Vercel CLI가 .env의 토큰으로 인증되는지 확인하는 스크립트 (PLAN 작업 1)
// 실행: npm run check:cli  (node --env-file=.env 로 토큰을 환경변수로만 넘긴다)
// 토큰 값은 절대 화면에 출력하지 않고, CLI 출력에 섞여 나와도 **** 로 가린다.
import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "Supabase CLI",
    tokenEnv: "SUPABASE_ACCESS_TOKEN",
    // 계정에 접근할 수 있어야만 성공하는 읽기 전용 명령
    command: "npx --no-install supabase projects list --output json",
    summarize: (stdout) => {
      try {
        const projects = JSON.parse(stdout);
        return `접근 가능한 프로젝트 ${Array.isArray(projects) ? projects.length : 0}개`;
      } catch {
        return "응답 확인됨";
      }
    },
  },
  {
    name: "Vercel CLI",
    tokenEnv: "VERCEL_TOKEN",
    // VERCEL_TOKEN 환경변수로 로그인한 계정을 확인하는 읽기 전용 명령
    command: "npx --no-install vercel whoami",
    summarize: () => "로그인 계정 확인됨",
  },
];

// CLI 출력에 토큰이 섞여 있으면 가린다
function mask(text) {
  let result = text;
  for (const { tokenEnv } of checks) {
    const value = process.env[tokenEnv];
    if (value) result = result.split(value).join("****");
  }
  return result;
}

let failed = 0;

for (const check of checks) {
  const hasToken = Boolean(process.env[check.tokenEnv]?.trim());
  console.log(`\n[${check.name}] ${check.tokenEnv}: ${hasToken ? "값 있음" : "값 없음"}`);

  if (!hasToken) {
    console.log(`  결과: 실패 — .env에 ${check.tokenEnv} 값을 넣어 주세요.`);
    failed += 1;
    continue;
  }

  const run = spawnSync(check.command, {
    shell: true,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });

  if (run.status === 0) {
    console.log(`  결과: 인증 성공 (${check.summarize(run.stdout)})`);
  } else {
    failed += 1;
    // 원인 파악용으로 오류 메시지 끝부분만, 토큰을 가린 채 보여 준다
    const detail = mask(`${run.stderr ?? ""}${run.stdout ?? ""}`).trim().split("\n").slice(-3).join("\n    ");
    console.log(`  결과: 인증 실패 (종료 코드 ${run.status ?? "시간 초과"})`);
    if (detail) console.log(`    ${detail}`);
  }
}

console.log(failed === 0 ? "\n모든 CLI 인증 확인 완료" : `\n인증 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

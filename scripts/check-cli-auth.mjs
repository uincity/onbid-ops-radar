// Supabase·Vercel 접근 토큰이 .env의 값으로 "이 프로젝트에서 쓸 수 있는지" 확인하는 스크립트 (PLAN 작업 1)
// 실행: npm run check:cli  (node --env-file=.env 로 토큰을 환경변수로만 넘긴다)
// 토큰 값은 절대 화면에 출력하지 않는다.
//
// 토큰이 프로젝트·팀 범위로 제한돼 있어도(권장) 맞게 확인하도록, 계정 전체 권한이 필요한 명령(supabase projects list, vercel whoami)
// 대신 이 프로젝트에서 실제로 쓰는 읽기 전용 호출로 확인한다.
//   - Supabase: 프로젝트 DB에 `select 1`을 보내 본다 (check:db·db:push가 쓰는 권한과 같다)
//   - Vercel: .vercel/project.json의 프로젝트를 팀 범위로 조회한다 (개인 계정 토큰이면 계정 조회로 대신한다)
import { existsSync, readFileSync } from "node:fs";

const SUPABASE_REF = process.env.SUPABASE_PROJECT_REF?.trim();

function vercelProject() {
  try {
    if (!existsSync(".vercel/project.json")) return null;
    const { projectId, orgId } = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
    return projectId && orgId ? { projectId, orgId } : null;
  } catch {
    return null;
  }
}

// 응답 본문에서 사람이 읽을 이유만 꺼낸다 (토큰·내부 식별자는 쓰지 않는다)
async function reasonOf(res) {
  try {
    const body = await res.json();
    return body?.message ?? body?.error?.message ?? body?.error?.code ?? `응답 ${res.status}`;
  } catch {
    return `응답 ${res.status}`;
  }
}

const checks = [
  {
    name: "Supabase 접근 토큰",
    tokenEnv: "SUPABASE_ACCESS_TOKEN",
    run: async (token) => {
      if (!SUPABASE_REF) return { ok: false, detail: ".env에 SUPABASE_PROJECT_REF가 없습니다." };
      const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "select 1 as ok" }),
        signal: AbortSignal.timeout(30_000),
      });
      return res.ok ? { ok: true, detail: "프로젝트 DB 조회 가능" } : { ok: false, detail: await reasonOf(res) };
    },
  },
  {
    name: "Vercel 접근 토큰",
    tokenEnv: "VERCEL_TOKEN",
    run: async (token) => {
      const project = vercelProject();
      const url = project
        ? `https://api.vercel.com/v9/projects/${project.projectId}?teamId=${project.orgId}`
        : "https://api.vercel.com/v2/user"; // 연결된 프로젝트 정보가 없으면 계정 조회로 확인한다
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      return res.ok ? { ok: true, detail: project ? "배포 프로젝트(팀 범위) 조회 가능" : "로그인 계정 확인됨" } : { ok: false, detail: await reasonOf(res) };
    },
  },
];

// 오류 문구에 토큰이 섞여 있으면 가린다
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
  const token = process.env[check.tokenEnv]?.trim();
  console.log(`\n[${check.name}] ${check.tokenEnv}: ${token ? "값 있음" : "값 없음"}`);

  if (!token) {
    console.log(`  결과: 실패 — .env에 ${check.tokenEnv} 값을 넣어 주세요.`);
    failed += 1;
    continue;
  }

  try {
    const result = await check.run(token);
    if (result.ok) {
      console.log(`  결과: 인증 성공 (${result.detail})`);
    } else {
      failed += 1;
      console.log(`  결과: 인증 실패 — ${mask(result.detail)}`);
    }
  } catch (error) {
    failed += 1;
    console.log(`  결과: 확인하지 못함 — ${mask(error instanceof Error ? error.name : "알 수 없는 오류")} (네트워크 문제일 수 있습니다)`);
  }
}

console.log(failed === 0 ? "\n모든 접근 토큰 확인 완료" : `\n인증 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

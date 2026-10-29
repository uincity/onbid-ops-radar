// DB 테스트(pgTAP)를 한 번에 실행하는 스크립트 (PLAN 작업 12)
// 실행: npm run test:db
// - 테스트 파일은 supabase/tests/database/*.test.sql 이다. 파일마다 begin ... rollback 안에서 돌아서 DB에 아무것도 남기지 않는다.
// - 연결된 Supabase 프로젝트(원격 DB)에 대해 실행한다. Docker Desktop이 켜져 있어야 한다. (테스트 실행기 pg_prove가 Docker로 돈다)
// - DB 비밀번호는 환경변수로만 넘기고, 출력에 섞여 나와도 **** 로 가린다.
import { runSupabase, maskSecrets } from "./lib/supabase-cli.mjs";

const SECRET_NAMES = ["SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN"];

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("실패: .env에 SUPABASE_DB_PASSWORD가 없습니다. (npm run setup:supabase)");
  process.exit(1);
}

const run = runSupabase(["test", "db", "--linked"], {
  env: { SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD },
  timeout: 600_000,
});

const output = maskSecrets(`${run.stdout}${run.stderr}`, SECRET_NAMES).trim();
console.log(output);
console.log(run.status === 0 ? "\nDB 테스트 통과" : "\nDB 테스트 실패");
process.exit(run.status === 0 ? 0 : 1);

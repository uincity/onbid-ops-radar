// supabase/migrations 폴더의 새 마이그레이션을 연결된 Supabase 프로젝트의 DB에 반영하는 스크립트
// 실행: npm run db:push            → 실제로 반영
//       npm run db:push -- --dry-run → 무엇이 반영될지 미리 보기만 (DB는 바뀌지 않음)
// DB 비밀번호는 환경변수로만 넘기고, 출력에 섞여 나와도 **** 로 가린다.
import { runSupabase, maskSecrets } from "./lib/supabase-cli.mjs";

const SECRET_NAMES = ["SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN"];
const dryRun = process.argv.includes("--dry-run");

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("실패: .env에 SUPABASE_DB_PASSWORD가 없습니다. (npm run setup:supabase)");
  process.exit(1);
}

const args = ["db", "push", "--linked", "--yes", ...(dryRun ? ["--dry-run"] : [])];
const run = runSupabase(args, {
  env: { SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD },
  timeout: 300_000,
});

const output = maskSecrets(`${run.stdout}${run.stderr}`, SECRET_NAMES).trim();
console.log(output);
console.log(
  run.status === 0
    ? dryRun
      ? "\n미리 보기 완료 (DB는 바뀌지 않았습니다)"
      : "\nDB 반영 완료"
    : "\nDB 반영 실패",
);
process.exit(run.status === 0 ? 0 : 1);

// 예약 점검 Cron 등록 스크립트 (R07, PLAN 31·32, SEC-09)
// 실행:
//   npm run setup:cron -- --app-url https://배포주소            (미리 보기만: DB를 바꾸지 않음)
//   npm run setup:cron -- --app-url https://배포주소 --apply    (실제로 등록)
//   npm run setup:cron -- --remove --apply                       (등록한 Cron 작업 2개 해제)
//
// 등록하는 것
//   1) 매일 KST 09:00(UTC 00:00): pg_net으로 POST {주소}/api/cron/daily-check  (Authorization: Bearer CRON_SECRET)
//   2) 매일 KST 09:30(UTC 00:30): public.mark_schedule_missed()  — 예약 누락 감지
// CRON_SECRET과 앱 주소는 Supabase Vault에 보관하고, Cron SQL은 Vault에서 읽는다. 마이그레이션·저장소·화면·로그에는 값을 남기지 않는다.
//
// ⚠ 이 스크립트는 운영 DB에 매일 점검 일정을 만든다. 매일 09:00에 앱이 점검(설정값 scheduled_source: 기본 DEMO)을 실행하고 기록이 쌓인다.
//   Vercel에도 같은 CRON_SECRET이 등록되어 있어야 인증을 통과한다. (그래서 기본은 미리 보기이고, --apply를 붙여야만 바뀐다)
import { SCHEDULED_RUN_UTC } from "./lib/schedule-clock.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const remove = args.includes("--remove");
const urlIndex = args.indexOf("--app-url");
const appUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const cronSecret = process.env.CRON_SECRET;

const JOB_CHECK = "onbid-daily-check";
const JOB_MISSED = "onbid-schedule-missed";
const SECRET_NAME = "onbid_cron_secret";
const URL_NAME = "onbid_app_url";

const fail = (message) => {
  console.error(`실패: ${message}`);
  process.exit(1);
};

if (!ref || !token) fail(".env에 SUPABASE_PROJECT_REF·SUPABASE_ACCESS_TOKEN이 없습니다. (npm run check:env)");
if (!remove) {
  if (!cronSecret) fail(".env에 CRON_SECRET이 없습니다. (npm run setup:env)");
  if (!appUrl || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(appUrl)) fail("--app-url https://도메인 형식(경로 없이)으로 배포 주소를 알려 주세요.");
}

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`; // SQL 문자열 값

const { hour, minute } = SCHEDULED_RUN_UTC;
const checkSchedule = `${minute} ${hour} * * *`;
const missedSchedule = `${(minute + 30) % 60} ${hour + Math.floor((minute + 30) / 60)} * * *`; // 예정 + 30분 (설정값 기본 대기시간과 같다)

const postSql = `select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = ${lit(URL_NAME)}) || '/api/cron/daily-check',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = ${lit(SECRET_NAME)})),
  body := '{}'::jsonb,
  timeout_milliseconds := 90000
)`;

const statements = remove
  ? [`select cron.unschedule(jobname) from cron.job where jobname in (${lit(JOB_CHECK)}, ${lit(JOB_MISSED)})`]
  : [
      `create extension if not exists pg_cron with schema pg_catalog`,
      `create extension if not exists pg_net with schema extensions`,
      // Vault 비밀값: 있으면 값을 바꾸고 없으면 만든다
      `select case when exists (select 1 from vault.secrets where name = ${lit(SECRET_NAME)}) then (select vault.update_secret(id, ${lit(cronSecret)}) from vault.secrets where name = ${lit(SECRET_NAME)} limit 1) else vault.create_secret(${lit(cronSecret)}, ${lit(SECRET_NAME)}) end`,
      `select case when exists (select 1 from vault.secrets where name = ${lit(URL_NAME)}) then (select vault.update_secret(id, ${lit(appUrl)}) from vault.secrets where name = ${lit(URL_NAME)} limit 1) else vault.create_secret(${lit(appUrl)}, ${lit(URL_NAME)}) end`,
      `select cron.schedule(${lit(JOB_CHECK)}, ${lit(checkSchedule)}, $job$${postSql}$job$)`,
      `select cron.schedule(${lit(JOB_MISSED)}, ${lit(missedSchedule)}, 'select public.mark_schedule_missed()')`,
    ];

// 화면 출력용: 비밀값과 주소는 가린다
const mask = (text) => (cronSecret ? text.replaceAll(cronSecret, "****") : text).replaceAll(appUrl ?? "\u0000", "(앱 주소)");

console.log(remove ? "예약 점검 Cron 해제 계획" : "예약 점검 Cron 등록 계획");
console.log(`- 점검 호출: 매일 UTC ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (KST 09:00) → ${checkSchedule}`);
console.log(`- 누락 감지: 매일 UTC 00:30 (KST 09:30) → ${missedSchedule}`);
for (const s of statements) console.log(`  SQL> ${mask(s).split("\n")[0].slice(0, 150)}`);

if (!apply) {
  console.log("\n미리 보기입니다. DB는 바뀌지 않았습니다. 실제로 등록하려면 --apply를 붙여 다시 실행하세요.");
  process.exit(0);
}

for (const statement of statements) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: statement }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) fail(`SQL 실행 실패 (응답 ${res.status}) — 비밀값 보호를 위해 내용은 출력하지 않습니다. Supabase 대시보드의 Database → Extensions에서 pg_cron·pg_net·Vault를 확인하세요.`);
}
console.log(remove ? "\nCron 작업을 해제했습니다." : "\nCron 작업을 등록했습니다. 내일 KST 09:00부터 실행됩니다. Vercel에도 같은 CRON_SECRET이 등록되어 있어야 합니다.");

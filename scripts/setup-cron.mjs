// 예약 점검 Cron 등록 스크립트 (R07, PLAN 31·32, SEC-09 + 홈페이지 모니터링 W08)
// 실행:
//   npm run setup:cron -- --app-url https://배포주소                    (미리 보기만: DB를 바꾸지 않음)
//   npm run setup:cron -- --app-url https://배포주소 --apply             (OpenAPI 예약 점검 작업 2개 등록)
//   npm run setup:cron -- --app-url https://배포주소 --web --apply       (위 2개 + 홈페이지 정시 점검 작업 등록)
//   npm run setup:cron -- --remove --apply                                (등록한 Cron 작업 전부 해제: OpenAPI + 웹)
//   npm run setup:cron -- --remove-web --apply                            (웹 작업만 해제, 기존 OpenAPI 점검은 그대로)
//
// 등록하는 것 (작업 목록은 scripts/lib/cron-jobs.mjs의 상수 배열)
//   1) 매일 KST 08:00(UTC 23:00, 전날): pg_net으로 POST {주소}/api/cron/daily-check  (Authorization: Bearer CRON_SECRET)
//   2) 매일 KST 08:30(UTC 23:30, 전날): public.mark_schedule_missed()  — 예약 누락 감지
//   3) (--web) 매시 :07: pg_net으로 POST {주소}/api/cron/web-check  — 홈페이지 정시 점검
// CRON_SECRET과 앱 주소는 Supabase Vault에 보관하고, Cron SQL은 Vault에서 읽는다. 마이그레이션·저장소·화면·로그에는 값을 남기지 않는다.
//
// ⚠ 이 스크립트는 운영 DB에 점검 일정을 만든다. --web이면 매시 :07에 앱이 실제 온비드 홈페이지에 GET 요청을 보내고 기록이 쌓인다.
//   Vercel에도 같은 CRON_SECRET이 등록되어 있고 /api/cron/web-check이 배포되어 있어야 한다. 웹 설정 web_monitor_enabled가 false이면 앱은 아무것도 하지 않는다.
//   (그래서 기본은 미리 보기이고, --apply를 붙여야만 바뀐다. --web을 붙이지 않으면 기존 동작과 같다)
import { buildRegisterStatements, buildRemoveStatements, jobsToRemove, maskText, selectedJobs } from "./lib/cron-jobs.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const removeWeb = args.includes("--remove-web");
const remove = args.includes("--remove") || removeWeb;
const removeScope = args.includes("--remove") ? "all" : "web";
const includeWeb = args.includes("--web");
const urlIndex = args.indexOf("--app-url");
const appUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const cronSecret = process.env.CRON_SECRET;

const fail = (message) => {
  console.error(`실패: ${message}`);
  process.exit(1);
};

if (remove && includeWeb) fail("--web은 등록할 때만 쓰고, 해제는 --remove 또는 --remove-web을 쓰세요.");
if (!ref || !token) fail(".env에 SUPABASE_PROJECT_REF·SUPABASE_ACCESS_TOKEN이 없습니다. (npm run check:env)");
if (!remove) {
  if (!cronSecret) fail(".env에 CRON_SECRET이 없습니다. (npm run setup:env)");
  if (!appUrl || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(appUrl)) fail("--app-url https://도메인 형식(경로 없이)으로 배포 주소를 알려 주세요.");
}

const statements = remove ? buildRemoveStatements({ scope: removeScope }) : buildRegisterStatements({ includeWeb, cronSecret, appUrl });

// 화면 출력용: 알려진 모든 비밀값(CRON_SECRET, 이후 추가될 텔레그램 값)과 주소를 가린다
const mask = (text) => maskText(text, { secrets: [cronSecret, process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID], appUrl });

const jobs = remove ? jobsToRemove({ scope: removeScope }) : selectedJobs({ includeWeb });
console.log(remove ? (removeScope === "all" ? "Cron 해제 계획 (전체)" : "Cron 해제 계획 (웹 작업만)") : `Cron 등록 계획 (${includeWeb ? "OpenAPI + 홈페이지 웹" : "OpenAPI만"})`);
for (const job of jobs) console.log(`- ${job.label} → ${job.schedule} (${job.name})`);
for (const s of statements) console.log(`  SQL> ${mask(s).split("\n")[0].slice(0, 150)}`);

if (!apply) {
  console.log("\n미리 보기입니다. DB는 바뀌지 않았습니다. 실제로 반영하려면 --apply를 붙여 다시 실행하세요.");
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
console.log(remove ? "\nCron 작업을 해제했습니다." : `\nCron 작업을 등록했습니다.${includeWeb ? " 다음 :07부터 홈페이지 점검이 실행됩니다." : " 내일 KST 08:00부터 실행됩니다."} Vercel에도 같은 CRON_SECRET이 등록되어 있어야 합니다.`);

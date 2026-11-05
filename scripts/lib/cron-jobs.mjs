// Cron 작업 목록·SQL 만들기·출력 가림 (R07 + 홈페이지 모니터링 W08)
// scripts/setup-cron.mjs가 쓰고, 단위 시험(tests/unit/cron-jobs.test.ts)이 가림·해제 범위를 확인한다. DB·네트워크에 접속하지 않는 순수 함수만 둔다.
import { SCHEDULED_RUN_UTC } from "./schedule-clock.mjs";

export const SECRET_NAME = "onbid_cron_secret";
export const URL_NAME = "onbid_app_url";

const { hour, minute } = SCHEDULED_RUN_UTC;
const missedMinute = (minute + 30) % 60; // 예정 + 30분 (설정값 기본 대기시간과 같다)
const missedHour = hour + Math.floor((minute + 30) / 60);

// 작업 목록은 모두 여기 상수 배열에서 관리한다.
//   group "openapi": 기존 OpenAPI 예약 점검 (기본으로 등록)   group "web": 홈페이지 모니터링 (--web을 붙여야 등록)
//   kind "post": pg_net으로 앱 경로에 POST   kind "sql": DB 함수를 직접 호출
export const CRON_JOBS = [
  { name: "onbid-daily-check", group: "openapi", kind: "post", schedule: `${minute} ${hour} * * *`, path: "/api/cron/daily-check", label: "예약 점검 호출: 매일 KST 08:00" },
  { name: "onbid-schedule-missed", group: "openapi", kind: "sql", schedule: `${missedMinute} ${missedHour} * * *`, sql: "select public.mark_schedule_missed()", label: "누락 감지: 매일 KST 08:30" },
  // 매시 :07 (UTC와 KST의 분이 같다). 정시 칸은 앱이 호출 시각에서 계산한다
  { name: "onbid-web-check", group: "web", kind: "post", schedule: "7 * * * *", path: "/api/cron/web-check", label: "홈페이지 정시 점검: 매시 :07" },
];

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`; // SQL 문자열 값

const postSql = (path) => `select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = ${lit(URL_NAME)}) || ${lit(path)},
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = ${lit(SECRET_NAME)})),
  body := '{}'::jsonb,
  timeout_milliseconds := 90000
)`;

// 선택한 범위의 작업: 웹을 포함하지 않으면 기존 작업만(기존 동작 불변)
export const selectedJobs = ({ includeWeb }) => CRON_JOBS.filter((job) => job.group === "openapi" || includeWeb);

// 해제 범위: all = 모든 작업(기존+웹), web = 웹 작업만
export const jobsToRemove = ({ scope }) => CRON_JOBS.filter((job) => scope === "all" || job.group === "web");

export function buildRemoveStatements({ scope }) {
  const names = jobsToRemove({ scope }).map((job) => lit(job.name)).join(", ");
  return [`select cron.unschedule(jobname) from cron.job where jobname in (${names})`];
}

export function buildRegisterStatements({ includeWeb, cronSecret, appUrl }) {
  return [
    `create extension if not exists pg_cron with schema pg_catalog`,
    `create extension if not exists pg_net with schema extensions`,
    // Vault 비밀값: 없으면 만들고, 있으면(방금 만든 것 포함) 값을 맞춘다. create_secret은 uuid, update_secret은 void를 돌려줘 한 case 문으로 합치면 타입 오류가 나므로 두 문장으로 나눈다
    `select vault.create_secret(${lit(cronSecret)}, ${lit(SECRET_NAME)}) where not exists (select 1 from vault.secrets where name = ${lit(SECRET_NAME)})`,
    `select vault.update_secret(id, ${lit(cronSecret)}) from vault.secrets where name = ${lit(SECRET_NAME)}`,
    `select vault.create_secret(${lit(appUrl)}, ${lit(URL_NAME)}) where not exists (select 1 from vault.secrets where name = ${lit(URL_NAME)})`,
    `select vault.update_secret(id, ${lit(appUrl)}) from vault.secrets where name = ${lit(URL_NAME)}`,
    ...selectedJobs({ includeWeb }).map((job) =>
      job.kind === "post" ? `select cron.schedule(${lit(job.name)}, ${lit(job.schedule)}, $job$${postSql(job.path)}$job$)` : `select cron.schedule(${lit(job.name)}, ${lit(job.schedule)}, ${lit(job.sql)})`,
    ),
  ];
}

// 화면 출력용: 알려진 모든 비밀값과 앱 주소를 가린다. 값이 비었거나 undefined인 것은 건너뛴다(빈 문자열로 바꾸면 전부 가려지므로)
// 긴 값부터 가려서, 어떤 비밀값이 다른 비밀값의 일부여도 남지 않게 한다
/**
 * @param {string} text
 * @param {{ secrets?: (string | null | undefined)[], appUrl?: string }} [options]
 */
export function maskText(text, { secrets = [], appUrl } = {}) {
  let out = String(text);
  const list = secrets.filter((s) => typeof s === "string" && s.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of list) out = out.replaceAll(secret, "****");
  if (typeof appUrl === "string" && appUrl.length > 0) out = out.replaceAll(appUrl, "(앱 주소)");
  return out;
}

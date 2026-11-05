// Cron 작업 목록·SQL·출력 가림 시험 (W08) — 순수 함수만, DB에 접속하지 않는다
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CRON_JOBS, buildRegisterStatements, buildRemoveStatements, jobsToRemove, maskText, selectedJobs } from "../../scripts/lib/cron-jobs.mjs";

const SECRET = "s3cret-VALUE-1234";
const URL = "https://my-app.example.vercel.app";

describe("작업 목록", () => {
  it("이름이 겹치지 않고 웹 작업은 매시 :07이다", () => {
    const names = CRON_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    const web = CRON_JOBS.filter((j) => j.group === "web");
    expect(web.map((j) => [j.name, j.schedule, j.path])).toEqual([["onbid-web-check", "7 * * * *", "/api/cron/web-check"]]);
  });

  it("기존 OpenAPI 작업은 그대로다 (매일 UTC 23:00 점검, 23:30 누락 감지)", () => {
    const old = CRON_JOBS.filter((j) => j.group === "openapi");
    expect(old.map((j) => [j.name, j.schedule])).toEqual([["onbid-daily-check", "0 23 * * *"], ["onbid-schedule-missed", "30 23 * * *"]]);
  });
});

describe("등록 범위", () => {
  const statements = (includeWeb: boolean) => buildRegisterStatements({ includeWeb, cronSecret: SECRET, appUrl: URL }).filter((s) => s.includes("cron.schedule"));

  it("--web이 없으면 기존 2개만 등록하고 웹 작업은 만들지 않는다", () => {
    const s = statements(false);
    expect(s).toHaveLength(2);
    expect(s.join("\n")).not.toContain("web-check");
  });

  it("--web이면 웹 작업이 더해지고 Vault에서 주소·비밀값을 읽는다(SQL에 값이 직접 들어가지 않는다)", () => {
    const s = statements(true);
    expect(s).toHaveLength(3);
    const web = s.find((x) => x.includes("onbid-web-check"))!;
    expect(web).toContain("'7 * * * *'");
    expect(web).toContain("'/api/cron/web-check'");
    expect(web).toContain("vault.decrypted_secrets");
    expect(web).not.toContain(SECRET);
    expect(web).not.toContain(URL);
  });

  it("작업 선택 함수도 같은 범위를 돌려준다", () => {
    expect(selectedJobs({ includeWeb: false }).map((j) => j.group)).toEqual(["openapi", "openapi"]);
    expect(selectedJobs({ includeWeb: true })).toHaveLength(3);
  });
});

describe("해제 범위", () => {
  it("--remove(all)는 기존+웹 전부, --remove-web(web)은 웹 작업 이름만 해제한다", () => {
    const all = buildRemoveStatements({ scope: "all" })[0];
    expect(all).toContain("onbid-daily-check");
    expect(all).toContain("onbid-schedule-missed");
    expect(all).toContain("onbid-web-check");
    const web = buildRemoveStatements({ scope: "web" })[0];
    expect(web).toContain("onbid-web-check");
    expect(web).not.toContain("onbid-daily-check");
    expect(web).not.toContain("onbid-schedule-missed");
    expect(jobsToRemove({ scope: "web" }).map((j) => j.group)).toEqual(["web"]);
  });
});

describe("출력 가림", () => {
  it("모든 비밀값과 앱 주소를 가린다 (여러 번 나와도, 하나가 다른 값의 일부여도)", () => {
    const text = `a ${SECRET} b ${SECRET} c ${URL}/x tg=123:ABC chat=-100999 short=ABC`;
    const out = maskText(text, { secrets: [SECRET, "123:ABC", "-100999"], appUrl: URL });
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(URL);
    expect(out).not.toContain("123:ABC");
    expect(out).not.toContain("-100999");
    expect(out).toContain("(앱 주소)/x");
    // 긴 값을 먼저 가려, 짧은 값이 긴 값의 일부여도 조각이 남지 않는다
    expect(maskText("token=123:ABC", { secrets: ["ABC", "123:ABC"] })).toBe("token=****");
  });

  it("값이 없거나 빈 문자열이면 건너뛴다(빈 값이 모든 글자를 가리지 않는다)", () => {
    expect(maskText("hello", { secrets: [undefined, "", null], appUrl: "" })).toBe("hello");
  });

  it("실제 스크립트의 미리 보기(--web, --dry)에도 비밀값·주소가 나타나지 않고 DB는 바뀌지 않는다", () => {
    const env = { ...process.env, SUPABASE_PROJECT_REF: "dummyref", SUPABASE_ACCESS_TOKEN: "dummy-token", CRON_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "999:TGTOKEN" };
    const run = spawnSync(process.execPath, ["scripts/setup-cron.mjs", "--app-url", URL, "--web"], { env, encoding: "utf8" });
    expect(run.status).toBe(0);
    const out = run.stdout + run.stderr;
    expect(out).toContain("미리 보기입니다");
    expect(out).toContain("onbid-web-check");
    for (const secret of [SECRET, URL, "999:TGTOKEN"]) expect(out).not.toContain(secret);
  });

  it("해제 미리 보기에서 --remove와 --web을 함께 쓰면 거부한다", () => {
    const env = { ...process.env, SUPABASE_PROJECT_REF: "dummyref", SUPABASE_ACCESS_TOKEN: "dummy-token", CRON_SECRET: SECRET };
    const run = spawnSync(process.execPath, ["scripts/setup-cron.mjs", "--remove", "--web"], { env, encoding: "utf8" });
    expect(run.status).toBe(1);
  });
});

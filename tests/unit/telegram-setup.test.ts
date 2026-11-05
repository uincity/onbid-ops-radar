// 텔레그램 비밀값 등록 스크립트 시험 (W12) — 미리 보기·입력 검사만 돌린다. Vault·Vercel·텔레그램에는 접속하지 않는다.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildVaultRemoveStatements, buildVaultStatements, buildVercelEnvEntries, maskTelegram, validateTelegramInputs, VAULT_CHAT_NAME, VAULT_TOKEN_NAME } from "../../scripts/lib/telegram-setup.mjs";

const TOKEN = "123456789:AAH-fake_token_value_for_tests_0123456";
const CHAT = "-1001234567890";
const URL = "https://my-app.example.vercel.app";

describe("입력 검사", () => {
  it("올바른 모양이면 통과한다 (그룹 채팅 ID는 음수)", () => {
    expect(validateTelegramInputs({ token: TOKEN, chatId: CHAT })).toEqual([]);
    expect(validateTelegramInputs({ token: TOKEN, chatId: "123456789" })).toEqual([]);
  });

  it("없거나 모양이 틀리면 막는다 — 값 자체는 오류 문구에 넣지 않는다", () => {
    expect(validateTelegramInputs({ token: undefined, chatId: undefined })).toHaveLength(2);
    const bad = validateTelegramInputs({ token: "not-a-token", chatId: "abc" });
    expect(bad).toHaveLength(2);
    expect(bad.join(" ")).not.toContain("not-a-token");
    expect(validateTelegramInputs({ token: "12:short", chatId: CHAT })).toHaveLength(1);
  });
});

describe("등록 문장", () => {
  it("Vault: 토큰·채팅 ID 모두 '없으면 만들고, 있으면 맞춘다' 두 문장씩", () => {
    const s = buildVaultStatements({ token: TOKEN, chatId: CHAT });
    expect(s).toHaveLength(4);
    expect(s.filter((x) => x.includes("create_secret"))).toHaveLength(2);
    expect(s.filter((x) => x.includes("update_secret"))).toHaveLength(2);
    expect(s.join("\n")).toContain(VAULT_TOKEN_NAME);
    expect(s.join("\n")).toContain(VAULT_CHAT_NAME);
  });

  it("해제 문장은 이 두 비밀값만 지운다", () => {
    const [sql] = buildVaultRemoveStatements();
    expect(sql).toContain(VAULT_TOKEN_NAME);
    expect(sql).toContain(VAULT_CHAT_NAME);
    expect(sql).not.toContain("onbid_cron_secret");
  });

  it("Vercel: 비밀값은 sensitive, 모드는 telegram, 앱 주소는 plain", () => {
    const e = buildVercelEnvEntries({ token: TOKEN, chatId: CHAT, appUrl: URL });
    expect(e.map((x) => [x.key, x.type])).toEqual([["TELEGRAM_BOT_TOKEN", "sensitive"], ["TELEGRAM_CHAT_ID", "sensitive"], ["WEB_NOTIFY_MODE", "plain"], ["APP_BASE_URL", "plain"]]);
    expect(e.find((x) => x.key === "WEB_NOTIFY_MODE")?.value).toBe("telegram");
    expect(e.some((x) => x.key.startsWith("NEXT_PUBLIC_"))).toBe(false); // 브라우저에 공개되는 이름을 쓰지 않는다
  });

  it("가림: 토큰·채팅 ID·앱 주소가 출력에 남지 않는다", () => {
    const text = buildVaultStatements({ token: TOKEN, chatId: CHAT }).join("\n") + ` url=${URL} ${TOKEN}`;
    const masked = maskTelegram(text, { token: TOKEN, chatId: CHAT, appUrl: URL });
    for (const secret of [TOKEN, CHAT, URL]) expect(masked).not.toContain(secret);
  });
});

describe("스크립트 실행 (네트워크 없는 경로만)", () => {
  const run = (argv: string[], env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, ["scripts/setup-telegram.mjs", ...argv], { env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
  const goodEnv = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, SUPABASE_PROJECT_REF: "dummyref", SUPABASE_ACCESS_TOKEN: "dummy-token", VERCEL_TOKEN: "dummy-vercel" };

  it("미리 보기: 비밀값과 주소가 출력에 없고, 아무것도 바꾸지 않았다고 알린다", () => {
    const r = run(["--app-url", URL], goodEnv);
    const out = r.stdout + r.stderr;
    expect(r.status).toBe(0);
    expect(out).toContain("미리 보기입니다");
    expect(out).toContain("onbid_telegram_token");
    expect(out).toContain("WEB_NOTIFY_MODE = telegram");
    for (const secret of [TOKEN, CHAT, URL, "dummy-token", "dummy-vercel"]) expect(out).not.toContain(secret);
  });

  it("--apply인데 앱 주소가 없으면 어디에도 접속하지 않고 멈춘다", () => {
    const r = run(["--apply"], goodEnv);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("--app-url");
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it("앱 주소에 경로가 있으면 거부한다", () => {
    expect(run(["--app-url", `${URL}/x`], goodEnv).status).toBe(1);
  });

  it("토큰이 없거나 모양이 틀리면 멈춘다 (값은 출력하지 않음)", () => {
    expect(run([], { ...goodEnv, TELEGRAM_BOT_TOKEN: undefined }).status).toBe(1);
    const r = run([], { ...goodEnv, TELEGRAM_BOT_TOKEN: "secret-but-wrong-shape" });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("secret-but-wrong-shape");
  });
});

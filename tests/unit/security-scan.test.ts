// 보안 검사 SEC-06(브라우저 코드·산출물의 비밀키 노출)·SEC-10(인증키·개인정보 금지정보)·공개 저장소 원칙 (R08, PRD 7-5·7-7, PLAN 34)
// 검사 대상: Git이 추적하는 모든 파일, 브라우저로 전달되는 빌드 산출물(.next/static)과 public/, DEMO 시나리오 데이터.
// ⚠ 이 시험은 발견한 비밀값을 출력하지 않는다. 어느 파일에서 어떤 종류가 나왔는지만 알린다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MAX_BYTES = 2_000_000;
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|json|md|sql|css|html|txt|yml|yaml|toml|example|env|gitignore|vercelignore)$/i;

const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 50_000_000 });
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const readText = (file: string): string | null => {
  const full = path.join(ROOT, file);
  if (!existsSync(full) || !statSync(full).isFile() || statSync(full).size > MAX_BYTES) return null;
  if (!TEXT_EXT.test(file) && path.basename(file).startsWith(".") === false) return null;
  return readFileSync(full, "utf8");
};

// .env의 비밀값 (파일이 없으면 값 검사는 건너뛰고 형태 검사만 한다). 짧은 값은 우연히 일치할 수 있어 8글자 이상만 본다
const SECRET_NAMES = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "DATA_GO_KR_SERVICE_KEY",
  "CRON_SECRET",
  "VERCEL_TOKEN",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "DEMO_ADMIN_PASSWORD",
  "DEMO_OPERATOR_PASSWORD",
];
function envSecrets(): { name: string; value: string }[] {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return [];
  const out: { name: string; value: string }[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || !SECRET_NAMES.includes(m[1])) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value.length >= 8) out.push({ name: m[1], value });
  }
  return out;
}
const secrets = envSecrets();

// 비밀값의 흔한 모양 (키 이름이 아니라 값의 생김새)
const SECRET_SHAPES: { kind: string; pattern: RegExp }[] = [
  { kind: "JWT 형태 토큰", pattern: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "Supabase 비밀 키(sb_secret_)", pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { kind: "Supabase 개인 액세스 토큰(sbp_)", pattern: /\bsbp_[A-Fa-f0-9]{20,}/ },
  { kind: "GitHub 토큰", pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { kind: "OpenAI 키(sk-)", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { kind: "개인키 블록", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // 주소에 인증키 값이 그대로 붙은 경우 (가려진 ***·자리표시자·변수는 제외)
  { kind: "주소에 붙은 serviceKey 값", pattern: /servicekey=(?![*%$\{<]|undefined|encoded|key\b|test|abc)[A-Za-z0-9%+/=_-]{24,}/i },
];

describe("SEC-06·SEC-10 Git 추적 파일의 비밀키 검사", () => {
  it(".env 파일과 비밀 파일은 Git이 추적하지 않는다 (.env.example만 허용)", () => {
    const bad = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
    expect(bad).toEqual([]);
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    for (const entry of [".env", "node_modules", ".next"]) expect(ignore, `.gitignore에 ${entry}`).toContain(entry);
  });

  it("추적 파일 어디에도 비밀값의 흔한 모양이 없다 (0건)", () => {
    const found: string[] = [];
    for (const file of tracked) {
      const text = readText(file);
      if (text === null) continue;
      for (const { kind, pattern } of SECRET_SHAPES) if (pattern.test(text)) found.push(`${file} — ${kind}`);
    }
    expect(found).toEqual([]);
  });

  it(".env에 있는 실제 비밀값이 추적 파일에 하나도 들어 있지 않다 (0건)", () => {
    if (secrets.length === 0) return; // .env가 없는 환경(예: 저장소만 받은 곳)에서는 형태 검사만으로 갈음
    const found: string[] = [];
    for (const file of tracked) {
      const text = readText(file);
      if (text === null) continue;
      for (const { name, value } of secrets) if (text.includes(value)) found.push(`${file} — ${name}`);
    }
    expect(found).toEqual([]);
  });

  it("서버 전용 값에는 NEXT_PUBLIC_ 이름을 붙이지 않는다", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const names = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    expect(names.filter((n) => n.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_KEY|TOKEN|PASSWORD|CRON/.test(n))).toEqual([]);
    // 코드에서도 NEXT_PUBLIC_이 붙은 비밀 이름을 쓰지 않는다
    const code = tracked.filter((f) => /\.(ts|tsx|mjs)$/.test(f)).map((f) => ({ f, t: readText(f) ?? "" }));
    expect(code.filter(({ t }) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_KEY|TOKEN|PASSWORD|CRON)/.test(t)).map(({ f }) => f)).toEqual([]);
  });
});

describe("SEC-06 브라우저 코드 경계", () => {
  const clientFiles = tracked.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("tests/") && !f.startsWith("trash-can/")).filter((f) => /^\s*["']use client["']/.test(readText(f)?.slice(0, 200) ?? ""));

  it("'use client' 파일이 서버 전용 모듈(관리용 키 연결·설정 읽기·점검 저장소)이나 비밀 환경변수를 쓰지 않는다", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
    const FORBIDDEN = [/@\/lib\/supabase\/admin/, /@\/lib\/settings\/load/, /@\/lib\/checks\/supabase-store/, /@\/lib\/reports\/generate/, /server-only/, /process\.env\.(?!NEXT_PUBLIC_)/];
    const bad = clientFiles.filter((f) => FORBIDDEN.some((re) => re.test(readText(f) ?? "")));
    expect(bad).toEqual([]);
  });

  it("서버 관리용 키를 쓰는 모듈은 server-only로 보호되어 있다", () => {
    for (const f of ["lib/supabase/admin.ts", "lib/settings/load.ts", "lib/reports/generate.ts"]) expect(readText(f), f).toContain('import "server-only"');
  });
});

describe("SEC-06 배포 산출물(브라우저로 전달되는 파일)", () => {
  const dirs = [".next/static", "public"].map((d) => path.join(ROOT, d)).filter((d) => existsSync(d));

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) yield* walk(full);
      else if (st.isFile() && st.size <= MAX_BYTES * 3 && /\.(js|css|html|json|txt|map)$/i.test(name)) yield full;
    }
  }

  it("빌드한 브라우저 파일(.next/static)과 public에 비밀값·비밀 키 모양이 없다 (0건) — 빌드가 없으면 건너뜀", () => {
    if (dirs.length === 0) return;
    const found: string[] = [];
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        const text = readFileSync(file, "utf8");
        for (const { name, value } of secrets) if (text.includes(value)) found.push(`${path.relative(ROOT, file)} — ${name}`);
        for (const { kind, pattern } of SECRET_SHAPES) {
          // 공개 가능한 키(publishable/anon)는 JWT 모양일 수 있어, Supabase 공개 키 값 자체는 허용한다
          if (kind === "JWT 형태 토큰") continue;
          if (pattern.test(text)) found.push(`${path.relative(ROOT, file)} — ${kind}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe("SEC-10 DEMO 데이터의 개인정보 (0건)", () => {
  it("DEMO 시나리오·시드 데이터에 주민등록번호·전화번호·이메일 모양이 없다", () => {
    const files = tracked.filter((f) => f.startsWith("data/demo/") || f.startsWith("scripts/lib/demo-"));
    expect(files.length).toBeGreaterThan(0);
    const PII: { kind: string; pattern: RegExp }[] = [
      { kind: "주민등록번호 모양", pattern: /\b\d{6}-[1-4]\d{6}\b/ },
      { kind: "휴대전화 번호 모양", pattern: /\b01[016789]-?\d{3,4}-?\d{4}\b/ },
      { kind: "이메일 주소 모양", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
    ];
    const found: string[] = [];
    for (const f of files) {
      const text = readText(f);
      if (text === null) continue;
      for (const { kind, pattern } of PII) if (pattern.test(text)) found.push(`${f} — ${kind}`);
    }
    expect(found).toEqual([]);
  });
});

describe("검사기 자체 확인 (양성 대조)", () => {
  // 시험용 가짜 값은 이 파일에 한 덩어리로 적혀 있으면 검사기가 이 파일을 잡으므로, 실행 중에 이어 붙여 만든다
  const fake = (...parts: string[]) => parts.join("");
  it("흔한 비밀값 모양을 실제로 잡아낸다", () => {
    const samples: Record<string, string> = {
      "JWT 형태 토큰": fake("ey", "Jhbgc1234567890abcd.", "payload12345678901234.", "signature1234567"),
      "Supabase 비밀 키(sb_secret_)": fake("sb_", "secret_", "abcdefghij1234567890"),
      "GitHub 토큰": fake("gh", "p_", "abcdefghijklmnopqrstuvwx"),
      "주소에 붙은 serviceKey 값": fake("service", "Key=", "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6"),
      "개인키 블록": fake("-----BEGIN ", "PRIVATE KEY-----"),
    };
    for (const [kind, sample] of Object.entries(samples)) {
      expect(SECRET_SHAPES.find((s) => s.kind === kind)?.pattern.test(sample), kind).toBe(true);
    }
  });
  it("가려진 키·자리표시자는 잡지 않는다 (오탐 방지)", () => {
    const serviceKey = SECRET_SHAPES.find((s) => s.kind === "주소에 붙은 serviceKey 값")!.pattern;
    expect(serviceKey.test("serviceKey=***")).toBe(false);
    expect(serviceKey.test("serviceKey=${encoded}")).toBe(false);
    expect(serviceKey.test("serviceKey=abc%2Fdef%3D%3D")).toBe(false);
  });
});

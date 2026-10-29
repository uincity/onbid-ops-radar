// 프로젝트에 설치된 Supabase CLI를 셸 없이 실행하는 도우미
// 셸을 거치지 않으므로 인자로 넘긴 비밀번호가 명령 기록이나 화면에 찍히지 않는다.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntry = path.join(rootDir, "node_modules", "supabase", "dist", "supabase.js");

export function runSupabase(args, { env = {}, timeout = 120_000 } = {}) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// 출력에 비밀 값이 섞여 있으면 **** 로 가린다
export function maskSecrets(text, secretNames) {
  let masked = text;
  for (const name of secretNames) {
    const value = process.env[name];
    if (value) masked = masked.split(value).join("****");
  }
  return masked;
}

export { rootDir };

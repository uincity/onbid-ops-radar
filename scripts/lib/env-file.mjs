// .env 파일에 변수를 안전하게 쓰는 도우미 (PLAN 작업 13)
// - 이미 있는 줄은 그 자리에서 값만 바꾸고, 없는 변수는 파일 끝에 설명과 함께 추가한다.
// - 다른 줄(주석, 직접 적어 둔 토큰 등)은 한 글자도 바꾸지 않는다.
// - 값은 어디에도 출력하지 않는다. (호출하는 쪽도 값을 출력하지 말 것)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./supabase-cli.mjs";

const envPath = path.join(rootDir, ".env");

// entries: [{ name, value, note }]  → 쓴 변수 이름 목록을 돌려준다
export function upsertEnvValues(entries) {
  const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = original === "" ? [] : original.split(/\r?\n/);
  // 파일 끝의 빈 줄은 정리해서 새 줄이 어색하게 떨어지지 않게 한다
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const written = [];
  for (const { name, value, note } of entries) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (index >= 0) {
      lines[index] = `${name}=${value}`;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== "" && note) lines.push("");
      if (note) lines.push(`# ${note}`);
      lines.push(`${name}=${value}`);
    }
    written.push(name);
  }
  writeFileSync(envPath, `${lines.join("\n")}\n`);
  return written;
}

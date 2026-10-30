// 보안 테스트 대응표(docs/security-matrix.md)가 12개를 모두 담고, 적힌 시험 파일이 실제로 있는지 확인한다 (R08, PRD 7-5)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(path.join(process.cwd(), "docs", "security-matrix.md"), "utf8");
const rows = [...text.matchAll(/^\| (SEC-\d{2}) \|[^\n]*\| ([^|\n]+) \|$/gm)].map((m) => ({ id: m[1], files: [...m[2].matchAll(/`([^`]+)`/g)].map((f) => f[1]) }));

describe("보안 테스트 대응표", () => {
  it("SEC-01~SEC-12가 빠짐없이, 한 번씩만 있다", () => {
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => `SEC-${String(i + 1).padStart(2, "0")}`));
  });
  it("모든 항목에 자동 시험이 하나 이상 있고, 적힌 파일이 실제로 있다", () => {
    for (const row of rows) {
      expect(row.files.length, row.id).toBeGreaterThan(0);
      for (const file of row.files) expect(existsSync(path.join(process.cwd(), file)), `${row.id}: ${file}`).toBe(true);
    }
  });
});

// 코드의 설정값 규칙과 DB(마이그레이션)의 규칙이 어긋나지 않는지 지켜보는 시험
// 설정값 규칙은 DB(settings 테이블의 CHECK 제약·기본값)와 코드(lib/settings/schema.ts) 두 곳에 있다.
// 한쪽만 고치면 "코드는 허용하는데 DB는 거부한다" 같은 어긋남이 생기므로, 마이그레이션 SQL을 직접 읽어 비교한다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTING_VALUES, INT_RANGES, PUBLIC_DAILY_BUDGET_RANGE, SETTING_KEYS } from "@/lib/settings/schema";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const file = readdirSync(migrationsDir).find((name) => name.endsWith("_create_reports_and_settings.sql"));
if (!file) throw new Error("settings를 만든 마이그레이션(…_create_reports_and_settings.sql)을 찾지 못했습니다.");
const sql = readFileSync(path.join(migrationsDir, file), "utf8");

describe("settings 마이그레이션과 lib/settings/schema.ts", () => {
  it("DB의 항목 이름 14개가 코드의 항목과 정확히 같다", () => {
    const block = /check\s*\(\s*key in \(([\s\S]*?)\)\s*\)/.exec(sql)?.[1] ?? "";
    const dbKeys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...dbKeys].sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("DB가 검사하는 숫자 범위가 코드의 범위와 같다", () => {
    const dbRanges = new Map<string, { min: number; max: number }>();
    for (const m of sql.matchAll(/when '([a-z_]+)' then[^\n]*?settings_int_between\(p_value,\s*(\d+),\s*(\d+)\)/g)) {
      dbRanges.set(m[1], { min: Number(m[2]), max: Number(m[3]) });
    }
    const codeRanges = new Map<string, { min: number; max: number }>([
      ...Object.entries(INT_RANGES),
      ["public_daily_budget", PUBLIC_DAILY_BUDGET_RANGE],
    ]);
    expect([...dbRanges.keys()].sort()).toEqual([...codeRanges.keys()].sort());
    for (const [key, range] of codeRanges) expect(dbRanges.get(key), key).toEqual(range);
  });

  it("DB에 들어 있는 기본값 14개가 코드의 기본값(PRD 5-5)과 같다", () => {
    const seeded: Record<string, unknown> = {};
    for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']*)'::jsonb\s*\)/g)) seeded[m[1]] = JSON.parse(m[2]);
    expect(Object.keys(seeded).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) expect(seeded[key], key).toEqual(DEFAULT_SETTING_VALUES[key]);
  });

  it("DB의 출처 허용 값이 코드와 같다 (DEMO, PUBLIC)", () => {
    expect(/in \('DEMO', 'PUBLIC'\)/.test(sql)).toBe(true);
  });
});

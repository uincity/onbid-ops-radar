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

// 처음 만든 뒤 마이그레이션이 항목 이름 목록·값 검사 함수를 다시 만들었다면 파일 이름 순서대로 가장 마지막 정의를 쓴다 (예: 항목을 더한 …_add_api_fail_streak_setting.sql)
const allSql = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort().map((n) => readFileSync(path.join(migrationsDir, n), "utf8"));
const lastWith = (needle: RegExp) => [...allSql].reverse().find((text) => needle.test(text)) ?? sql;
const keySql = lastWith(/constraint settings_key_check/);
const functionSql = lastWith(/create or replace function public\.settings_value_is_valid/);

describe("settings 마이그레이션과 lib/settings/schema.ts", () => {
  it("DB의 항목 이름 15개가 코드의 항목과 정확히 같다", () => {
    const block = /check\s*\(\s*key in \(([\s\S]*?)\)\s*\)/.exec(keySql)?.[1] ?? "";
    const dbKeys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...dbKeys].sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("DB가 검사하는 숫자 범위가 코드의 범위와 같다", () => {
    const dbRanges = new Map<string, { min: number; max: number }>();
    for (const m of functionSql.matchAll(/when '([a-z_]+)' then[^\n]*?settings_int_between\(p_value,\s*(\d+),\s*(\d+)\)/g)) {
      dbRanges.set(m[1], { min: Number(m[2]), max: Number(m[3]) });
    }
    const codeRanges = new Map<string, { min: number; max: number }>([
      ...Object.entries(INT_RANGES),
      ["public_daily_budget", PUBLIC_DAILY_BUDGET_RANGE],
    ]);
    expect([...dbRanges.keys()].sort()).toEqual([...codeRanges.keys()].sort());
    for (const [key, range] of codeRanges) expect(dbRanges.get(key), key).toEqual(range);
  });

  it("DB에 들어 있는 기본값 15개가 코드의 기본값(PRD 5-5)과 같다", () => {
    const seeded: Record<string, unknown> = {};
    for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']*)'::jsonb\s*\)/g)) seeded[m[1]] = JSON.parse(m[2]);
    // 처음 만든 뒤에 마이그레이션이 값을 고쳤다면(update public.settings set value = '…'::jsonb where key = '…') 파일 이름 순서대로 반영한다.
    // 예: PUBLIC 필드·일일 호출 예산을 정한 …_allow_public_fields_and_settings.sql
    for (const name of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
      if (name === file) continue;
      const later = readFileSync(path.join(migrationsDir, name), "utf8");
      // 나중에 항목을 새로 넣는 마이그레이션: insert into public.settings (key, value) values ('이름', '값'::jsonb);
      for (const m of later.matchAll(/insert into public\.settings \(key, value\) values \('([a-z_]+)',\s*'([^']*)'::jsonb\)/g)) seeded[m[1]] = JSON.parse(m[2]);
      for (const m of later.matchAll(/update public\.settings\s+set value = '([^']*)'::jsonb\s+where key = '([a-z_]+)'/g)) seeded[m[2]] = JSON.parse(m[1]);
    }
    expect(Object.keys(seeded).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) expect(seeded[key], key).toEqual(DEFAULT_SETTING_VALUES[key]);
  });

  it("DB의 출처 허용 값이 코드와 같다 (DEMO, PUBLIC)", () => {
    expect(/in \('DEMO', 'PUBLIC'\)/.test(sql)).toBe(true);
  });
});

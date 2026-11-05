// 웹 설정 규칙이 코드(lib/web-monitor/settings.ts)와 DB(마이그레이션)에서 어긋나지 않는지 지켜보는 시험
// 마이그레이션 SQL을 직접 읽어 비교한다. 기존 settings-drift.test.ts와 같은 방식이며 그 시험은 바꾸지 않는다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_SETTING_VALUES, WEB_INT_RANGES, WEB_SETTING_KEYS } from "@/lib/web-monitor/settings";

const dir = path.join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
const file = names.find((n) => n.endsWith("_create_web_settings.sql"));
if (!file) throw new Error("web_settings를 만든 마이그레이션(…_create_web_settings.sql)을 찾지 못했습니다.");
const sql = readFileSync(path.join(dir, file), "utf8");
const allSql = names.map((n) => readFileSync(path.join(dir, n), "utf8"));
const lastWith = (needle: RegExp) => [...allSql].reverse().find((t) => needle.test(t)) ?? sql;
const keySql = lastWith(/constraint web_settings_key_check/);
const functionSql = lastWith(/create or replace function public\.web_settings_value_is_valid/);

describe("web_settings 마이그레이션과 lib/web-monitor/settings.ts", () => {
  it("DB의 항목 이름 20개가 코드와 정확히 같다", () => {
    const block = /check\s*\(\s*key in \(([\s\S]*?)\)\s*\)/.exec(keySql)?.[1] ?? "";
    const dbKeys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...dbKeys].sort()).toEqual([...WEB_SETTING_KEYS].sort());
  });

  it("DB가 검사하는 숫자 범위가 코드와 같다", () => {
    const db = new Map<string, { min: number; max: number }>();
    for (const m of functionSql.matchAll(/when '([a-z_]+)' then public\.settings_int_between\(p_value,\s*(\d+),\s*(\d+)\)/g)) db.set(m[1], { min: Number(m[2]), max: Number(m[3]) });
    expect([...db.keys()].sort()).toEqual(Object.keys(WEB_INT_RANGES).sort());
    for (const [key, range] of Object.entries(WEB_INT_RANGES)) expect(db.get(key), key).toEqual(range);
  });

  it("web_monitor_enabled는 boolean만 허용한다고 DB에 적혀 있다", () => {
    expect(/when 'web_monitor_enabled' then jsonb_typeof\(p_value\) = 'boolean'/.test(functionSql)).toBe(true);
  });

  it("DB에 들어 있는 기본값 20개가 코드의 기본값과 같다", () => {
    const seeded: Record<string, unknown> = {};
    for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']*)'::jsonb\s*\)/g)) seeded[m[1]] = JSON.parse(m[2]);
    // 나중 마이그레이션이 값을 고쳤다면 파일 이름 순서대로 반영한다
    for (const name of names) {
      if (name === file) continue;
      const later = readFileSync(path.join(dir, name), "utf8");
      for (const m of later.matchAll(/update public\.web_settings\s+set value = '([^']*)'::jsonb\s+where key = '([a-z_]+)'/g)) seeded[m[2]] = JSON.parse(m[1]);
    }
    expect(Object.keys(seeded).sort()).toEqual([...WEB_SETTING_KEYS].sort());
    for (const key of WEB_SETTING_KEYS) expect(seeded[key], key).toEqual(DEFAULT_WEB_SETTING_VALUES[key]);
  });

  it("기존 settings 테이블·함수를 건드리지 않는다 (격리 원칙)", () => {
    expect(/(alter|drop)\s+table\s+public\.settings\b/i.test(sql)).toBe(false);
    expect(/insert\s+into\s+public\.settings\b/i.test(sql)).toBe(false);
    expect(/(create or replace|drop)\s+function\s+public\.settings_/i.test(sql)).toBe(false);
  });

  it("RLS가 켜져 있고 로그인 사용자 읽기 정책 외 쓰기 정책이 없다", () => {
    expect(sql).toContain("alter table public.web_settings enable row level security");
    expect(sql).toContain("grant select on public.web_settings to authenticated");
    expect(/create policy[\s\S]*?on public\.web_settings for (insert|update|delete|all)/i.test(sql)).toBe(false);
  });
});

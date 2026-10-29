// lib/settings/load.ts (DB에서 설정값 읽기) 단위 테스트 — 진짜 DB 대신 가짜 연결을 써서 성공·실패 경로를 채점한다
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// load.ts는 서버 전용 파일이라 "server-only"와 Next.js의 connection()을 시험용으로 대신한다
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

import { loadSettings } from "@/lib/settings/load";
import { DEFAULT_SETTINGS, DEFAULT_SETTING_VALUES, SETTING_KEYS, SettingsError } from "@/lib/settings/schema";

type Result = { data: { key: string; value: unknown }[] | null; error: { message: string } | null };

function fakeClient(result: Result) {
  const select = vi.fn(async () => result);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select };
}

const defaultRows = () => SETTING_KEYS.map((key) => ({ key, value: DEFAULT_SETTING_VALUES[key] }));

describe("loadSettings", () => {
  it("settings 테이블의 key·value만 읽어서 검증된 설정값으로 돌려준다", async () => {
    const { client, from, select } = fakeClient({ data: defaultRows(), error: null });
    await expect(loadSettings(client)).resolves.toEqual(DEFAULT_SETTINGS);
    expect(from).toHaveBeenCalledWith("settings");
    expect(select).toHaveBeenCalledWith("key, value");
  });

  it("DB가 오류를 돌려주면 SettingsError로 멈추고, DB의 오류 문구를 그대로 옮기지 않는다 (SEC-11)", async () => {
    const { client } = fakeClient({ data: null, error: { message: 'relation "internal.secret_table" does not exist' } });
    const error = await loadSettings(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettingsError);
    expect((error as SettingsError).message).toContain("설정값을 읽지 못했습니다");
    expect((error as SettingsError).message).not.toContain("secret_table");
  });

  it("줄이 하나도 없으면(권한 문제 등) 몰래 기본값으로 대신하지 않고 오류로 멈춘다", async () => {
    const { client } = fakeClient({ data: [], error: null });
    const error = await loadSettings(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettingsError);
    expect((error as SettingsError).problems).toHaveLength(14);
  });

  it("규칙에 어긋난 값이 들어 있으면 SettingsError로 멈춘다", async () => {
    const rows = defaultRows().map((r) => (r.key === "api_timeout_seconds" ? { ...r, value: 9999 } : r));
    const { client } = fakeClient({ data: rows, error: null });
    await expect(loadSettings(client)).rejects.toBeInstanceOf(SettingsError);
  });

  it("data가 null이어도(오류도 없을 때) 안전하게 오류로 멈춘다", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(loadSettings(client)).rejects.toBeInstanceOf(SettingsError);
  });
});

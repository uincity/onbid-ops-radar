// DEMO 시나리오 주입·확인 스크립트가 함께 쓰는 도우미 (PLAN 작업 17)
// 주입한 데이터는 "점검 실행 1건(check_runs) + 표식 메모(run_logs, 코드 DEMO_SEED) + 수집 데이터(collected_items)"로 이루어진다.
// 표식 메모가 있는 점검 실행이 "시연용으로 주입한 실행"이다. 다시 주입하거나 지울 때 이 실행만 정확히 찾아서 다룬다.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./supabase-cli.mjs";

export const SEED_LOG_CODE = "DEMO_SEED";
// 주입한 실행의 시각 배치: 실행 시작 → 30분 뒤 목록 수집 → 60분 뒤 실행 종료. (상세는 목록 수집 시각에서 시나리오별로 ±초만큼 떨어진다)
export const LIST_COLLECTED_AFTER_START_MS = 30 * 60_000;
export const RUN_LENGTH_MS = 60 * 60_000;

export function loadScenarioFile() {
  return JSON.parse(readFileSync(path.join(rootDir, "data", "demo", "scenarios.json"), "utf8"));
}

export function createAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.error("실패: .env에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY가 없습니다. (npm run setup:env)");
    process.exit(1);
  }
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function fail(message, error) {
  console.error(`실패: ${message}${error?.message ? ` (${error.message})` : ""}`);
  process.exit(1);
}

// 이전에 주입한 실행의 번호들
export async function findSeedRunIds(admin) {
  const { data, error } = await admin.from("run_logs").select("run_id").eq("code", SEED_LOG_CODE);
  if (error) fail("이전에 주입한 데이터를 찾지 못했습니다.", error);
  return [...new Set((data ?? []).map((row) => row.run_id).filter((id) => id !== null))];
}

// 이전에 주입한 데이터를 지운다. 순서가 중요하다: 수집 데이터 → 메모 → 점검 실행 (뒤의 것이 앞의 것을 가리키므로)
export async function removeSeed(admin, runIds) {
  if (runIds.length === 0) return { runs: 0, items: 0 };
  const items = await admin.from("collected_items").delete({ count: "exact" }).in("run_id", runIds);
  if (items.error) fail("수집 데이터를 지우지 못했습니다.", items.error);
  const logs = await admin.from("run_logs").delete().in("run_id", runIds);
  if (logs.error) fail("주입 표식을 지우지 못했습니다.", logs.error);
  const runs = await admin.from("check_runs").delete({ count: "exact" }).in("id", runIds);
  if (runs.error) fail("점검 실행을 지우지 못했습니다.", runs.error);
  return { runs: runs.count ?? 0, items: items.count ?? 0 };
}

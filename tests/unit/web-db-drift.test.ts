// 웹 점검 판정의 이름들(판정 6가지·사유·층)이 코드(lib/web-monitor/classify.ts)와 DB(마이그레이션)에서 어긋나지 않는지 지켜보는 시험
// 한쪽만 고치면 "코드는 만들어 내는데 DB가 거부한다" 같은 어긋남이 생기므로 마이그레이션 SQL을 직접 읽어 비교한다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_LAYERS, WEB_REASONS, WEB_VERDICTS } from "@/lib/web-monitor/classify";

const dir = path.join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
const file = names.find((n) => n.endsWith("_create_web_check_tables.sql"));
if (!file) throw new Error("웹 점검 테이블을 만든 마이그레이션(…_create_web_check_tables.sql)을 찾지 못했습니다.");
const sql = readFileSync(path.join(dir, file), "utf8");

// constraint <이름> check (...) 블록 안의 작은따옴표 낱말들
function listOf(constraint: string): string[] {
  const start = sql.indexOf(`constraint ${constraint}`);
  if (start < 0) throw new Error(`제약 ${constraint}를 찾지 못했습니다.`);
  const end = sql.indexOf("constraint ", start + 10);
  const block = sql.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

describe("웹 점검 마이그레이션과 lib/web-monitor/classify.ts", () => {
  it("판정 6가지가 코드와 같다 (실행·프로브·대상 상태 세 곳 모두)", () => {
    for (const c of ["web_check_runs_overall_verdict_check", "web_check_runs_confirmed_verdict_check", "web_probe_results_verdict_check", "web_target_state_verdict_check"]) {
      expect([...listOf(c)].sort(), c).toEqual([...WEB_VERDICTS].sort());
    }
  });

  it("DB의 닫힌 사유 22개가 코드의 사유와 정확히 같다", () => {
    expect([...listOf("web_probe_results_reason_check")].sort()).toEqual([...WEB_REASONS].sort());
    expect(WEB_REASONS).toHaveLength(22);
  });

  it("DB의 층 이름이 코드와 같다", () => {
    expect([...listOf("web_probe_results_layer_check")].sort()).toEqual([...WEB_LAYERS].sort());
  });

  it("미점검(NOT_RUN)의 허용 사유는 코드가 실제로 쓰는 두 가지다", () => {
    expect(listOf("web_probe_results_not_run_reason_check").sort()).toEqual(["BUDGET_SKIP", "NOT_RUN", "UPSTREAM_FAILED"].sort());
  });

  it("점검 종류와 상태가 설계서와 같다", () => {
    expect(/"trigger" in \('scheduled', 'retry', 'manual'\)/.test(sql)).toBe(true);
    expect(/status in \('running', 'succeeded', 'partial', 'failed', 'blocked'\)/.test(sql)).toBe(true);
    expect(/kind in \('confirm', 'replace'\)/.test(sql)).toBe(true);
    expect(/status in \('pending', 'claimed', 'done', 'cancelled'\)/.test(sql)).toBe(true);
  });

  it("기존 테이블·함수를 바꾸지 않는다 (격리 원칙)", () => {
    expect(/(alter|drop)\s+table\s+public\.(settings|check_runs|probe_results|api_checks|run_logs|anomalies|anomaly_events|collected_items|reports|profiles)\b/i.test(sql)).toBe(false);
    expect(/(create or replace|drop)\s+function\s+public\.(start_check_run|record_detection|settings_)/i.test(sql)).toBe(false);
  });

  it("모든 새 테이블에 RLS가 켜지고 쓰기 정책이 없다", () => {
    for (const t of ["web_check_runs", "web_probe_results", "web_target_state", "web_retry_queue"]) {
      expect(sql, t).toContain(`alter table public.${t} enable row level security`);
    }
    expect(/create policy[\s\S]*?on public\.web_\w+ for (insert|update|delete|all)/i.test(sql)).toBe(false);
    expect(sql).toContain("grant select on public.web_check_runs, public.web_probe_results, public.web_target_state, public.web_retry_queue to authenticated");
  });

  it("두 함수는 서버 관리용 키에게만 열려 있다", () => {
    expect(sql).toMatch(/revoke all on function public\.start_web_check_run\([^)]*\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.start_web_check_run\([^)]*\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.finish_web_check_run\([^)]*\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.finish_web_check_run\([^)]*\) to service_role/);
  });
});

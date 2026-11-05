// 코드의 상수와 DB(마이그레이션)의 허용 목록이 어긋나지 않는지 지켜보는 시험 (R03)
// 규칙 ID·점검 상태·세부 사유는 DB의 CHECK 제약과 코드(lib/anomalies/labels.ts, lib/checks/probe/status.ts) 두 곳에 있다.
// 한쪽만 고치면 "코드는 만드는데 DB는 거부한다" 같은 어긋남이 생기므로 마이그레이션 SQL을 직접 읽어 비교한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_RULE_IDS, API_RULE_IDS, DQ_RULE_IDS, REPORT_RULE_IDS, RULE_IDS, RULE_LABEL, SOURCES, WEB_RULE_IDS } from "@/lib/anomalies/labels";
import { DEGRADED_REASONS, FAIL_CODES, NOT_RUN_REASONS, PROBE_STATUSES, UNVERIFIED_REASONS } from "@/lib/checks/probe/status";

const migrations = path.join(process.cwd(), "supabase", "migrations");
const sql = readFileSync(path.join(migrations, "20261029060000_create_probe_results.sql"), "utf8");
// 상태·사유 짝 제약은 보완 마이그레이션(사유가 비어 있는 경우를 막음)에서 다시 만들었으므로 마지막 정의를 본다
const fixSql = readFileSync(path.join(migrations, "20261029060100_fix_probe_results_reason_check.sql"), "utf8");
// 규칙 ID·출처 허용 목록은 홈페이지 모니터링 마이그레이션(W10a)에서 다시 만들었으므로 마지막 정의를 본다
const webSql = readFileSync(path.join(migrations, "20261105120000_create_web_notifications_and_transition.sql"), "utf8");
const quoted = (text: string) => [...text.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);

describe("anomalies 허용 규칙 ID: 마이그레이션 ↔ labels.ts", () => {
  const block = /alter table public\.anomalies add constraint anomalies_rule_id_check\s+check \(rule_id in \(([\s\S]*?)\)\);/.exec(webSql)?.[1] ?? "";

  it("DB의 허용 목록 17개가 코드의 ALL_RULE_IDS와 같다", () => {
    const dbIds = quoted(block.replace(/--[^\n]*/g, ""));
    expect([...dbIds].sort()).toEqual([...ALL_RULE_IDS].sort());
    expect(dbIds).toHaveLength(17);
  });

  it("홈페이지 규칙 2개가 있고, 보고서 규칙 목록(15개)에는 들어가지 않는다", () => {
    expect([...WEB_RULE_IDS]).toEqual(["WEB_AVAILABILITY", "WEB_FRESHNESS"]);
    expect(REPORT_RULE_IDS).toHaveLength(15);
    for (const id of WEB_RULE_IDS) expect(REPORT_RULE_IDS).not.toContain(id);
  });

  it("anomalies 출처 허용 값(DEMO·PUBLIC·WEB)이 코드의 SOURCES와 같다", () => {
    const m = /add constraint anomalies_source_check\s+check \(source in \(([^)]*)\)\)/.exec(webSql)?.[1] ?? "";
    expect(quoted(m)).toEqual([...SOURCES]);
  });

  it("이전 규칙 4개는 그대로이고, 새 규칙 ID는 DQ 4개 + API 7개다", () => {
    expect([...RULE_IDS]).toEqual(["DATE_ORDER", "REQUIRED_FIELD", "LIST_DETAIL_MISMATCH", "EMPTY_RESULT"]);
    expect(DQ_RULE_IDS).toHaveLength(4);
    expect(API_RULE_IDS).toHaveLength(7);
  });

  it("API 규칙 ID는 점검 판정의 FAIL 세부 코드 앞에 API_를 붙인 것과 같다 (7개 모두)", () => {
    expect([...API_RULE_IDS].sort()).toEqual(FAIL_CODES.map((c) => `API_${c}`).sort());
  });

  it("모든 규칙 ID에 한국어 표시 이름이 있다 (화면에 원문 ID가 노출되지 않는다)", () => {
    for (const id of ALL_RULE_IDS) expect(RULE_LABEL[id], id).toBeTruthy();
    expect(Object.keys(RULE_LABEL).sort()).toEqual([...ALL_RULE_IDS].sort());
  });
});

describe("probe_results 상태·사유: 마이그레이션 ↔ status.ts", () => {
  const status = /constraint probe_results_status_check\s+check \(status in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
  const pairing = /add constraint probe_results_status_reason_check([\s\S]*)$/.exec(fixSql)?.[1] ?? "";
  const reasonsOf = (statusName: string) => {
    const m = new RegExp(`status = '${statusName}' and [a-z ]*reason in \\(([^)]*)\\)`).exec(pairing);
    return m ? quoted(m[1]) : [];
  };

  it("상태 6종이 같다", () => {
    expect(quoted(status)).toEqual([...PROBE_STATUSES]);
  });

  it("FAIL 세부 코드 7개가 같다", () => {
    expect(reasonsOf("FAIL").sort()).toEqual([...FAIL_CODES].sort());
  });

  it("UNVERIFIED 사유 7개가 같다", () => {
    expect(reasonsOf("UNVERIFIED").sort()).toEqual([...UNVERIFIED_REASONS].sort());
  });

  it("NOT_RUN 사유 5개가 같다", () => {
    expect(reasonsOf("NOT_RUN").sort()).toEqual([...NOT_RUN_REASONS].sort());
  });

  it("DEGRADED 사유 3개가 같다", () => {
    expect(reasonsOf("DEGRADED").sort()).toEqual([...DEGRADED_REASONS].sort());
  });

  it("사유가 필요한 상태는 사유가 NULL인 경우도 막는다 (SQL의 `in`은 NULL을 통과시키므로 `is not null`을 함께 쓴다)", () => {
    for (const name of ["DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"]) {
      expect(pairing, name).toMatch(new RegExp(`status = '${name}' and [a-z ]*reason is not null and reason in`));
    }
  });

  it("PASS_DATA·PASS_NO_DATA는 사유가 없고 요청을 보낸 것으로만 기록된다", () => {
    expect(pairing).toMatch(/status in \('PASS_DATA', 'PASS_NO_DATA'\) and attempted and reason is null/);
  });
});

describe("보존형 마이그레이션 (PRD D-1): 지우거나 초기화하는 문장이 없다", () => {
  const code = [sql, fixSql].map((text) => text.replace(/--[^\n]*/g, "")).join("\n");

  it("테이블·행·이력을 지우는 문장이 없다 (drop table·truncate·delete from·drop column 금지)", () => {
    expect(code).not.toMatch(/drop\s+table|truncate|delete\s+from|drop\s+column/i);
  });

  it("지우는 것은 제약 두 개뿐이고, 둘 다 같은 문장 묶음에서 더 엄격하거나 더 넓은 정의로 다시 만든다", () => {
    const drops = [...code.matchAll(/drop\s+constraint\s+(\w+)/gi)].map((m) => m[1]);
    expect(drops).toEqual(["anomalies_rule_id_check", "probe_results_status_reason_check"]);
    for (const name of drops) expect(code, name).toMatch(new RegExp(`add constraint ${name}`));
  });

  it("api_checks에 더하는 칸은 모두 비워 둘 수 있다 (not null 없음) → 이전 행이 그대로 통과한다", () => {
    const block = /alter table public\.api_checks\s+add column([\s\S]*?);/.exec(code)?.[1] ?? "";
    expect(block).toContain("api_id");
    expect(block).not.toMatch(/not null/i);
  });
});

describe("화면용 규칙 목록 (W14)", () => {
  it("대시보드 목록은 전체에서 아직 쓰지 않는 WEB_FRESHNESS만 뺀 16개다", async () => {
    const { DASHBOARD_RULE_IDS } = await import("@/lib/anomalies/labels");
    expect(DASHBOARD_RULE_IDS).toHaveLength(16);
    expect(DASHBOARD_RULE_IDS).toContain("WEB_AVAILABILITY");
    expect(DASHBOARD_RULE_IDS).not.toContain("WEB_FRESHNESS");
  });
});

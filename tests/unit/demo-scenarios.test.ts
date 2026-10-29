// DEMO 시나리오 160건 자체를 검증하는 시험 (PLAN 작업 17)
// 가장 중요한 시험: "기대 결과(expected)가 맞게 적혀 있는가". 탐지 규칙(PLAN 18~20번)은 아직 없으므로,
// 이 파일 안에 PRD 5-2의 규칙 설명만 보고 따로 만든 아주 단순한 "기준 채점기"를 두고 160건의 정답 표시가 그것과 일치하는지 본다.
// 나중에 진짜 탐지 규칙이 만들어지면 같은 160건으로 채점한다. 정답 표시가 틀렸다면 규칙이 아니라 데이터를 먼저 고쳐야 한다.
import { describe, expect, it } from "vitest";
import { COMPARE_WINDOW_SECONDS, buildScenarioFile } from "../../scripts/lib/demo-scenarios.mjs";
import { DEMO_SCENARIOS, DEMO_SCENARIO_FILE, scenariosOf } from "@/lib/demo/scenarios";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";
import type { DemoFields, DemoListDetailOutcome, DemoRuleId, DemoScenario } from "@/lib/demo/types";

// ---------------------------------------------------------------- 기준 채점기 (PRD 5-2 규칙 1~3을 그대로 옮긴 것)
const REQUIRED = ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"] as const;
const COMPARE = ["item_name", "org_name", "bid_start_at", "bid_end_at"] as const;
const DATE_FIELDS = new Set<string>(["bid_start_at", "bid_end_at"]);
const STATUSES = ["ready", "bidding", "closed"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// 올바른 ISO 8601(시간대 포함) 날짜·시각이면 그 순간(ms)을, 아니면 null
function instantOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = ISO.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // 2026-02-30 같은 날짜
  let offsetMs = 0;
  if (m[8] !== "Z") {
    const sign = m[8][0] === "-" ? -1 : 1;
    const [oh, om] = [Number(m[8].slice(1, 3)), Number(m[8].slice(4, 6))];
    if (oh > 23 || om > 59) return null;
    offsetMs = sign * (oh * 3600_000 + om * 60_000);
  }
  const fraction = m[7] ? Number(`0${m[7]}`) * 1000 : 0;
  return Date.UTC(year, month - 1, day, hour, minute, second) + fraction - offsetMs;
}

const isBlankOrMissing = (v: unknown) => typeof v !== "string" || v.trim() === "";

function hasRequiredProblem(f: DemoFields): boolean {
  for (const key of REQUIRED) {
    const value = f[key];
    if (isBlankOrMissing(value)) return true;
    if (DATE_FIELDS.has(key) && instantOf(value) === null) return true; // 형식 오류
  }
  if (!/^DEMO-\d{4}$/.test(String(f.demo_item_id))) return true;
  if (f.item_status !== undefined && !STATUSES.includes(f.item_status as string)) return true; // 선택이지만 있으면 허용된 값이어야 함
  return false;
}

function hasDateOrderProblem(f: DemoFields): boolean {
  const start = instantOf(f.bid_start_at);
  const end = instantOf(f.bid_end_at);
  return start !== null && end !== null && end < start; // 더 빠를 때만. 같으면 정상
}

function sameValue(key: string, a: unknown, b: unknown): boolean {
  if (DATE_FIELDS.has(key)) {
    const [x, y] = [instantOf(a), instantOf(b)];
    if (x !== null && y !== null) return x === y; // 같은 순간이면 표기가 달라도 같다
  }
  return a === b;
}

function evaluate(s: DemoScenario): { rules: DemoRuleId[]; listDetail: DemoListDetailOutcome } {
  const rules = new Set<DemoRuleId>();
  for (const record of [s.list, s.detail]) {
    if (!record) continue;
    if (hasRequiredProblem(record)) rules.add("REQUIRED_FIELD");
    if (hasDateOrderProblem(record)) rules.add("DATE_ORDER");
  }
  let listDetail: DemoListDetailOutcome;
  if (!s.list || !s.detail) {
    listDetail = "skipped:NO_COUNTERPART";
  } else if (Math.abs(s.detailOffsetSeconds) > COMPARE_WINDOW_SECONDS) {
    listDetail = "skipped:WINDOW_EXCEEDED";
  } else {
    listDetail = "compared";
    if (COMPARE.some((key) => !sameValue(key, s.list![key], s.detail![key]))) rules.add("LIST_DETAIL_MISMATCH");
  }
  return { rules: [...rules].sort(), listDetail };
}

// ---------------------------------------------------------------- 시험
describe("시나리오 파일의 구성", () => {
  it("모두 160건: 정상 100 · 이상 30 · 경계 30", () => {
    expect(DEMO_SCENARIOS).toHaveLength(160);
    expect(scenariosOf("normal")).toHaveLength(100);
    expect(scenariosOf("anomaly")).toHaveLength(30);
    expect(scenariosOf("boundary")).toHaveLength(30);
  });

  it("이상 30건은 규칙마다 10건씩이고, 한 건에는 그 규칙 하나만 있다", () => {
    for (const rule of ["DATE_ORDER", "REQUIRED_FIELD", "LIST_DETAIL_MISMATCH"] as const) {
      const cases = scenariosOf("anomaly").filter((s) => s.category === rule);
      expect(cases, rule).toHaveLength(10);
      for (const s of cases) expect(s.expected.rules, s.id).toEqual([rule]);
    }
  });

  it("번호는 DEMO-0001부터 0160까지 빠짐없이 이어지고, 물건 식별값(demo_item_id)과 같다", () => {
    DEMO_SCENARIOS.forEach((s, index) => {
      const id = `DEMO-${String(index + 1).padStart(4, "0")}`;
      expect(s.id).toBe(id);
      for (const record of [s.list, s.detail]) if (record) expect(record.demo_item_id).toBe(id);
    });
  });

  it("그룹별 번호 범위: 정상 1~100, 이상 101~130, 경계 131~160", () => {
    const range = (group: DemoScenario["group"]) => {
      const ids = scenariosOf(group).map((s) => Number(s.id.slice(5)));
      return [Math.min(...ids), Math.max(...ids)];
    };
    expect(range("normal")).toEqual([1, 100]);
    expect(range("anomaly")).toEqual([101, 130]);
    expect(range("boundary")).toEqual([131, 160]);
  });

  it("모든 시나리오에 제목이 있고, 제목은 서로 겹치지 않는다", () => {
    const titles = DEMO_SCENARIOS.map((s) => s.title);
    expect(titles.every((t) => t.length > 5)).toBe(true);
    // 정상 100건은 같은 문장 몇 가지를 반복해도 되지만, 이상·경계 60건은 무엇을 시험하는지 모두 달라야 한다
    const special = DEMO_SCENARIOS.filter((s) => s.group !== "normal").map((s) => s.title);
    expect(new Set(special).size).toBe(60);
  });

  it("정상·이상 시나리오는 목록과 상세가 모두 있고 수집 시각 차이가 10분 이내다", () => {
    for (const s of DEMO_SCENARIOS.filter((x) => x.group !== "boundary")) {
      expect(s.list, s.id).not.toBeNull();
      expect(s.detail, s.id).not.toBeNull();
      expect(Math.abs(s.detailOffsetSeconds), s.id).toBeLessThanOrEqual(COMPARE_WINDOW_SECONDS);
    }
  });
});

describe("기대 결과(expected)가 맞게 적혀 있는가 — 기준 채점기와 160건 모두 일치", () => {
  for (const group of ["normal", "anomaly", "boundary"] as const) {
    it(`${group}: 기준 채점기의 결과와 정답 표시가 모두 같다`, () => {
      const wrong = scenariosOf(group)
        .map((s) => ({ s, got: evaluate(s) }))
        .filter(({ s, got }) => JSON.stringify(got.rules) !== JSON.stringify([...s.expected.rules].sort()) || got.listDetail !== s.expected.listDetail)
        .map(({ s, got }) => `${s.id} ${s.title} → 채점기 ${JSON.stringify(got)} / 정답표시 ${JSON.stringify(s.expected)}`);
      expect(wrong).toEqual([]);
    });
  }

  it("정상 100건에서는 어떤 규칙도 걸리지 않는다 (오탐 0건)", () => {
    for (const s of scenariosOf("normal")) {
      expect(evaluate(s).rules, s.id).toEqual([]);
      expect(s.expected.rules, s.id).toEqual([]);
    }
  });

  it("경계 30건 중 이상으로 표시된 것과 정상으로 표시된 것이 모두 있다 (한쪽으로 치우치지 않음)", () => {
    const boundary = scenariosOf("boundary");
    expect(boundary.filter((s) => s.expected.rules.length > 0).length).toBeGreaterThanOrEqual(10);
    expect(boundary.filter((s) => s.expected.rules.length === 0).length).toBeGreaterThanOrEqual(10);
    expect(boundary.some((s) => s.expected.listDetail === "skipped:WINDOW_EXCEEDED")).toBe(true);
    expect(boundary.some((s) => s.expected.listDetail === "skipped:NO_COUNTERPART")).toBe(true);
  });

  it("목록·상세 수집 시각 차이의 경계: 599·600초는 비교하고 601초는 제외한다 (설정값 10분 = 600초와 같다)", () => {
    expect(DEMO_SCENARIO_FILE.compareWindowSeconds).toBe(DEFAULT_SETTINGS.compareWindowMinutes * 60);
    const byOffset = (seconds: number) => scenariosOf("boundary").filter((s) => Math.abs(s.detailOffsetSeconds) === seconds && s.list && s.detail);
    for (const s of [...byOffset(599), ...byOffset(600)]) expect(s.expected.listDetail, s.id).toBe("compared");
    for (const s of byOffset(601)) expect(s.expected.listDetail, s.id).toBe("skipped:WINDOW_EXCEEDED");
    expect(byOffset(600).length).toBeGreaterThanOrEqual(2); // 목록이 먼저 / 상세가 먼저
    expect(byOffset(601).length).toBeGreaterThanOrEqual(3);
  });
});

describe("DB에 넣을 수 있는 모양인가 (collected_items 제약과 같은 기준)", () => {
  const ALLOWED = new Set(["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at", "item_status"]);

  it("필드 이름은 부록 B의 6개뿐이다 (그 밖의 이름은 DB가 거부한다)", () => {
    for (const s of DEMO_SCENARIOS)
      for (const record of [s.list, s.detail])
        if (record) for (const key of Object.keys(record)) expect(ALLOWED.has(key), `${s.id}.${key}`).toBe(true);
  });

  it("필드 묶음은 10,000바이트를 넘지 않는다 (DB 제약)", () => {
    for (const s of DEMO_SCENARIOS)
      for (const record of [s.list, s.detail]) if (record) expect(Buffer.byteLength(JSON.stringify(record), "utf8"), s.id).toBeLessThanOrEqual(10_000);
  });

  it("개인정보로 보이는 값(이메일·전화번호·주민등록번호 모양)이 없다 (PRD 7-2)", () => {
    const text = JSON.stringify(DEMO_SCENARIOS.map((s) => [s.list, s.detail]));
    expect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)).toBe(false); // 이메일
    expect(/\b0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}\b/.test(text)).toBe(false); // 전화번호
    expect(/\b\d{6}[- ]?[1-4]\d{6}\b/.test(text)).toBe(false); // 주민등록번호
  });

  it("목록·상세 행 수는 318개다 (320개에서 목록 또는 상세가 없는 2건 제외)", () => {
    const rows = DEMO_SCENARIOS.reduce((sum, s) => sum + (s.list ? 1 : 0) + (s.detail ? 1 : 0), 0);
    expect(rows).toBe(318);
  });
});

describe("데이터 파일과 생성기가 같은가", () => {
  it("data/demo/scenarios.json은 생성기(scripts/lib/demo-scenarios.mjs)가 지금 만드는 결과와 같다 (손으로 고치거나 생성기만 고친 경우를 잡는다)", () => {
    expect(JSON.parse(JSON.stringify(buildScenarioFile()))).toEqual(DEMO_SCENARIO_FILE);
  });

  it("생성기는 언제 돌려도 같은 결과를 낸다", () => {
    expect(JSON.stringify(buildScenarioFile())).toBe(JSON.stringify(buildScenarioFile()));
  });
});

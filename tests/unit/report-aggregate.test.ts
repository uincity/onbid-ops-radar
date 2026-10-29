// 일일 점검보고서 집계 시험 (PLAN 30번, PRD 5-4): KST 하루 경계, 빈 날, 미처리 50건 경계, 평균 응답시간, 출처 구분
import { describe, expect, it } from "vitest";
import { aggregateReport, type AggregateInput } from "@/lib/reports/aggregate";
import { UNRESOLVED_LIMIT, parseReportModel, reportFileName } from "@/lib/reports/model";

const DATE = "2026-10-29";
// KST 2026-10-29 00:00 = UTC 2026-10-28 15:00, KST 다음 날 00:00 = UTC 2026-10-29 15:00
const START = "2026-10-28T15:00:00.000Z";
const END = "2026-10-29T15:00:00.000Z";
const JUST_BEFORE_START = "2026-10-28T14:59:59.999Z";
const JUST_BEFORE_END = "2026-10-29T14:59:59.999Z";

function base(overrides: Partial<AggregateInput> = {}): AggregateInput {
  return {
    reportDate: DATE,
    source: "DEMO",
    generatedAt: new Date("2026-10-30T01:00:00.000Z"),
    coversUntil: new Date(END),
    baselineAt: null,
    runs: [],
    apiChecks: [],
    logs: [],
    collectedCount: 0,
    newAnomalies: [],
    closedEvents: [],
    statusCounts: {},
    unresolved: [],
    ...overrides,
  };
}

const run = (id: number, started_at: string, status = "succeeded") => ({ id, status, started_at });
const pending = (id: number, first: string, extra: object = {}) => ({
  id,
  rule_id: "DATE_ORDER",
  item_key: `DEMO-${String(id).padStart(4, "0")}`,
  status: "open",
  assignee_name: null,
  first_detected_at: first,
  last_detected_at: first,
  ...extra,
});

describe("빈 날", () => {
  it("아무 기록이 없으면 hasActivity가 false이고 모든 숫자는 0이며 오류가 나지 않는다", () => {
    const m = aggregateReport(base());
    expect(m.hasActivity).toBe(false);
    expect(m.api).toMatchObject({ total: 0, avgMs: null, maxMs: null });
    expect(m.runs.total).toBe(0);
    expect(m.anomalies.newCount).toBe(0);
    expect(m.unresolved).toMatchObject({ total: 0, omitted: 0, rows: [] });
    expect(m.validation.newByRule).toEqual({ DATE_ORDER: 0, REQUIRED_FIELD: 0, LIST_DETAIL_MISMATCH: 0, EMPTY_RESULT: 0 });
  });

  it("결과는 저장 모양 검사를 통과한다", () => {
    expect(parseReportModel(aggregateReport(base()))).not.toBeNull();
  });
});

describe("KST 하루 경계 [00:00, 24:00)", () => {
  it("정확히 00:00 실행은 포함하고, 1밀리초 전은 제외한다", () => {
    const m = aggregateReport(base({ runs: [run(1, START), run(2, JUST_BEFORE_START)] }));
    expect(m.runs.total).toBe(1);
  });

  it("24:00(다음 날 00:00) 정각은 제외하고, 1밀리초 전은 포함한다", () => {
    const m = aggregateReport(base({ runs: [run(1, END), run(2, JUST_BEFORE_END)] }));
    expect(m.runs.total).toBe(1);
  });

  it("범위 밖 실행의 API 호출·로그는 세지 않는다", () => {
    const m = aggregateReport(
      base({
        runs: [run(1, JUST_BEFORE_START), run(2, START)],
        apiChecks: [
          { run_id: 1, outcome: "success", duration_ms: 100 },
          { run_id: 2, outcome: "timeout", duration_ms: 10000 },
        ],
        logs: [
          { run_id: 1, code: "COMPARE_SKIPPED", message: "밖" },
          { run_id: 2, code: "COMPARE_SKIPPED", message: "안" },
        ],
      }),
    );
    expect(m.api.total).toBe(1);
    expect(m.api.timeout).toBe(1);
    expect(m.skipReasons).toEqual([{ code: "COMPARE_SKIPPED", count: 1, sample: "안" }]);
  });

  it("신규 이상징후와 종결 이력도 같은 경계를 쓴다", () => {
    const m = aggregateReport(
      base({
        newAnomalies: [
          { rule_id: "DATE_ORDER", first_detected_at: START, previous_anomaly_id: null },
          { rule_id: "DATE_ORDER", first_detected_at: JUST_BEFORE_START, previous_anomaly_id: null },
          { rule_id: "REQUIRED_FIELD", first_detected_at: END, previous_anomaly_id: null },
        ],
        closedEvents: [
          { to_value: "resolved", created_at: JUST_BEFORE_END },
          { to_value: "dismissed", created_at: END },
        ],
      }),
    );
    expect(m.anomalies.newCount).toBe(1);
    expect(m.anomalies.closedCount).toBe(1);
    expect(m.anomalies.resolvedCount).toBe(1);
    expect(m.anomalies.dismissedCount).toBe(0);
  });

  it("오늘 보고서는 생성 시각까지만 집계하고 partialDay가 true이다 (끝 시각은 제외)", () => {
    const now = "2026-10-29T03:00:00.000Z"; // KST 12:00
    const m = aggregateReport(
      base({
        generatedAt: new Date(now),
        coversUntil: new Date(now),
        runs: [run(1, "2026-10-29T02:59:59.999Z"), run(2, now)],
      }),
    );
    expect(m.partialDay).toBe(true);
    expect(m.runs.total).toBe(1);
    expect(m.coversUntil).toBe(now);
  });

  it("집계 끝이 하루를 넘어도 그날 끝으로 잘린다", () => {
    const m = aggregateReport(base({ coversUntil: new Date("2026-10-31T00:00:00.000Z") }));
    expect(m.coversUntil).toBe(END);
    expect(m.partialDay).toBe(false);
  });
});

describe("API 점검 요약", () => {
  it("결과 구분별 건수와 평균·최대 응답시간을 계산한다 (평균은 반올림)", () => {
    const m = aggregateReport(
      base({
        runs: [run(1, START)],
        apiChecks: [
          { run_id: 1, outcome: "success", duration_ms: 100 },
          { run_id: 1, outcome: "success", duration_ms: 201 },
          { run_id: 1, outcome: "http_error", duration_ms: 50 },
          { run_id: 1, outcome: "timeout", duration_ms: 10000 },
          { run_id: 1, outcome: "auth_or_quota", duration_ms: 10 },
          { run_id: 1, outcome: "empty_result", duration_ms: 30 },
        ],
      }),
    );
    expect(m.api).toEqual({ total: 6, success: 2, httpError: 1, timeout: 1, authOrQuota: 1, emptyResult: 1, avgMs: 1732, maxMs: 10000 });
    expect(m.hasActivity).toBe(true);
  });

  it("실행 상태별 횟수를 센다", () => {
    const m = aggregateReport(base({ runs: [run(1, START), run(2, START, "failed"), run(3, START, "failed")] }));
    expect(m.runs.byStatus).toEqual({ succeeded: 1, failed: 2 });
  });

  it("실행 로그는 코드별로 묶고 인증키 값은 가린다", () => {
    const m = aggregateReport(
      base({
        runs: [run(1, START)],
        logs: [
          { run_id: 1, code: "COMPARE_SKIPPED", message: "비교 제외 2건 (시간차 초과)" },
          { run_id: 1, code: "COMPARE_SKIPPED", message: "비교 제외 1건" },
          { run_id: 1, code: "CALL_LIMIT", message: "호출 상한 serviceKey=abc123 도달" },
          { run_id: null, code: "SCHEDULE_MISSED", message: "누락" },
        ],
      }),
    );
    expect(m.skipReasons.map((s) => [s.code, s.count])).toEqual([
      ["COMPARE_SKIPPED", 2],
      ["CALL_LIMIT", 1],
    ]);
    expect(JSON.stringify(m)).not.toContain("abc123");
  });
});

describe("이상징후 발생·처리", () => {
  it("규칙별 신규 건수와 재발(이전 건 연결)을 센다", () => {
    const m = aggregateReport(
      base({
        newAnomalies: [
          { rule_id: "DATE_ORDER", first_detected_at: START, previous_anomaly_id: null },
          { rule_id: "DATE_ORDER", first_detected_at: START, previous_anomaly_id: 7 },
          { rule_id: "EMPTY_RESULT", first_detected_at: START, previous_anomaly_id: null },
        ],
        statusCounts: { open: 2, resolved: 1 },
      }),
    );
    expect(m.validation.newByRule).toEqual({ DATE_ORDER: 2, REQUIRED_FIELD: 0, LIST_DETAIL_MISMATCH: 0, EMPTY_RESULT: 1 });
    expect(m.anomalies).toMatchObject({ newCount: 3, recurredCount: 1 });
    expect(m.anomalies.byStatus).toEqual({ open: 2, investigating: 0, resolved: 1, dismissed: 0 });
  });
});

describe("미처리 이상징후 목록 (최대 50건)", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => pending(i + 1, new Date(Date.parse(START) + i * 1000).toISOString()));

  it("기본 상한은 50이다", () => {
    expect(UNRESOLVED_LIMIT).toBe(50);
  });

  it("49건·50건이면 모두 보여 주고 외 0건", () => {
    for (const n of [49, 50]) {
      const m = aggregateReport(base({ unresolved: make(n) }));
      expect(m.unresolved).toMatchObject({ total: n, omitted: 0 });
      expect(m.unresolved.rows).toHaveLength(n);
    }
  });

  it("51건이면 50건만 보여 주고 외 1건", () => {
    const m = aggregateReport(base({ unresolved: make(51) }));
    expect(m.unresolved).toMatchObject({ total: 51, omitted: 1 });
    expect(m.unresolved.rows).toHaveLength(50);
  });

  it("처음 탐지된 시각이 오래된 순서로 정렬한다 (같으면 번호 순)", () => {
    const m = aggregateReport(
      base({
        unresolved: [pending(3, "2026-10-28T20:00:00.000Z"), pending(2, "2026-10-28T16:00:00.000Z"), pending(1, "2026-10-28T16:00:00.000Z")],
      }),
    );
    expect(m.unresolved.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("종결된 건과 보고 끝 이후에 처음 탐지된 건은 제외한다", () => {
    const m = aggregateReport(
      base({
        unresolved: [pending(1, START), pending(2, START, { status: "resolved" }), pending(3, END), pending(4, JUST_BEFORE_END, { status: "investigating" })],
      }),
    );
    expect(m.unresolved.rows.map((r) => r.id)).toEqual([1, 4]);
    expect(m.unresolved.total).toBe(2);
  });

  it("담당자 이름과 물건 번호가 길면 줄여 저장한다", () => {
    const m = aggregateReport(base({ unresolved: [pending(1, START, { assignee_name: "가".repeat(60), item_key: "K".repeat(100) })] }));
    expect(m.unresolved.rows[0].assignee!.length).toBeLessThanOrEqual(20);
    expect(m.unresolved.rows[0].itemKey.length).toBeLessThanOrEqual(40);
  });

  it("limit을 줄이면 나머지는 외 N건이 된다", () => {
    const m = aggregateReport(base({ unresolved: make(10), unresolvedLimit: 4 }));
    expect(m.unresolved).toMatchObject({ total: 10, omitted: 6 });
  });
});

describe("출처와 기준 시각", () => {
  it("출처 구분이 모델에 그대로 남는다", () => {
    expect(aggregateReport(base({ source: "PUBLIC" })).source).toBe("PUBLIC");
    expect(aggregateReport(base()).source).toBe("DEMO");
  });

  it("점검 기준 시각이 없으면 null이다", () => {
    expect(aggregateReport(base()).baselineAt).toBeNull();
    expect(aggregateReport(base({ baselineAt: new Date(START) })).baselineAt).toBe(START);
  });
});

describe("다운로드 파일 이름", () => {
  it("날짜와 출처만 쓴다", () => {
    expect(reportFileName("2026-10-29", "DEMO")).toBe("daily-report-2026-10-29-DEMO.md");
    expect(reportFileName("2026-10-29", "PUBLIC")).toBe("daily-report-2026-10-29-PUBLIC.md");
  });
  it("이상한 값이 와도 안전한 이름이 된다", () => {
    expect(reportFileName('"; evil', "x")).toBe("daily-report-unknown-date-DEMO.md");
  });
});

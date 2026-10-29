// 일일 점검보고서 Markdown 시험 (PLAN 30번): 빈 날 문구, 출처 표시, 오늘 보고서 표시, 외 N건, 특수문자·파이프 이스케이프
import { describe, expect, it } from "vitest";
import { aggregateReport, type AggregateInput } from "@/lib/reports/aggregate";
import { escapeMarkdownCell, renderReportMarkdown } from "@/lib/reports/markdown";

const START = "2026-10-28T15:00:00.000Z";

function input(overrides: Partial<AggregateInput> = {}): AggregateInput {
  return {
    reportDate: "2026-10-29",
    source: "DEMO",
    generatedAt: new Date("2026-10-30T01:00:00.000Z"),
    coversUntil: new Date("2026-10-29T15:00:00.000Z"),
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

const pending = (id: number, extra: object = {}) => ({
  id,
  rule_id: "REQUIRED_FIELD",
  item_key: `DEMO-${String(id).padStart(4, "0")}`,
  status: "open",
  assignee_name: null,
  first_detected_at: START,
  last_detected_at: "2026-10-29T00:30:00.000Z",
  ...extra,
});

describe("빈 날", () => {
  const md = renderReportMarkdown(aggregateReport(input()));

  it("'해당 날짜 점검 기록이 없습니다'가 들어간다", () => {
    expect(md).toContain("해당 날짜 점검 기록이 없습니다");
  });

  it("모든 절 제목이 그대로 있다 (빈 날도 같은 틀)", () => {
    for (const title of ["## 1. API 점검 요약", "## 2. 점검 실행 요약", "## 3. 데이터 검증 결과", "## 4. 이상징후 발생·처리 현황", "## 5. 미처리 이상징후", "## 6. 점검 메모"]) {
      expect(md).toContain(title);
    }
    expect(md).toContain("미처리 이상징후가 없습니다.");
  });

  it("점검 기록이 있는 날에는 그 문구가 없다", () => {
    const m = aggregateReport(input({ runs: [{ id: 1, status: "succeeded", started_at: START }] }));
    expect(renderReportMarkdown(m)).not.toContain("해당 날짜 점검 기록이 없습니다");
  });
});

describe("출처와 시각 표시", () => {
  it("DEMO와 PUBLIC을 구분해 제목과 출처 줄에 쓴다", () => {
    const demo = renderReportMarkdown(aggregateReport(input()));
    const pub = renderReportMarkdown(aggregateReport(input({ source: "PUBLIC" })));
    expect(demo).toContain("(DEMO)");
    expect(demo).toContain("DEMO (교육용 가상 데이터)");
    expect(pub).toContain("(PUBLIC)");
    expect(pub).toContain("PUBLIC (공공데이터포털 공개 API)");
  });

  it("지난 날짜는 00:00~24:00 KST, 오늘은 '생성 시각까지 집계'로 표시한다", () => {
    expect(renderReportMarkdown(aggregateReport(input()))).toContain("2026-10-29 00:00 ~ 24:00 KST");
    const now = new Date("2026-10-29T03:00:00.000Z");
    const today = renderReportMarkdown(aggregateReport(input({ generatedAt: now, coversUntil: now })));
    expect(today).toContain("생성 시각까지 집계");
    expect(today).toContain("2026-10-29 12:00:00 KST");
  });

  it("생성 시각과 점검 기준 시각을 KST로 보여 준다", () => {
    const md = renderReportMarkdown(aggregateReport(input({ baselineAt: new Date("2026-10-29T00:00:12.000Z") })));
    expect(md).toContain("보고서 생성 시각: 2026-10-30 10:00:00 KST");
    expect(md).toContain("점검 기준 시각: 2026-10-29 09:00:12 KST");
  });
});

describe("미처리 목록", () => {
  it("표에 번호·규칙·물건·상태·담당자·최근 탐지가 들어간다", () => {
    const md = renderReportMarkdown(aggregateReport(input({ unresolved: [pending(5, { assignee_name: "시연 담당자" })] })));
    expect(md).toContain("| 번호 | 규칙 | 물건 | 상태 | 담당자 | 최근 탐지 |");
    expect(md).toContain("| #5 | 필수정보 | DEMO-0005 | 미확인 | 시연 담당자 | 2026-10-29 09:30:00 KST |");
  });

  it("50건이면 '외 N건'이 없고 51건이면 '외 1건'이 있다", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => pending(i + 1));
    expect(renderReportMarkdown(aggregateReport(input({ unresolved: make(50) })))).not.toMatch(/외 \d+건/);
    expect(renderReportMarkdown(aggregateReport(input({ unresolved: make(51) })))).toContain("외 1건");
  });
});

describe("특수문자 이스케이프", () => {
  it("세로줄(|)은 \\|로 바뀌어 표가 깨지지 않는다", () => {
    expect(escapeMarkdownCell("a|b")).toBe("a\\|b");
    const md = renderReportMarkdown(aggregateReport(input({ unresolved: [pending(1, { item_key: "A|B", assignee_name: "김|철수" })] })));
    const line = md.split("\n").find((l) => l.startsWith("| #1 "))!;
    expect(line).toContain("A\\|B");
    expect(line).toContain("김\\|철수");
    // 이스케이프되지 않은 세로줄은 칸 구분용 7개(앞뒤 포함)뿐이어야 한다
    expect(line.replace(/\\\|/g, "").split("|").length - 1).toBe(7);
  });

  it("줄바꿈은 공백으로, 역슬래시는 두 개로, 꺾쇠는 문자로 바꾼다", () => {
    expect(escapeMarkdownCell("a\nb\r\nc")).toBe("a b c");
    expect(escapeMarkdownCell("a\\b")).toBe("a\\\\b");
    expect(escapeMarkdownCell("<script>")).toBe("&lt;script&gt;");
  });

  it("점검 메모의 예시 문구도 이스케이프한다", () => {
    const m = aggregateReport(
      input({
        runs: [{ id: 1, status: "succeeded", started_at: START }],
        logs: [{ run_id: 1, code: "COMPARE_SKIPPED", message: "제외 | 사유\n둘째 줄" }],
      }),
    );
    const md = renderReportMarkdown(m);
    expect(md).toContain("| COMPARE_SKIPPED | 1 | 제외 \\| 사유 둘째 줄 |");
  });
});

describe("결과 모양", () => {
  it("같은 모델이면 항상 같은 글이 나오고 줄바꿈으로 끝난다", () => {
    const m = aggregateReport(input({ runs: [{ id: 1, status: "failed", started_at: START }] }));
    expect(renderReportMarkdown(m)).toBe(renderReportMarkdown(m));
    expect(renderReportMarkdown(m).endsWith("\n")).toBe(true);
  });

  it("서비스키 형태의 글자가 남지 않는다 (reports 테이블 제약)", () => {
    const m = aggregateReport(
      input({ runs: [{ id: 1, status: "failed", started_at: START }], logs: [{ run_id: 1, code: "X", message: "serviceKey=SECRET1" }] }),
    );
    expect(renderReportMarkdown(m)).not.toMatch(/servicekey=(?!\*)/i);
  });
});

// 일일 점검보고서 홈페이지 절 시험 (W23): 가용률 경계값, 저하는 정상이 아님, 분모 제외 항목, Markdown·모델 모양
import { describe, expect, it } from "vitest";
import { aggregateReport } from "@/lib/reports/aggregate";
import { renderReportMarkdown } from "@/lib/reports/markdown";
import { parseReportModel } from "@/lib/reports/model";
import { availabilityOf, buildWebReport, downText, judgedCount, unavailableWebReport, type WebDayRow } from "@/lib/reports/web-section";

const row = (o: Partial<WebDayRow> = {}): WebDayRow => ({
  target_key: "onbid-main",
  pass_data: 0, pass_no_data: 0, degraded: 0, fail: 0, unverified: 0, not_run: 0,
  planned_count: 0, unplanned_count: 0, flap_count: 0, confirmed_down_count: 0, down_seconds: 0, avg_ms: null, max_ms: null,
  ...o,
});

describe("가용률", () => {
  it("설계 예시: 정상 22·저하 1·실패 1 → 22/24", () => {
    expect(availabilityOf(row({ pass_data: 22, degraded: 1, fail: 1 }))).toEqual({ num: 22, den: 24 });
  });
  it("저하는 정상 계열이 아니다 (분모에는 들어가고 분자에는 안 들어감)", () => {
    expect(availabilityOf(row({ pass_data: 23, degraded: 1 }))).toEqual({ num: 23, den: 24 });
  });
  it("정상(데이터 없음)은 정상 계열이다", () => {
    expect(availabilityOf(row({ pass_data: 20, pass_no_data: 4 }))).toEqual({ num: 24, den: 24 });
  });
  it("확인 불가·미점검은 분모에서 빠진다", () => {
    expect(availabilityOf(row({ pass_data: 20, unverified: 2, not_run: 2 }))).toEqual({ num: 20, den: 20 });
  });
  it("계획 점검·미등록 점검은 분모에서 빠진다", () => {
    expect(availabilityOf(row({ pass_data: 20, fail: 4, planned_count: 3, unplanned_count: 1 }))).toEqual({ num: 20, den: 20 });
  });
  it("경계: 분모가 0이면 분자도 0 (비율 없음)", () => {
    expect(availabilityOf(row({ unverified: 24 }))).toEqual({ num: 0, den: 0 });
  });
  it("경계: 분자는 분모를 넘지 않는다 (계획 점검 중 정상 칸이 있어도)", () => {
    expect(availabilityOf(row({ pass_data: 3, planned_count: 3 }))).toEqual({ num: 0, den: 0 });
  });
});

describe("모델과 문구", () => {
  const web = buildWebReport({
    rows: [row({ pass_data: 22, degraded: 1, fail: 1, flap_count: 2, confirmed_down_count: 1, down_seconds: 7200, avg_ms: 1180, max_ms: 3420 })],
    labelOf: () => "온비드 홈페이지",
    anomalies: [{ id: 123, status: "resolved", rule_id: "WEB_AVAILABILITY" }],
  });
  const base = aggregateReport({
    reportDate: "2026-11-06", source: "PUBLIC", generatedAt: new Date("2026-11-07T01:00:00Z"), coversUntil: new Date("2026-11-06T15:00:00Z"), baselineAt: null,
    runs: [], apiChecks: [], logs: [], collectedCount: 0, newAnomalies: [], closedEvents: [], statusCounts: {}, unresolved: [],
  });

  it("판정 횟수는 여섯 판정의 합", () => {
    expect(judgedCount(web.targets[0])).toBe(24);
  });
  it("지속 시간 문구", () => {
    expect(downText(0)).toBe("없음");
    expect(downText(7200)).toBe("약 2시간");
    expect(downText(3600)).toBe("약 1시간");
    expect(downText(5400)).toBe("약 1.5시간");
  });
  it("Markdown에 홈페이지 절과 한계 문구·가용률 식이 들어간다", () => {
    const md = renderReportMarkdown({ ...base, web });
    expect(md).toContain("홈페이지 모니터링");
    expect(md).toContain("단일 지점, 1시간 간격 외부 관측");
    expect(md).toContain("91.7% (22 / 24)");
    expect(md).toContain("확정 장애 1건 (총 지속 약 2시간");
    expect(md).toContain("평균 1,180 ms · 최대 3,420 ms");
    expect(md).toContain("#123 (");
  });
  it("web이 없는 보고서(DEMO·옛 보고서)에는 절이 없다", () => {
    expect(renderReportMarkdown(base)).not.toContain("홈페이지 모니터링");
  });
  it("집계를 못 읽으면 절은 남기되 숫자 대신 안내를 적는다", () => {
    const md = renderReportMarkdown({ ...base, web: unavailableWebReport() });
    expect(md).toContain("불러오지 못했습니다");
    expect(md).not.toContain("가용률:");
  });
  it("기록 없는 날은 안내 문구", () => {
    const md = renderReportMarkdown({ ...base, web: buildWebReport({ rows: [], labelOf: (k) => k, anomalies: [] }) });
    expect(md).toContain("홈페이지 정시 점검 기록이 없습니다");
  });
  it("저장 모양 검사를 통과하고, web 없는 옛 모양도 통과한다", () => {
    expect(parseReportModel({ ...base, web })).not.toBeNull();
    expect(parseReportModel(base)).not.toBeNull();
  });
});

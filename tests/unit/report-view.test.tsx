// 보고서 미리보기 화면이 가용성(7절)·품질(8절)·실행 품질 절을 그리는지 시험한다 (서버 컴포넌트를 HTML로 그려 본다. 저장되는 것 없음)
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/components/reports/report-view";
import { aggregateReport } from "@/lib/reports/aggregate";
import { buildWebReport, unavailableWebReport } from "@/lib/reports/web-section";
import { buildExecutionSection, buildQualitySection } from "@/lib/reports/quality";

const base = aggregateReport({ reportDate: "2026-10-29", source: "PUBLIC", generatedAt: new Date("2026-10-29T03:00:00Z"), coversUntil: new Date("2026-10-29T03:00:00Z"), baselineAt: null, runs: [], apiChecks: [], logs: [], collectedCount: 0, newAnomalies: [], closedEvents: [], statusCounts: {}, unresolved: [] });
const quality = buildQualitySection({ probes: [{ api_id: "SVC-API-001", operation_id: "a", attempted: true }], logs: [], runIds: new Set(), collectedItems: 5, newByRule: { DQ_REQUIRED: 2 } });
const execution = buildExecutionSection({ reportDate: "2026-10-29", coversUntil: new Date("2026-10-29T03:00:00Z"), runs: [], missedRecorded: false, graceMinutes: 30 });
const availability = { registry: { target: 26, registered: 25, unconfirmed: 1, operations: 28 }, counts: { PASS_DATA: 15, NOT_RUN: 13 }, noRecord: 13, ready: { ready: 28, notReady: 0 }, attemptRate: { num: 15, den: 28 }, basicOk: { num: 15, den: 15 }, realData: { passData: 15, positiveRegistered: 0 }, serviceCoverage: { num: 3, den: 26 }, failByCode: {}, reasons: { unverified: { NO_VALID_INPUT: 13 }, notRun: {} }, lastCheckedAt: "2026-10-29 09:00:10", operations: [] };

describe("ReportView (미리보기)", () => {
  it("가용성·품질·실행 품질 절이 있으면 7·8·9절로 그린다 (한계 문구와 '의심' 포함)", () => {
    const html = renderToStaticMarkup(<ReportView model={{ ...base, availability, quality, execution }} />);
    expect(html).toContain("7. 온비드 OpenAPI 가용성 (PUBLIC)");
    expect(html).toContain("온비드 서버 전체의 가용성");
    expect(html).toContain("8. 데이터 품질 규칙 적용 현황 (PUBLIC)");
    expect(html).toContain("의심");
    expect(html).toContain("9. 실행 품질");
    expect(html).toContain("예약 점검(KST 08:00)");
    expect(html).toContain('data-testid="report-availability"');
  });
  it("실행 품질만 있는 보고서(DEMO)는 7절로 번호가 앞당겨진다", () => {
    const html = renderToStaticMarkup(<ReportView model={{ ...base, source: "DEMO", execution }} />);
    expect(html).toContain("7. 실행 품질");
    expect(html).not.toContain("가용성 (PUBLIC)");
    expect(html).not.toContain("데이터 품질 규칙 적용 현황");
  });
  it("이전에 저장된 보고서(세 절 없음)도 그대로 그려진다", () => {
    const html = renderToStaticMarkup(<ReportView model={base} />);
    expect(html).toContain("6. 점검 메모");
    expect(html).not.toContain("실행 품질");
  });
  it("홈페이지 절이 있으면 9절, 실행 품질은 10절로 밀린다 (한계 문구·가용률 포함)", () => {
    const web = buildWebReport({ rows: [{ target_key: "onbid-main", pass_data: 22, pass_no_data: 0, degraded: 1, fail: 1, unverified: 0, not_run: 0, planned_count: 0, unplanned_count: 0, flap_count: 2, confirmed_down_count: 1, down_seconds: 3600, avg_ms: 1180, max_ms: 3420 }], labelOf: () => "온비드 홈페이지", anomalies: [{ id: 7, status: "open", rule_id: "WEB_AVAILABILITY" }] });
    const html = renderToStaticMarkup(<ReportView model={{ ...base, availability, quality, execution, web }} />);
    expect(html).toContain("9. 홈페이지 모니터링");
    expect(html).toContain("10. 실행 품질");
    expect(html).toContain("단일 지점, 1시간 간격 외부 관측");
    expect(html).toContain("91.7% (22 / 24)");
    expect(html).toContain("#7 (");
  });
  it("홈페이지 집계를 못 읽은 보고서도 절 안내만 그려진다", () => {
    const html = renderToStaticMarkup(<ReportView model={{ ...base, web: unavailableWebReport() }} />);
    expect(html).toContain('data-testid="report-web-unavailable"');
  });
});

// 보고서 미리보기 화면이 가용성(7절)·품질(8절)·실행 품질 절을 그리는지 시험한다 (서버 컴포넌트를 HTML로 그려 본다. 저장되는 것 없음)
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/components/reports/report-view";
import { aggregateReport } from "@/lib/reports/aggregate";
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
    expect(html).toContain("예약 점검(KST 09:00)");
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
});

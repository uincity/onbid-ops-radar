// 보고서의 데이터 품질 절·실행 품질 절 집계 시험 (Gap #36·37 보강, PRD 5-4)
import { describe, expect, it } from "vitest";
import { buildExecutionSection, buildQualitySection, type ExecutionRunRow } from "@/lib/reports/quality";
import { renderReportMarkdown } from "@/lib/reports/markdown";
import { aggregateReport } from "@/lib/reports/aggregate";
import { parseReportModel } from "@/lib/reports/model";

const probe = (api: string, op: string, attempted: boolean) => ({ api_id: api, operation_id: op, attempted });
const log = (run_id: number | null, code: string, message = "m") => ({ run_id, code, message });

describe("buildQualitySection", () => {
  const base = { collectedItems: 40, newByRule: { DQ_SCHEMA: 2, DQ_REQUIRED: 1 } as Record<string, number>, runIds: new Set([1, 2]) };
  it("적용 대상 오퍼레이션 수는 요청을 보낸 것만, 같은 오퍼레이션은 한 번만 센다", () => {
    const q = buildQualitySection({ ...base, probes: [probe("SVC-API-001", "a", true), probe("SVC-API-001", "a", true), probe("SVC-API-004", "b", false)], logs: [] });
    expect(q.applicableApis).toBe(1);
    expect(q.rules.find((r) => r.ruleId === "DQ_SCHEMA")).toEqual({ ruleId: "DQ_SCHEMA", targets: 1, suspected: 2 });
    expect(q.rules.find((r) => r.ruleId === "DQ_REQUIRED")).toEqual({ ruleId: "DQ_REQUIRED", targets: 40, suspected: 1 });
    expect(q.rules.find((r) => r.ruleId === "DQ_LIST_DETAIL_REF")).toEqual({ ruleId: "DQ_LIST_DETAIL_REF", targets: 40, suspected: 0 });
  });
  it("판정 보류 건수는 메모의 건수를 합치고, 그날 실행 밖의 메모는 세지 않는다", () => {
    const q = buildQualitySection({
      ...base,
      probes: [],
      logs: [log(1, "DQ_REF_UNVERIFIED", "DQ_LIST_DETAIL_REF 판정 보류(UNVERIFIED) 3건: x"), log(2, "DQ_REF_UNVERIFIED", "판정 보류(UNVERIFIED) 2건: y"), log(99, "DQ_REF_UNVERIFIED", "판정 보류(UNVERIFIED) 50건: z"), log(null, "DQ_REF_UNVERIFIED", "판정 보류(UNVERIFIED) 7건")],
    });
    expect(q.deferred).toBe(5);
  });
  it("교차 참조는 적용 제외 메모가 있으면 대상 없음(null), 메모가 없으면 0", () => {
    const withNote = buildQualitySection({ ...base, probes: [], logs: [log(1, "DQ_CROSS_API_NOT_APPLICABLE"), log(2, "DQ_CROSS_API_NOT_APPLICABLE")] });
    expect(withNote.rules.find((r) => r.ruleId === "DQ_CROSS_API_REF")?.targets).toBeNull();
    expect(withNote.notApplicableRuns).toBe(2);
    const without = buildQualitySection({ ...base, probes: [], logs: [] });
    expect(without.rules.find((r) => r.ruleId === "DQ_CROSS_API_REF")?.targets).toBe(0);
  });
  it("교차 참조를 검사한 실행이 있으면 검사 건수를 합치고(적용 제외 메모가 섞여도 대상 있음), 그날 실행 밖의 메모는 세지 않는다", () => {
    const q = buildQualitySection({
      ...base,
      probes: [],
      logs: [log(1, "DQ_CROSS_API_CHECKED", "DQ_CROSS_API_REF 검사 1건 (공식 관계 1개 중)"), log(2, "DQ_CROSS_API_CHECKED", "DQ_CROSS_API_REF 검사 2건 (공식 관계 1개 중)"), log(2, "DQ_CROSS_API_NOT_APPLICABLE"), log(99, "DQ_CROSS_API_CHECKED", "DQ_CROSS_API_REF 검사 50건")],
    });
    expect(q.rules.find((r) => r.ruleId === "DQ_CROSS_API_REF")?.targets).toBe(3);
  });
  it("기록이 하나도 없으면 모든 숫자가 0이다", () => {
    const q = buildQualitySection({ probes: [], logs: [], runIds: new Set(), collectedItems: 0, newByRule: {} });
    expect(q).toMatchObject({ applicableApis: 0, collectedItems: 0, deferred: 0, notApplicableRuns: 0 });
    expect(q.rules.every((r) => r.suspected === 0)).toBe(true);
  });
});

describe("buildExecutionSection (KST 2026-10-29: 예정 09:00 = 00:00Z, 기한 09:30 = 00:30Z)", () => {
  const run = (over: Partial<ExecutionRunRow> = {}): ExecutionRunRow => ({ id: 1, trigger: "scheduled", status: "succeeded", started_at: "2026-10-29T00:00:05Z", finished_at: "2026-10-29T00:00:20Z", ...over });
  const day = { reportDate: "2026-10-29", graceMinutes: 30, missedRecorded: false };
  const full = new Date("2026-10-29T15:00:00Z"); // 지난 날짜 보고서: 집계 끝 = 다음 날 00:00 KST

  it("지난 날짜 보고서도 그날 기준으로 판단한다 (집계 끝이 다음 날 00:00이어도)", () => {
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [run()] })).toMatchObject({ scheduleState: "COMPLETED", scheduledRunCount: 1 });
  });
  it("예약 점검 기록이 없으면 누락, 수동 점검만 있어도 누락이다", () => {
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [] }).scheduleState).toBe("MISSED");
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [run({ trigger: "manual" })] })).toMatchObject({ scheduleState: "MISSED", scheduledRunCount: 0 });
  });
  it("차단·일부 완료는 정상 완료가 아니다", () => {
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [run({ status: "blocked" })] }).scheduleState).toBe("BLOCKED");
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [run({ status: "partial" })] }).scheduleState).toBe("PARTIAL");
  });
  it("오늘 보고서(생성 시각까지, 끝 시각은 포함하지 않음): 집계 끝이 09:30:00이면 마지막 순간이 09:29:59.999라 아직 대기, 1ms 뒤부터 누락", () => {
    expect(buildExecutionSection({ ...day, coversUntil: new Date("2026-10-29T00:30:00.000Z"), runs: [] }).scheduleState).toBe("WAITING"); // 한 칸 안
    expect(buildExecutionSection({ ...day, coversUntil: new Date("2026-10-29T00:30:00.001Z"), runs: [] }).scheduleState).toBe("MISSED"); // 한 칸 밖
  });
  it("마지막 완료 시각과 마지막 정상 완료 시각을 구분한다 (끝나지 않은 실행은 완료 시각이 없다)", () => {
    const runs = [run({ id: 1, finished_at: "2026-10-29T00:00:20Z" }), run({ id: 2, trigger: "manual", status: "failed", started_at: "2026-10-29T03:00:00Z", finished_at: "2026-10-29T03:00:30Z" }), run({ id: 3, trigger: "manual", status: "running", started_at: "2026-10-29T05:00:00Z", finished_at: null })];
    const e = buildExecutionSection({ ...day, coversUntil: full, runs });
    expect(e.lastFinishedAt).toBe("2026-10-29T03:00:30.000Z");
    expect(e.lastSucceededAt).toBe("2026-10-29T00:00:20.000Z");
  });
  it("실행이 하나도 없으면 완료 시각은 없다", () => {
    expect(buildExecutionSection({ ...day, coversUntil: full, runs: [] })).toMatchObject({ lastFinishedAt: null, lastSucceededAt: null });
  });
});

describe("보고서 Markdown의 품질·실행 품질 절", () => {
  const base = aggregateReport({ reportDate: "2026-10-29", source: "PUBLIC", generatedAt: new Date("2026-10-29T03:00:00Z"), coversUntil: new Date("2026-10-29T03:00:00Z"), baselineAt: null, runs: [], apiChecks: [], logs: [], collectedCount: 0, newAnomalies: [], closedEvents: [], statusCounts: {}, unresolved: [] });
  const quality = buildQualitySection({ probes: [probe("SVC-API-001", "a", true)], logs: [log(1, "DQ_CROSS_API_NOT_APPLICABLE")], runIds: new Set([1]), collectedItems: 5, newByRule: { DQ_REQUIRED: 2 } });
  const execution = buildExecutionSection({ reportDate: "2026-10-29", coversUntil: new Date("2026-10-29T03:00:00Z"), runs: [], missedRecorded: true, graceMinutes: 30 });

  it("품질 절에는 '의심' 문구, 적용 대상, 적용 제외가 있고, 실행 품질 절에는 예약 점검 상태가 있다", () => {
    const md = renderReportMarkdown({ ...base, quality, execution });
    expect(md).toContain("## 8. 데이터 품질 규칙 적용 현황 (PUBLIC)");
    expect(md).toContain("의심");
    expect(md).toContain("적용 제외 (연결해서 비교할 API 점검 없음)");
    expect(md).toContain("## 7. 실행 품질"); // 가용성 절이 없으면 번호가 앞당겨진다
    expect(md).toContain("예약 점검(KST 09:00)");
    expect(md).toContain("MISSED");
  });
  it("가용성 절이 있으면 실행 품질은 9절이다", () => {
    const availability = { registry: { target: 26, registered: 25, unconfirmed: 1, operations: 28 }, counts: {}, noRecord: 0, ready: { ready: 0, notReady: 0 }, attemptRate: { num: 0, den: 0 }, basicOk: { num: 0, den: 0 }, realData: { passData: 0, positiveRegistered: 0 }, serviceCoverage: { num: 0, den: 26 }, failByCode: {}, reasons: { unverified: {}, notRun: {} }, lastCheckedAt: null, operations: [] };
    expect(renderReportMarkdown({ ...base, availability, quality, execution })).toContain("## 9. 실행 품질");
  });
  it("두 절이 없는 이전 보고서도 그대로 렌더링된다", () => {
    const md = renderReportMarkdown(base);
    expect(md).not.toContain("데이터 품질 규칙 적용 현황");
    expect(md).not.toContain("실행 품질");
  });
  it("저장된 모델 모양 검사를 통과하고 크기가 작다", () => {
    const model = { ...base, quality, execution };
    expect(parseReportModel(model)).not.toBeNull();
    expect(JSON.stringify({ quality, execution }).length).toBeLessThan(1500);
  });
});

// 26종 가용성 집계 시험 (PRD R05) — 6종 합계 · 지표 산식 · 미점검/검증 불가를 정상으로 세지 않는 원칙
import { describe, expect, it } from "vitest";
import { summarizeAvailability, type ProbeRow } from "@/lib/availability/summary";
import { toReportAvailability, reportAvailabilitySchema } from "@/lib/availability/report";
import { allOperations } from "@/lib/registry";

const LIST = { api_id: "SVC-API-001", operation_id: "getRlstCltrList" };
const DETAIL = { api_id: "SVC-API-004", operation_id: "getRlstDtlInf" };
const row = (key: { api_id: string; operation_id: string }, status: string, over: Partial<ProbeRow> = {}): ProbeRow => ({
  ...key,
  status,
  attempted: !["NOT_RUN"].includes(status),
  reason: null,
  checked_at: "2026-10-29T00:10:00Z", // KST 09:10
  ...over,
});
const total = allOperations().length;

describe("summarizeAvailability", () => {
  it("점검 기록이 하나도 없으면 모든 오퍼레이션이 '미점검(기록 없음)'이고 비율은 만들지 않는다", () => {
    const s = summarizeAvailability({ rows: [], okRows: [] });
    expect(s.counts.NOT_RUN).toBe(total);
    expect(s.noRecord).toBe(total);
    expect(s.sumMatches).toBe(true);
    expect(s.basicOk.ratio).toBeNull(); // 시도한 것이 없으면 0%가 아니라 비율 없음
    expect(s.lastCheckedAt).toBeNull();
    expect(s.services.every((svc) => svc.operations.every((o) => o.reason === "NO_RECORD"))).toBe(true);
  });

  it("6종 합계가 오퍼레이션 수와 항상 같다", () => {
    const s = summarizeAvailability({
      rows: [row(LIST, "PASS_DATA"), row(DETAIL, "FAIL", { reason: "TIMEOUT" })],
      okRows: [],
    });
    expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(total);
    expect(s.sumMatches).toBe(true);
    expect(s.counts).toMatchObject({ PASS_DATA: 1, FAIL: 1, NOT_RUN: total - 2 });
    expect(s.failByCode.TIMEOUT).toBe(1);
  });

  it("오퍼레이션마다 가장 최근 행(먼저 온 행)만 쓴다", () => {
    const s = summarizeAvailability({ rows: [row(LIST, "FAIL", { reason: "HTTP_ERROR" }), row(LIST, "PASS_DATA")], okRows: [] });
    expect(s.counts.FAIL).toBe(1);
    expect(s.counts.PASS_DATA).toBe(0);
  });

  it("지표: 시도율은 준비된 오퍼레이션 기준, 기본 정상 비율은 시도한 수 기준 (미점검·검증 불가는 분모에 넣지 않음)", () => {
    const rows = [row(LIST, "PASS_DATA"), row(DETAIL, "FAIL", { reason: "HTTP_ERROR" })];
    const s = summarizeAvailability({ rows, okRows: [] });
    expect(s.ready.ready).toBe(2); // 승인이 확인된 목록·상세
    expect(s.attemptRate).toMatchObject({ num: 2, den: 2, ratio: 1 });
    expect(s.basicOk).toMatchObject({ num: 1, den: 2, ratio: 0.5 });
  });

  it("실데이터 검증률 분모는 Positive 점검으로 등록된 수라서, 등록이 없으면 비율을 만들지 않는다", () => {
    const s = summarizeAvailability({ rows: [row(LIST, "PASS_DATA"), row(DETAIL, "PASS_DATA")], okRows: [] });
    expect(s.realData).toMatchObject({ passData: 2, positiveRegistered: 0 });
    expect(s.realData.ratio.ratio).toBeNull();
  });

  it("전체 목표 대비 검증률: 서비스의 모든 오퍼레이션이 PASS_DATA여야 하고, 분모는 등록 수가 아니라 목표(26)", () => {
    const s = summarizeAvailability({ rows: [row(LIST, "PASS_DATA"), row(DETAIL, "PASS_DATA")], okRows: [] });
    expect(s.serviceCoverage.den).toBe(26);
    expect(s.serviceCoverage.num).toBe(2); // 목록·상세 서비스는 각각 오퍼레이션이 1개
    expect(s.registry).toMatchObject({ target: 26, unconfirmed: 1 });
  });

  it("마지막 정상 응답 시각은 마지막 판정 시각과 따로 보여 준다", () => {
    const s = summarizeAvailability({
      rows: [row(LIST, "FAIL", { reason: "HTTP_ERROR", checked_at: "2026-10-29T02:00:00Z" })],
      okRows: [row(LIST, "PASS_DATA", { checked_at: "2026-10-28T00:00:00Z" })],
    });
    const op = s.services.flatMap((x) => x.operations).find((o) => o.key === "SVC-API-001/getRlstCltrList")!;
    expect(op.checkedAt).toBe("2026-10-29 11:00:00");
    expect(op.lastOkAt).toBe("2026-10-28 09:00:00");
  });

  it("검증 불가 사유를 묶어 센다", () => {
    const s = summarizeAvailability({ rows: [row(DETAIL, "UNVERIFIED", { reason: "PRECONDITION_FAILED" }), row(LIST, "UNVERIFIED", { reason: "NO_DATA_UNCONFIRMED" })], okRows: [] });
    expect(s.reasons.unverified).toEqual({ PRECONDITION_FAILED: 1, NO_DATA_UNCONFIRMED: 1 });
  });

  it("보고서용 축약본은 모양 검사를 통과하고 오퍼레이션 수만큼 줄이 있으며 크기가 작다", () => {
    const r = toReportAvailability(summarizeAvailability({ rows: [row(LIST, "PASS_DATA")], okRows: [] }));
    expect(reportAvailabilitySchema.safeParse(r).success).toBe(true);
    expect(r.operations).toHaveLength(total);
    expect(JSON.stringify(r).length).toBeLessThan(6000);
  });
});

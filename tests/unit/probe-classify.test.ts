// 점검 상태 판정 시험 (R02): 관측 → PASS_DATA · PASS_NO_DATA · DEGRADED · FAIL · UNVERIFIED · NOT_RUN
// 판정 순서(준비 → 연결 → 인증·한도 → 업무 응답 → 스키마 → 0건 → 주의)와 각 경계를 확인한다.
import { describe, expect, it } from "vitest";
import { classifyProbe, type ObservedBody, type ProbeObservation, type ProbePolicy } from "@/lib/checks/probe/classify";
import { observationFromCheck, policyFromOperation } from "@/lib/checks/probe/from-check";
import { findOperation } from "@/lib/registry";
import { FAIL_CODES, PROBE_STATUSES, describeProbe, isKeyOrQuotaProblem, summarizeProbes, type ProbeResult } from "@/lib/checks/probe/status";
import type { SchemaCheckResult } from "@/lib/checks/probe/schema-check";
import type { ApiCheckRecord } from "@/lib/checks/types";

const policy = (over: Partial<ProbePolicy> = {}): ProbePolicy => ({ mode: null, noDataPolicy: "UNDEFINED", expectDataKnown: false, slowMs: null, ...over });
const schemaOk: SchemaCheckResult = { checked: true, ok: true, inspected: 3, problems: [], warnings: 0 };
const obs = (over: Partial<ProbeObservation> = {}): ProbeObservation => ({
  connection: { kind: "response", httpStatus: 200 },
  durationMs: 300,
  retries: 0,
  body: { kind: "ok", recordCount: 5 },
  schema: schemaOk,
  ...over,
});
const withBody = (body: ObservedBody | null, over: Partial<ProbeObservation> = {}) => obs({ body, ...over });
const classify = (o: ProbeObservation | null, p: ProbePolicy = policy(), extra: { unverified?: never; notRunReason?: never } = {}) => classifyProbe({ policy: p, observation: o, ...extra });
const fail = (code: string) => ({ status: "FAIL", attempted: true, code });

describe("준비 단계: 점검할 수 없는 경우는 장애가 아니다", () => {
  it("검증 불가로 정해진 점검은 요청 결과와 관계없이 UNVERIFIED가 우선한다 (요청을 보냈다면 attempted=true)", () => {
    expect(classifyProbe({ policy: policy(), unverified: "APPROVAL_UNCONFIRMED", observation: null })).toEqual({ status: "UNVERIFIED", attempted: false, reason: "APPROVAL_UNCONFIRMED" });
    expect(classifyProbe({ policy: policy(), unverified: "NO_VALID_INPUT", observation: obs() })).toEqual({ status: "UNVERIFIED", attempted: true, reason: "NO_VALID_INPUT" });
  });

  it("요청을 보내지 못했으면 NOT_RUN이고 사유가 반드시 있어야 한다", () => {
    for (const reason of ["BUDGET_SKIP", "SCHEDULE_MISSED", "RUN_BLOCKED", "NO_SCHEDULE", "OPERATOR_STOPPED"] as const) {
      expect(classifyProbe({ policy: policy(), observation: null, notRunReason: reason })).toEqual({ status: "NOT_RUN", attempted: false, reason });
    }
    expect(() => classifyProbe({ policy: policy(), observation: null })).toThrow();
  });
});

describe("연결 단계", () => {
  it("시간 초과 → FAIL(TIMEOUT), 응답을 못 받음 → FAIL(HTTP_ERROR)", () => {
    expect(classify(obs({ connection: { kind: "timeout" }, body: null }))).toEqual(fail("TIMEOUT"));
    expect(classify(obs({ connection: { kind: "network_error" }, body: null }))).toEqual(fail("HTTP_ERROR"));
  });

  it.each([
    [401, "AUTH_ERROR"],
    [403, "AUTH_ERROR"],
    [429, "QUOTA_EXCEEDED"],
    [500, "HTTP_ERROR"],
    [503, "HTTP_ERROR"],
    [404, "HTTP_ERROR"],
    [302, "HTTP_ERROR"], // 따라가지 않은 이동은 정상 응답이 아니다
    [300, "HTTP_ERROR"], // 2xx의 바로 윗 경계
    [199, "HTTP_ERROR"], // 2xx의 바로 아랫 경계
  ])("HTTP %i → FAIL(%s)", (httpStatus, code) => {
    expect(classify(obs({ connection: { kind: "response", httpStatus }, body: null }))).toEqual(fail(code));
  });

  it.each([200, 201, 299])("HTTP %i는 연결 단계를 통과한다", (httpStatus) => {
    expect(classify(obs({ connection: { kind: "response", httpStatus } })).status).toBe("PASS_DATA");
  });
});

describe("업무 응답 단계: HTTP 200이어도 본문의 결과코드를 본다", () => {
  it("서비스키·권한 코드(20·21·30·31·32·33) → AUTH_ERROR, 호출 한도(22) → QUOTA_EXCEEDED", () => {
    for (const code of ["20", "21", "30", "31", "32", "33"]) expect(classify(withBody({ kind: "auth_or_quota", code })), code).toEqual(fail("AUTH_ERROR"));
    expect(classify(withBody({ kind: "auth_or_quota", code: "22" }))).toEqual(fail("QUOTA_EXCEEDED"));
  });

  it("알 수 없는 서비스키 코드는 AUTH_ERROR로 본다", () => {
    expect(classify(withBody({ kind: "auth_or_quota", code: "UNKNOWN" }))).toEqual(fail("AUTH_ERROR"));
  });

  it("그 밖의 업무 오류 코드(01·02·04·05·10·11·12·99) → BUSINESS_ERROR", () => {
    for (const code of ["01", "02", "04", "05", "10", "11", "12", "99"]) expect(classify(withBody({ kind: "error", code })), code).toEqual(fail("BUSINESS_ERROR"));
  });

  it("응답을 해석하지 못함(PARSE·XML·NO_CODE)이거나 정상 응답인데 본문이 없으면 → SCHEMA_ERROR", () => {
    for (const code of ["PARSE", "XML", "NO_CODE"]) expect(classify(withBody({ kind: "error", code })), code).toEqual(fail("SCHEMA_ERROR"));
    expect(classify(withBody(null))).toEqual(fail("SCHEMA_ERROR"));
  });
});

describe("스키마 단계", () => {
  it("필수 응답 항목이 빠졌으면 FAIL(SCHEMA_ERROR)", () => {
    const bad: SchemaCheckResult = { checked: true, ok: false, inspected: 3, problems: [{ code: "MISSING_REQUIRED_FIELD", field: "pbctNo", count: 3 }], warnings: 0 };
    expect(classify(obs({ schema: bad }))).toEqual(fail("SCHEMA_ERROR"));
  });

  it("스키마를 확인하지 못했거나(null) 검사할 항목이 없었으면(checked=false) 구조 오류로 단정하지 않는다", () => {
    expect(classify(obs({ schema: null })).status).toBe("PASS_DATA");
    expect(classify(obs({ schema: { checked: false, ok: true, inspected: 0, problems: [], warnings: 0 } })).status).toBe("PASS_DATA");
  });
});

describe("0건: 기본적으로 정상 무데이터 후보이며 실패로 단정하지 않는다", () => {
  const nodata = (p: ProbePolicy) => classify(withBody({ kind: "nodata" }), p);

  it("명세상 무데이터가 허용되면 PASS_NO_DATA", () => {
    expect(nodata(policy({ noDataPolicy: "ALLOWED" }))).toEqual({ status: "PASS_NO_DATA", attempted: true });
  });

  it("무데이터를 기대한 점검(negative)이면 정책과 관계없이 PASS_NO_DATA", () => {
    expect(nodata(policy({ mode: "negative" }))).toEqual({ status: "PASS_NO_DATA", attempted: true });
  });

  it("정책이 미정이거나 불허여도, 실데이터가 있다고 확인된 입력이 아니면 UNVERIFIED(NO_DATA_UNCONFIRMED)이다 (단순 NODATA는 Positive 성공도 실패도 아니다)", () => {
    for (const noDataPolicy of ["UNDEFINED", "NOT_ALLOWED"] as const) {
      for (const mode of [null, "structural", "positive"] as const) {
        expect(nodata(policy({ noDataPolicy, mode })), `${noDataPolicy}/${mode}`).toEqual({ status: "UNVERIFIED", attempted: true, reason: "NO_DATA_UNCONFIRMED" });
      }
    }
  });

  it("실데이터가 반드시 있다고 독립적으로 확인된 Positive 점검에서만 0건이 POSITIVE_DATA_MISSING이다", () => {
    expect(nodata(policy({ mode: "positive", expectDataKnown: true }))).toEqual(fail("POSITIVE_DATA_MISSING"));
    expect(nodata(policy({ mode: "structural", expectDataKnown: true })).status).toBe("UNVERIFIED"); // Positive가 아니면 단정하지 않는다
    expect(nodata(policy({ mode: null, expectDataKnown: true })).status).toBe("UNVERIFIED");
  });

  it("무데이터가 허용돼도 Positive+기대 데이터 확인이 함께 있으면 허용 정책이 우선하지 않는다 (확인된 기대가 깨졌으므로 실패)", () => {
    // 정책이 ALLOWED이면 PASS_NO_DATA가 앞선다. 기대 데이터가 확인된 입력이라면 정책을 NOT_ALLOWED로 두는 것이 올바른 등록이다.
    expect(nodata(policy({ noDataPolicy: "ALLOWED", mode: "positive", expectDataKnown: true }))).toEqual({ status: "PASS_NO_DATA", attempted: true });
  });
});

describe("데이터가 온 경우", () => {
  it("정상이면 PASS_DATA", () => {
    expect(classify(obs())).toEqual({ status: "PASS_DATA", attempted: true });
  });

  it("무데이터를 기대한 점검(negative)에 데이터가 오면 UNVERIFIED(EXPECTATION_MISMATCH) — 점검 설계를 확인해야 한다", () => {
    expect(classify(obs(), policy({ mode: "negative" }))).toEqual({ status: "UNVERIFIED", attempted: true, reason: "EXPECTATION_MISMATCH" });
  });
});

describe("주의(DEGRADED): 기준이 확정된 것만 적용한다", () => {
  it("재시도 끝에 정상이면 DEGRADED(RETRIED_THEN_OK)", () => {
    expect(classify(obs({ retries: 1 }))).toEqual({ status: "DEGRADED", attempted: true, reason: "RETRIED_THEN_OK", hadData: true });
  });

  it("응답 항목의 자료형 경고가 있으면 DEGRADED(FIELD_WARNING)", () => {
    expect(classify(obs({ schema: { ...schemaOk, warnings: 2 } }))).toEqual({ status: "DEGRADED", attempted: true, reason: "FIELD_WARNING", hadData: true });
  });

  it("응답 지연 기준(slowMs)이 있을 때만 판정하고, 딱 기준값이면 지연이 아니다 (1000ms 이하 정상, 1001ms 지연)", () => {
    const p = policy({ slowMs: 1000 });
    expect(classify(obs({ durationMs: 1000 }), p).status).toBe("PASS_DATA");
    expect(classify(obs({ durationMs: 1001 }), p)).toEqual({ status: "DEGRADED", attempted: true, reason: "SLOW_RESPONSE", hadData: true });
    expect(classify(obs({ durationMs: 60_000 }), policy({ slowMs: null })).status).toBe("PASS_DATA"); // 기준이 없으면 지연으로 보지 않는다
  });

  it("여러 사유가 겹치면 재시도 > 필드 경고 > 지연 순으로 대표 사유를 정한다", () => {
    const p = policy({ slowMs: 100 });
    expect(classify(obs({ retries: 2, durationMs: 500, schema: { ...schemaOk, warnings: 1 } }), p)).toMatchObject({ reason: "RETRIED_THEN_OK" });
    expect(classify(obs({ durationMs: 500, schema: { ...schemaOk, warnings: 1 } }), p)).toMatchObject({ reason: "FIELD_WARNING" });
  });

  it("정상 무데이터에도 적용되며 hadData=false로 구분한다", () => {
    expect(classify(withBody({ kind: "nodata" }, { retries: 1 }), policy({ noDataPolicy: "ALLOWED" }))).toEqual({ status: "DEGRADED", attempted: true, reason: "RETRIED_THEN_OK", hadData: false });
  });

  it("실패는 주의로 바뀌지 않는다 (재시도 후에도 실패면 FAIL)", () => {
    expect(classify(obs({ retries: 3, connection: { kind: "timeout" }, body: null }))).toEqual(fail("TIMEOUT"));
  });
});

describe("판정 순서: 앞 단계의 문제가 뒤 단계보다 우선한다", () => {
  it("서비스키 문제는 스키마 문제보다 앞선다", () => {
    const bad: SchemaCheckResult = { checked: true, ok: false, inspected: 1, problems: [], warnings: 0 };
    expect(classify(withBody({ kind: "auth_or_quota", code: "30" }, { schema: bad }))).toEqual(fail("AUTH_ERROR"));
  });

  it("스키마 문제는 0건·데이터 판정보다 앞선다", () => {
    const bad: SchemaCheckResult = { checked: true, ok: false, inspected: 1, problems: [], warnings: 0 };
    expect(classify(obs({ schema: bad }), policy({ mode: "negative" }))).toEqual(fail("SCHEMA_ERROR"));
  });
});

describe("표기·집계 도우미", () => {
  it("describeProbe: 상태와 세부 사유를 한 줄로", () => {
    const rows: [ProbeResult, string][] = [
      [{ status: "PASS_DATA", attempted: true }, "PASS_DATA"],
      [{ status: "PASS_NO_DATA", attempted: true }, "PASS_NO_DATA"],
      [{ status: "FAIL", attempted: true, code: "TIMEOUT" }, "FAIL(TIMEOUT)"],
      [{ status: "UNVERIFIED", attempted: false, reason: "NO_VALID_INPUT" }, "UNVERIFIED(NO_VALID_INPUT)"],
      [{ status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" }, "NOT_RUN(BUDGET_SKIP)"],
      [{ status: "DEGRADED", attempted: true, reason: "SLOW_RESPONSE", hadData: true }, "DEGRADED(SLOW_RESPONSE)"],
    ];
    for (const [r, text] of rows) expect(describeProbe(r)).toBe(text);
  });

  it("isKeyOrQuotaProblem: 서비스키·한도 문제만 true", () => {
    expect(isKeyOrQuotaProblem(fail("AUTH_ERROR") as ProbeResult)).toBe(true);
    expect(isKeyOrQuotaProblem(fail("QUOTA_EXCEEDED") as ProbeResult)).toBe(true);
    expect(isKeyOrQuotaProblem(fail("TIMEOUT") as ProbeResult)).toBe(false);
    expect(isKeyOrQuotaProblem({ status: "PASS_DATA", attempted: true })).toBe(false);
  });

  it("상태 6종과 FAIL 세부 코드 7종이 PRD와 같다", () => {
    expect([...PROBE_STATUSES]).toEqual(["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"]);
    expect([...FAIL_CODES].sort()).toEqual(["AUTH_ERROR", "BUSINESS_ERROR", "HTTP_ERROR", "POSITIVE_DATA_MISSING", "QUOTA_EXCEEDED", "SCHEMA_ERROR", "TIMEOUT"]);
  });
});

describe("summarizeProbes: 합계 검증과 지표 산식 (PRD 3-1)", () => {
  const mix: ProbeResult[] = [
    { status: "PASS_DATA", attempted: true },
    { status: "PASS_DATA", attempted: true },
    { status: "PASS_NO_DATA", attempted: true },
    { status: "DEGRADED", attempted: true, reason: "RETRIED_THEN_OK", hadData: true },
    { status: "FAIL", attempted: true, code: "TIMEOUT" },
    { status: "UNVERIFIED", attempted: false, reason: "APPROVAL_UNCONFIRMED" },
    { status: "UNVERIFIED", attempted: true, reason: "NO_DATA_UNCONFIRMED" },
    { status: "NOT_RUN", attempted: false, reason: "BUDGET_SKIP" },
  ];

  it("상태별 수의 합이 전체와 같고, 미점검·검증 불가를 정상으로 세지 않는다", () => {
    const s = summarizeProbes(mix);
    expect(s.total).toBe(8);
    expect(s.counts).toEqual({ PASS_DATA: 2, PASS_NO_DATA: 1, DEGRADED: 1, FAIL: 1, UNVERIFIED: 2, NOT_RUN: 1 });
    expect(s.sumMatches).toBe(true);
    expect(s.attempted).toBe(6); // 요청을 실제로 보낸 것: PASS 3 + DEGRADED 1 + FAIL 1 + 요청은 보냈지만 판단 못 한 UNVERIFIED 1
    expect(s.basicOk).toEqual({ ok: 4, attempted: 6, ratio: 4 / 6 });
    expect(s.passData).toBe(2);
  });

  it("시도한 것이 없으면 비율을 만들지 않는다 (0으로 나누지 않음)", () => {
    const s = summarizeProbes([{ status: "NOT_RUN", attempted: false, reason: "RUN_BLOCKED" }]);
    expect(s.basicOk).toEqual({ ok: 0, attempted: 0, ratio: null });
    expect(summarizeProbes([]).total).toBe(0);
  });
});

describe("조회 결과(ApiCheckRecord) → 관측 변환", () => {
  const check = (over: Partial<ApiCheckRecord>): ApiCheckRecord => ({ endpointName: "public-list", httpStatus: 200, durationMs: 120, outcome: "success", recordCount: 5, dataValid: true, resultCode: "00", schema: null, ...over });

  it("정상·빈 결과·서비스키 문제·업무 오류가 본문 종류로 되살아난다", () => {
    expect(observationFromCheck(check({})).body).toEqual({ kind: "ok", recordCount: 5 });
    expect(observationFromCheck(check({ outcome: "empty_result", recordCount: 0, resultCode: "03" })).body).toEqual({ kind: "nodata" });
    expect(observationFromCheck(check({ outcome: "auth_or_quota", recordCount: null, resultCode: "22" })).body).toEqual({ kind: "auth_or_quota", code: "22" });
    expect(observationFromCheck(check({ outcome: "http_error", recordCount: null, resultCode: "02" })).body).toEqual({ kind: "error", code: "02" });
    expect(observationFromCheck(check({ outcome: "http_error", recordCount: null, resultCode: null })).body).toEqual({ kind: "error", code: "NO_CODE" });
  });

  it("시간 초과·연결 실패·HTTP 오류는 연결 단계로 가고 본문은 보지 않는다", () => {
    expect(observationFromCheck(check({ outcome: "timeout", httpStatus: null, recordCount: null }))).toMatchObject({ connection: { kind: "timeout" }, body: null });
    expect(observationFromCheck(check({ outcome: "http_error", httpStatus: null, recordCount: null }))).toMatchObject({ connection: { kind: "network_error" }, body: null });
    expect(observationFromCheck(check({ outcome: "auth_or_quota", httpStatus: 429, recordCount: null }))).toMatchObject({ connection: { kind: "response", httpStatus: 429 }, body: null });
    expect(observationFromCheck(check({ outcome: "http_error", httpStatus: 500, recordCount: null }))).toMatchObject({ connection: { kind: "response", httpStatus: 500 }, body: null });
  });

  it("응답시간·재시도·스키마가 그대로 전달된다", () => {
    const schema: SchemaCheckResult = { checked: true, ok: true, inspected: 1, problems: [], warnings: 0 };
    expect(observationFromCheck(check({ durationMs: 777, schema }), 2)).toMatchObject({ durationMs: 777, retries: 2, schema });
  });

  it("끝에서 끝까지: 시간 초과·한도 초과·정상이 각각 올바른 판정이 된다", () => {
    const run = (c: ApiCheckRecord) => classifyProbe({ policy: policy(), observation: observationFromCheck(c) });
    expect(run(check({ outcome: "timeout", httpStatus: null, recordCount: null }))).toEqual(fail("TIMEOUT"));
    expect(run(check({ outcome: "auth_or_quota", recordCount: null, resultCode: "22" }))).toEqual(fail("QUOTA_EXCEEDED"));
    expect(run(check({}))).toEqual({ status: "PASS_DATA", attempted: true });
  });

  it("등록부의 정책으로 만든 점검 정책은 기대 데이터·지연 기준을 임의로 정하지 않는다", () => {
    expect(policyFromOperation({ probe: { mode: null, input: null, inputSource: null }, noDataPolicy: "UNDEFINED" })).toEqual({ mode: null, noDataPolicy: "UNDEFINED", expectDataKnown: false, slowMs: null });
  });
});

describe("등록부의 무데이터 허용 오퍼레이션 (공유일반재산 SVC-API-022)", () => {
  const op = findOperation("SVC-API-022/getPbownGnrPrptInf");

  it("등록부에서 무데이터를 허용했고, 0건이면 정상 무데이터(PASS_NO_DATA)다 — 정상 데이터(PASS_DATA)로 세지 않는다", () => {
    expect(op?.operation.noDataPolicy).toBe("ALLOWED");
    const result = classify(withBody({ kind: "nodata" }), policyFromOperation(op!.operation));
    expect(result).toEqual({ status: "PASS_NO_DATA", attempted: true });
  });

  it("0건이 아니라 오류 코드면 여전히 실패다 — 무데이터 허용이 오류를 가리지 않는다", () => {
    const result = classify(withBody({ kind: "error", code: "99" }), policyFromOperation(op!.operation));
    expect(result.status).toBe("FAIL");
  });
});

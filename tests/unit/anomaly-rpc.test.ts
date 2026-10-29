// lib/anomalies/rpc.ts 단위 테스트 (PLAN 작업 26·27)
// 가짜 supabase 객체로 "DB 오류 메시지 → 화면용 결과" 변환과 rpc 인자 이름을 확인한다. DB에는 연결하지 않는다.
// (DB 함수 자체의 규칙은 supabase/tests/database/06_anomaly_user_functions.test.sql이 확인한다)
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGE, assignAnomaly, changeAnomalyStatus, parseActionError, setVerdict, type AnomalyActionErrorCode } from "@/lib/anomalies/rpc";

type RpcResponse = { data: unknown; error: { message?: string } | null };

// rpc가 어떤 이름·인자로 불렸는지 기록하고, 미리 정해 둔 응답을 돌려주는 가짜 supabase
function fakeSupabase(response: RpcResponse) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return response;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("parseActionError — DB 오류 메시지를 화면용 결과로", () => {
  const codes = Object.keys(ACTION_ERROR_MESSAGE).filter((c) => c !== "UNKNOWN") as AnomalyActionErrorCode[];

  it.each(codes.filter((c) => c !== "ACTIVE_DUPLICATE_EXISTS"))("%s 는 같은 코드와 안내 문구로 바뀐다", (code) => {
    const result = parseActionError(code);
    expect(result).toEqual({ ok: false, code, message: ACTION_ERROR_MESSAGE[code] });
    expect(result).not.toHaveProperty("duplicateId");
  });

  it("DB 함수가 내는 코드 10가지를 모두 다룬다", () => {
    expect([...codes].sort()).toEqual(
      ["ACTIVE_DUPLICATE_EXISTS", "ALREADY_ASSIGNED", "FORBIDDEN", "INVALID_ASSIGNEE", "INVALID_TRANSITION", "NOT_FOUND", "NOT_INVESTIGATING", "REASON_TOO_SHORT", "VERDICT_MISMATCH", "VERSION_CONFLICT"].sort(),
    );
  });

  it("ACTIVE_DUPLICATE_EXISTS:<번호> 에서 열린 건 번호(duplicateId)를 꺼낸다", () => {
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS:42")).toEqual({
      ok: false,
      code: "ACTIVE_DUPLICATE_EXISTS",
      message: ACTION_ERROR_MESSAGE.ACTIVE_DUPLICATE_EXISTS,
      duplicateId: 42,
    });
  });

  it("번호가 없거나 숫자가 아니면 duplicateId 없이 코드만 돌려준다", () => {
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS")).not.toHaveProperty("duplicateId");
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS:abc")).not.toHaveProperty("duplicateId");
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS:")).not.toHaveProperty("duplicateId");
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS:12abc")).not.toHaveProperty("duplicateId");
    expect(parseActionError("ACTIVE_DUPLICATE_EXISTS:-5")).not.toHaveProperty("duplicateId");
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(parseActionError("  VERSION_CONFLICT \n").code).toBe("VERSION_CONFLICT");
  });

  it("다른 코드에 붙은 ':값'은 duplicateId로 취급하지 않는다", () => {
    const result = parseActionError("FORBIDDEN:42");
    expect(result.code).toBe("FORBIDDEN");
    expect(result).not.toHaveProperty("duplicateId");
  });

  it("모르는 메시지는 UNKNOWN이고 원문(내부 정보)을 화면 문구에 싣지 않는다", () => {
    const raw = 'new row for relation "anomaly_events" violates check constraint "anomaly_events_note_length_check"';
    const result = parseActionError(raw);
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe(ACTION_ERROR_MESSAGE.UNKNOWN);
    expect(JSON.stringify(result)).not.toContain("anomaly_events");
    expect(JSON.stringify(result)).not.toContain("constraint");
  });

  it("비었거나 undefined이면 UNKNOWN", () => {
    expect(parseActionError(undefined).code).toBe("UNKNOWN");
    expect(parseActionError("").code).toBe("UNKNOWN");
  });
});

describe("assignAnomaly", () => {
  it("assign_anomaly를 p_id / p_assignee / p_expected_version 인자로 부른다", async () => {
    const { client, calls } = fakeSupabase({ data: 3, error: null });
    const result = await assignAnomaly(client, { id: 7, assigneeId: "11111111-1111-4111-8111-111111111111", expectedVersion: 2 });
    expect(calls).toEqual([{ fn: "assign_anomaly", args: { p_id: 7, p_assignee: "11111111-1111-4111-8111-111111111111", p_expected_version: 2 } }]);
    expect(result).toEqual({ ok: true, version: 3 });
  });

  it("DB 오류는 코드로 바뀐다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "ALREADY_ASSIGNED" } });
    const result = await assignAnomaly(client, { id: 1, assigneeId: "x", expectedVersion: 1 });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_ASSIGNED" });
  });
});

describe("setVerdict", () => {
  it("set_verdict를 p_id / p_verdict / p_expected_version 인자로 부른다", async () => {
    const { client, calls } = fakeSupabase({ data: 5, error: null });
    const result = await setVerdict(client, { id: 9, verdict: "false_positive", expectedVersion: 4 });
    expect(calls).toEqual([{ fn: "set_verdict", args: { p_id: 9, p_verdict: "false_positive", p_expected_version: 4 } }]);
    expect(result).toEqual({ ok: true, version: 5 });
  });

  it("NOT_INVESTIGATING·VERSION_CONFLICT 오류를 매핑한다", async () => {
    const a = await setVerdict(fakeSupabase({ data: null, error: { message: "NOT_INVESTIGATING" } }).client, { id: 1, verdict: "confirmed_issue", expectedVersion: 1 });
    const b = await setVerdict(fakeSupabase({ data: null, error: { message: "VERSION_CONFLICT" } }).client, { id: 1, verdict: "confirmed_issue", expectedVersion: 1 });
    expect(a).toMatchObject({ ok: false, code: "NOT_INVESTIGATING" });
    expect(b).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
  });
});

describe("changeAnomalyStatus", () => {
  it("change_anomaly_status를 p_id / p_to_status / p_verdict / p_note / p_expected_version 인자로 부른다", async () => {
    const { client, calls } = fakeSupabase({ data: 6, error: null });
    const result = await changeAnomalyStatus(client, { id: 3, toStatus: "resolved", verdict: "confirmed_issue", note: "담당 부서에 수정 요청함", expectedVersion: 5 });
    expect(calls).toEqual([
      { fn: "change_anomaly_status", args: { p_id: 3, p_to_status: "resolved", p_verdict: "confirmed_issue", p_note: "담당 부서에 수정 요청함", p_expected_version: 5 } },
    ]);
    expect(result).toEqual({ ok: true, version: 6 });
  });

  it("판정·사유를 안 주면 null로 보낸다 (검토 시작)", async () => {
    const { client, calls } = fakeSupabase({ data: 2, error: null });
    await changeAnomalyStatus(client, { id: 3, toStatus: "investigating", expectedVersion: 1 });
    expect(calls[0].args).toEqual({ p_id: 3, p_to_status: "investigating", p_verdict: null, p_note: null, p_expected_version: 1 });
  });

  it("ACTIVE_DUPLICATE_EXISTS:<번호> 오류에서 duplicateId를 돌려준다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "ACTIVE_DUPLICATE_EXISTS:88" } });
    const result = await changeAnomalyStatus(client, { id: 3, toStatus: "investigating", note: "다시 살펴보기 위해 재개", expectedVersion: 1 });
    expect(result).toMatchObject({ ok: false, code: "ACTIVE_DUPLICATE_EXISTS", duplicateId: 88 });
  });

  it("모르는 오류는 UNKNOWN이고 원문이 결과에 없다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: 'permission denied for function change_anomaly_status' } });
    const result = await changeAnomalyStatus(client, { id: 3, toStatus: "investigating", expectedVersion: 1 });
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN" });
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });

  it("숫자 문자열 응답도 버전으로 받는다", async () => {
    const { client } = fakeSupabase({ data: "4", error: null });
    expect(await changeAnomalyStatus(client, { id: 1, toStatus: "investigating", expectedVersion: 3 })).toEqual({ ok: true, version: 4 });
  });

  it("버전이 정수가 아닌 응답은 성공으로 보지 않는다", async () => {
    for (const data of [undefined, "abc", 1.5]) {
      const { client } = fakeSupabase({ data, error: null });
      expect(await changeAnomalyStatus(client, { id: 1, toStatus: "investigating", expectedVersion: 1 })).toMatchObject({ ok: false, code: "UNKNOWN" });
    }
  });
});

// 홈페이지(WEB) 이상징후 근거 표시 변환 시험 (W14)
import { describe, expect, it } from "vitest";
import { webEvidenceView } from "@/lib/anomalies/web-evidence";

const evidence = { verdict: "FAIL", reason: "HTTP_5XX", incident_no: 3, started_at: "2026-11-05T03:07:00.000Z", trigger_run_id: 5001 };

describe("webEvidenceView", () => {
  it("사건 번호·시작(KST)·확정 판정·사유와 관련 점검 번호를 한국어로 만든다", () => {
    const v = webEvidenceView(evidence);
    const by = Object.fromEntries(v.lines.map((l) => [l.label, l.value]));
    expect(by["사건 번호"]).toBe("3번");
    expect(by["사건 시작 (KST)"]).toBe("2026-11-05 12:07:00"); // UTC 03:07 → KST 12:07
    expect(by["확정 판정"]).toBe("실패");
    expect(by["사유"]).toBe("서버 오류(5xx)");
    expect(v.runId).toBe(5001);
  });

  it("모르는 판정·사유는 원래 값을 보여 준다", () => {
    const v = webEvidenceView({ ...evidence, verdict: "NEW_V", reason: "NEW_R" });
    const by = Object.fromEntries(v.lines.map((l) => [l.label, l.value]));
    expect(by["확정 판정"]).toBe("NEW_V");
    expect(by["사유"]).toBe("NEW_R");
  });

  it("점검 번호가 문자열 숫자여도 읽고, 이상한 값(0·음수·숫자 아님·너무 큼)은 링크를 만들지 않는다", () => {
    expect(webEvidenceView({ trigger_run_id: "42" }).runId).toBe(42);
    for (const bad of [0, -1, "abc", "0", "1.5", 1.5, null, undefined, "9".repeat(30), {}]) expect(webEvidenceView({ trigger_run_id: bad }).runId, String(bad)).toBeNull();
  });

  it("근거가 비었거나 JSON 모양이 아니어도 멈추지 않는다", () => {
    for (const bad of [null, undefined, "x", 3, [], {}]) expect(webEvidenceView(bad)).toEqual({ lines: [], runId: null });
  });

  it("__proto__ 같은 이름의 판정·사유는 라벨 표에서 찾지 않고 그대로 보여 준다", () => {
    const v = webEvidenceView({ verdict: "toString", reason: "constructor" });
    expect(v.lines.map((l) => l.value)).toEqual(["toString", "constructor"]);
  });
});

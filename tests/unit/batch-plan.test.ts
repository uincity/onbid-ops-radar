// 서비스 단위 배치 계획 시험 (PRD R04) — 등록부를 서비스별로 묶고, 조회기가 없는 오퍼레이션에 검증 불가 사유를 붙인다
import { describe, expect, it } from "vitest";
import { buildBatches, unprobeableOperations } from "@/lib/checks/batch-plan";
import { PUBLIC_ENDPOINT_OPERATIONS } from "@/lib/checks/public-fetcher";
import { allOperations } from "@/lib/registry";

describe("buildBatches", () => {
  const batches = buildBatches(PUBLIC_ENDPOINT_OPERATIONS);
  const ops = batches.flatMap((b) => b.operations);

  it("서비스마다 배치 1개, 등록부의 오퍼레이션을 하나도 빠뜨리지 않는다", () => {
    expect(batches.length).toBe(new Set(allOperations().map((o) => o.service.serviceId)).size);
    expect(ops).toHaveLength(allOperations().length);
    for (const b of batches) expect(b.operations.every((o) => o.serviceId === b.serviceId)).toBe(true);
  });

  it("조회기가 있는 오퍼레이션만 endpoint를 갖는다 (지금은 목록·상세 2개)", () => {
    expect(ops.filter((o) => o.endpoint).map((o) => [o.endpoint, o.key])).toEqual([
      ["public-list", "SVC-API-001/getRlstCltrList"],
      ["public-detail", "SVC-API-004/getRlstDtlInf"],
    ]);
    expect(ops.filter((o) => o.endpoint).every((o) => o.notReadyReason === null)).toBe(true);
  });

  it("조회기가 없는 오퍼레이션은 사유가 있고, 승인이 확인되지 않은 것은 APPROVAL_UNCONFIRMED 또는 입력값 없음이다", () => {
    const rest = unprobeableOperations(batches);
    expect(rest).toHaveLength(ops.length - 2);
    expect(rest.every((o) => ["APPROVAL_UNCONFIRMED", "NO_VALID_INPUT"].includes(o.notReadyReason))).toBe(true);
  });

  it("조회기 목록이 비면 모든 오퍼레이션이 요청 대상이 아니다", () => {
    expect(unprobeableOperations(buildBatches({}))).toHaveLength(allOperations().length);
  });
});

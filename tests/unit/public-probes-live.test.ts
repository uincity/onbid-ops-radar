// 일반 조회기로 점검하는 추가 오퍼레이션 13개(1단계 9개 + 2단계 4개)를 "진짜 온비드 OpenAPI"에 한 번씩 불러 보는 시험 (R04 확장)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run test:public-probes`로만 실행한다 (.env의 DATA_GO_KR_SERVICE_KEY 필요).
// 호출은 딱 13번이다(오퍼레이션마다 1번, 1건만 요청). 읽기 전용 GET이고 DB에는 아무것도 쓰지 않는다.
// 서비스키·주소는 출력하지 않는다. 판정과 응답 구조 요약(건수·필수 항목 누락 수)만 보여 준다. 응답 값은 출력하지 않는다.
import { describe, expect, it } from "vitest";
import { genericProbeTargets } from "@/lib/checks/generic-probe";
import { classifyProbe } from "@/lib/checks/probe/classify";
import { observationFromCheck, policyFromOperation } from "@/lib/checks/probe/from-check";
import { describeProbe } from "@/lib/checks/probe/status";
import { createPublicFetcher } from "@/lib/checks/public-fetcher";
import { findOperation } from "@/lib/registry";
import { DEFAULT_SETTING_VALUES } from "@/lib/settings/schema";

const live = process.env.LIVE_PUBLIC === "1" && !!process.env.DATA_GO_KR_SERVICE_KEY;

describe.skipIf(!live)("추가 오퍼레이션 13개 + 실제 온비드 OpenAPI (호출 13번)", () => {
  it("오퍼레이션마다 1번씩 불러 판정을 확인한다", async () => {
    const targets = genericProbeTargets(new Date());
    expect(targets).toHaveLength(13);
    const fetcher = createPublicFetcher({ serviceKey: process.env.DATA_GO_KR_SERVICE_KEY!, timeoutSeconds: DEFAULT_SETTING_VALUES.api_timeout_seconds, extraOperations: targets });

    const rows: string[] = [];
    let authProblem = false;
    for (const target of targets) {
      if (authProblem) {
        rows.push(`${target.operationKey} | 호출 안 함 (앞에서 서비스키·한도 문제)`);
        continue;
      }
      const result = await fetcher(target.endpoint, { remainingCalls: 1, remainingMs: 60_000 });
      const op = findOperation(target.operationKey)!;
      const probe = classifyProbe({ policy: policyFromOperation(op.operation), observation: observationFromCheck(result) });
      const schema = result.schema;
      rows.push(
        `${target.operationKey} | ${describeProbe(probe)} | HTTP=${result.httpStatus} 코드=${result.resultCode ?? "-"} ${result.durationMs}ms | 건수=${result.recordCount ?? "-"} | 응답 구조: ${schema?.checked ? `필수 누락 ${schema.problems.length}종, 자료형 경고 ${schema.warnings}` : "확인할 항목 없음"}`,
      );
      if (result.outcome === "auth_or_quota") authProblem = true;
    }
    console.log(`\n${rows.join("\n")}\n`);
    // 서비스키·한도 문제가 아닌지만 시험 통과 조건으로 본다. 개별 오퍼레이션의 FAIL·UNVERIFIED는 "점검이 알려 주는 결과"이므로 실패로 보지 않는다
    expect(authProblem, "서비스키·호출 한도 문제").toBe(false);
  }, 120_000);
});

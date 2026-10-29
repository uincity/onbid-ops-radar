// Design Ref: PRD 5-2-3, 부록 E-3(R04) — 같은 오퍼레이션의 점검이 연속으로 FAIL이면 API 상태 이상징후(API_<코드>)를 만든다
// 한 번의 실패는 일시 오류일 수 있어 이상징후로 만들지 않는다. 연속 횟수는 설정값(api_fail_streak_threshold)이 정한다.
// 순수 함수다. DB를 모른다.
import { createHash } from "node:crypto";
import type { API_RULE_IDS } from "@/lib/anomalies/labels";
import type { FailCode, ProbeStatus } from "./probe/status";

type ApiRuleId = (typeof API_RULE_IDS)[number];

// probe_results에서 읽은 과거 판정 한 줄 (가장 최근 것이 먼저)
export type ProbeHistoryRow = { status: ProbeStatus; reason: string | null };

// 서비스키·호출 한도 문제는 API 자체의 장애가 아니라서 연속 실패에 세지 않고, 연속을 끊지도 않는다 (PRD 5-2-3)
const NOT_API_FAULT: readonly string[] = ["AUTH_ERROR", "QUOTA_EXCEEDED"];

export type FailStreak = { count: number; code: FailCode | null };

// 가장 최근 판정부터 거슬러 올라가며 연속 FAIL을 센다.
// - 검증 불가(UNVERIFIED)·미점검(NOT_RUN)·서비스키/한도 FAIL: 건너뛴다 (정상으로도 실패로도 세지 않음)
// - 정상(PASS_*)·주의(DEGRADED): 연속이 끊긴다
export function countFailStreak(historyNewestFirst: readonly ProbeHistoryRow[]): FailStreak {
  let count = 0;
  let code: FailCode | null = null;
  for (const row of historyNewestFirst) {
    if (row.status === "UNVERIFIED" || row.status === "NOT_RUN") continue;
    if (row.status === "FAIL") {
      if (row.reason && NOT_API_FAULT.includes(row.reason)) continue;
      count += 1;
      code ??= row.reason as FailCode; // 가장 최근 실패의 세부 코드
      continue;
    }
    break;
  }
  return { count, code };
}

export type ApiDetection = { ruleId: ApiRuleId; itemKey: string; evidence: Record<string, unknown>; valueHash: string };

// 연속 실패가 기준 이상이면 등록할 이상징후를, 아니면 null을 돌려준다. 식별값은 "서비스ID/오퍼레이션ID" (R03 결정)
export function buildApiDetection(apiId: string, operationId: string, streak: FailStreak, threshold: number): ApiDetection | null {
  if (streak.code === null || streak.count < threshold) return null;
  const itemKey = `${apiId}/${operationId}`;
  const ruleId = `API_${streak.code}` as ApiRuleId;
  return {
    ruleId,
    itemKey,
    evidence: {
      rule: ruleId,
      apiId,
      operationId,
      issueCode: streak.code,
      consecutiveFailures: streak.count,
      threshold,
      note: "우리 점검 요청에 관측된 결과이며, 온비드 서버 전체의 상태를 뜻하지 않습니다.",
    },
    // 같은 오퍼레이션·같은 실패 코드면 같은 지문: 담당자가 정상 판정한 건과 같은 상황인지 비교하는 데 쓴다. 연속 횟수는 섞지 않는다
    valueHash: createHash("sha256").update(`${ruleId}|${itemKey}`).digest("hex"),
  };
}

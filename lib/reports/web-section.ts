// Design Ref: docs/design-homepage-monitoring.md §4.7 / §5.8 — 일일 점검보고서의 "홈페이지 모니터링" 절 (순수 함수)
// DB 함수 web_summarize_day가 이미 센 숫자를 받아 가용률 식과 모델만 만든다. 기존 OpenAPI 요약(summarizeProbes)은 저하를 정상으로 세므로 쓰지 않는다.
import { z } from "zod";

const count = z.number().int().min(0);

export const webReportSchema = z.object({
  // 집계를 읽지 못했으면 true (보고서 전체를 막지 않고 이 절만 "불러오지 못함"으로 적는다)
  unavailable: z.boolean(),
  targets: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      passData: count,
      passNoData: count,
      degraded: count,
      fail: count,
      unverified: count,
      notRun: count,
      planned: count,
      unplanned: count,
      flap: count,
      confirmedDown: count,
      downSeconds: count,
      avgMs: z.number().nullable(),
      maxMs: z.number().nullable(),
      avail: z.object({ num: count, den: count }), // 가용률 분자·분모 (비율은 보여 줄 때 계산)
    }),
  ),
  anomalies: z.array(z.object({ id: z.number().int(), status: z.string(), ruleId: z.string() })),
});

export type WebReport = z.infer<typeof webReportSchema>;

/** web_summarize_day가 돌려주는 한 줄 (DB 열 이름 그대로) */
export type WebDayRow = {
  target_key: string;
  pass_data: number;
  pass_no_data: number;
  degraded: number;
  fail: number;
  unverified: number;
  not_run: number;
  planned_count: number;
  unplanned_count: number;
  flap_count: number;
  confirmed_down_count: number;
  down_seconds: number;
  avg_ms: number | null;
  max_ms: number | null;
};

/**
 * 가용률 = 정상 계열(정상+정상(데이터 없음)) ÷ (판정 횟수 − 확인 불가 − 미점검 − 계획 점검 − 미등록 점검). 저하는 정상 계열이 아니다.
 * 판정 횟수 = 여섯 판정의 합이므로 분모는 정상+저하+실패에서 계획·미등록 점검을 뺀 값이다.
 * 한계: 계획 점검 중 정상으로 끝난 칸은 DB가 따로 세지 않아 분자에서 못 뺀다(드묾). 분자가 분모보다 커지지 않게만 막는다.
 */
export function availabilityOf(r: Pick<WebDayRow, "pass_data" | "pass_no_data" | "degraded" | "fail" | "unverified" | "not_run" | "planned_count" | "unplanned_count">): { num: number; den: number } {
  const judged = r.pass_data + r.pass_no_data + r.degraded + r.fail + r.unverified + r.not_run;
  const den = Math.max(0, judged - r.unverified - r.not_run - r.planned_count - r.unplanned_count);
  const num = Math.min(r.pass_data + r.pass_no_data, den);
  return { num, den };
}

export function buildWebReport(input: {
  rows: readonly WebDayRow[];
  labelOf: (key: string) => string;
  anomalies: ReadonlyArray<{ id: number; status: string; rule_id: string }>;
}): WebReport {
  return {
    unavailable: false,
    targets: input.rows.map((r) => ({
      key: r.target_key,
      label: input.labelOf(r.target_key),
      passData: r.pass_data,
      passNoData: r.pass_no_data,
      degraded: r.degraded,
      fail: r.fail,
      unverified: r.unverified,
      notRun: r.not_run,
      planned: r.planned_count,
      unplanned: r.unplanned_count,
      flap: r.flap_count,
      confirmedDown: r.confirmed_down_count,
      downSeconds: r.down_seconds,
      avgMs: r.avg_ms,
      maxMs: r.max_ms,
      avail: availabilityOf(r),
    })),
    anomalies: input.anomalies.map((a) => ({ id: a.id, status: a.status, ruleId: a.rule_id })),
  };
}

export const unavailableWebReport = (): WebReport => ({ unavailable: true, targets: [], anomalies: [] });

/** 판정 횟수(정시 점검 수): 여섯 판정의 합 */
export const judgedCount = (t: WebReport["targets"][number]) => t.passData + t.passNoData + t.degraded + t.fail + t.unverified + t.notRun;

/** 지속 시간을 사람이 읽는 말로: 3600초 단위 → "약 2시간", 0이면 "없음" */
export function downText(seconds: number): string {
  if (seconds <= 0) return "없음";
  const h = Math.round(seconds / 360) / 10; // 0.1시간 단위
  return `약 ${Number.isInteger(h) ? h : h.toFixed(1)}시간`;
}

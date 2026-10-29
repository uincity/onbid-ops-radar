// 일일 점검보고서의 "모델"(보고서에 들어가는 숫자와 표를 담은 값)과 그 모양 검사.
// 이 모델은 reports.summary(JSON)에 그대로 저장되고, 화면 미리보기가 저장된 값을 다시 읽어 그린다.
// 브라우저·서버·테스트 어디서나 쓸 수 있도록 순수한 코드만 둔다.
import { z } from "zod";

// 미처리 이상징후를 보고서에 최대 몇 건까지 보여 줄지 (넘으면 "외 N건")
export const UNRESOLVED_LIMIT = 50;

// reports.summary는 DB가 20000바이트까지만 허용한다(JSON 글자 사이 공백이 늘어나는 것까지 고려해 여유를 둔다)
export const SUMMARY_MAX_BYTES = 15000;

const count = z.number().int().min(0);

export const reportModelSchema = z.object({
  version: z.literal(1),
  reportDate: z.string(), // KST 날짜 YYYY-MM-DD
  source: z.enum(["DEMO", "PUBLIC"]),
  generatedAt: z.string(), // ISO 시각
  coversUntil: z.string(), // 집계한 마지막 시각 (ISO)
  partialDay: z.boolean(), // true면 "오늘 보고서: 생성 시각까지 집계"
  baselineAt: z.string().nullable(), // 점검 기준 시각: 그날 마지막으로 성공한 실행이 데이터를 수집한 시각
  hasActivity: z.boolean(), // 그날 점검·탐지 기록이 하나라도 있는지
  api: z.object({
    total: count,
    success: count,
    httpError: count,
    timeout: count,
    authOrQuota: count,
    emptyResult: count,
    avgMs: z.number().nullable(),
    maxMs: z.number().nullable(),
  }),
  runs: z.object({ total: count, byStatus: z.record(z.string(), count) }),
  validation: z.object({ collectedCount: count, newByRule: z.record(z.string(), count) }),
  anomalies: z.object({
    newCount: count,
    recurredCount: count,
    closedCount: count,
    resolvedCount: count,
    dismissedCount: count,
    byStatus: z.record(z.string(), count),
  }),
  unresolved: z.object({
    total: count,
    omitted: count,
    rows: z.array(
      z.object({
        id: z.number().int(),
        ruleId: z.string(),
        itemKey: z.string(),
        status: z.string(),
        assignee: z.string().nullable(),
        firstDetectedAt: z.string(),
        lastDetectedAt: z.string(),
      }),
    ),
  }),
  skipReasons: z.array(z.object({ code: z.string(), count, sample: z.string() })),
  generationMs: z.number().int().min(0).optional(), // 보고서를 만드는 데 걸린 시간(밀리초)
});

export type ReportModel = z.infer<typeof reportModelSchema>;
export type UnresolvedRow = ReportModel["unresolved"]["rows"][number];

// 저장된 summary가 우리 모델 모양인지 확인한다. 아니면 null (화면이 깨지지 않게)
export function parseReportModel(value: unknown): ReportModel | null {
  const parsed = reportModelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// JSON으로 만들었을 때의 바이트 수 (한글은 글자당 3바이트)
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// 다운로드 파일 이름: 날짜와 출처만 쓴다. 예: daily-report-2026-10-29-DEMO.md
export function reportFileName(reportDate: string, source: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : "unknown-date";
  const safeSource = source === "PUBLIC" ? "PUBLIC" : "DEMO";
  return `daily-report-${safeDate}-${safeSource}.md`;
}

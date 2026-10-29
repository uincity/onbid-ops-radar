// 보고서 모델 → Markdown 문자열 (순수 함수). 같은 모델이면 항상 같은 글이 나온다.
import { RULE_LABEL, RUN_STATUS_LABEL, STATUS_LABEL, labelOf } from "@/lib/anomalies/labels";
import { formatKst } from "@/lib/time";
import type { ReportModel } from "./model";

// 표 칸 안에 들어가도 표가 깨지지 않게 한다: 역슬래시·세로줄(|)을 막고, 줄바꿈은 공백으로, 꺾쇠는 문자로 바꾼다
export function escapeMarkdownCell(text: string): string {
  return text
    .replace(/\r?\n|\r/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const kst = (iso: string) => `${formatKst(new Date(iso))} KST`;
const num = (n: number) => n.toLocaleString("en-US");
const ms = (n: number | null) => (n === null ? "-" : `${num(n)} ms`);

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

export const NO_RECORD_MESSAGE = "해당 날짜 점검 기록이 없습니다";

export function renderReportMarkdown(m: ReportModel): string {
  const sourceNote = m.source === "DEMO" ? "DEMO (교육용 가상 데이터)" : "PUBLIC (공공데이터포털 공개 API)";
  const range = m.partialDay
    ? `${m.reportDate} 00:00 ~ ${kst(m.coversUntil)} (오늘 보고서: 생성 시각까지 집계)`
    : `${m.reportDate} 00:00 ~ 24:00 KST`;

  const out: string[] = [];
  out.push(`# 일일 점검보고서 ${m.reportDate} (${m.source})`, "");
  out.push(`- 보고 날짜: ${m.reportDate}`);
  out.push(`- 데이터 출처: ${sourceNote}`);
  out.push(`- 집계 범위: ${range}`);
  out.push(`- 점검 기준 시각: ${m.baselineAt ? kst(m.baselineAt) : "없음 (그날 성공한 점검 실행이 없습니다)"}`);
  out.push(`- 보고서 생성 시각: ${kst(m.generatedAt)}`, "");

  if (!m.hasActivity) out.push(`> ${NO_RECORD_MESSAGE}.`, "");

  out.push("## 1. API 점검 요약", "");
  out.push(
    ...table(
      ["항목", "값"],
      [
        ["API 호출 수", num(m.api.total)],
        ["성공", num(m.api.success)],
        ["HTTP 오류", num(m.api.httpError)],
        ["타임아웃", num(m.api.timeout)],
        ["서비스키·한도 문제", num(m.api.authOrQuota)],
        ["빈 결과", num(m.api.emptyResult)],
        ["평균 응답시간", ms(m.api.avgMs)],
        ["최대 응답시간", ms(m.api.maxMs)],
      ],
    ),
    "",
  );

  out.push("## 2. 점검 실행 요약", "");
  const runRows = Object.entries(m.runs.byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => [escapeMarkdownCell(labelOf(RUN_STATUS_LABEL, status)), num(n)]);
  out.push(...table(["상태", "횟수"], [["전체 실행", num(m.runs.total)], ...runRows]), "");

  out.push("## 3. 데이터 검증 결과", "");
  out.push(`- 검사한 수집 데이터: ${num(m.validation.collectedCount)}건`, "");
  out.push(
    ...table(
      ["탐지 규칙", "신규 이상징후"],
      Object.entries(m.validation.newByRule).map(([rule, n]) => [escapeMarkdownCell(labelOf(RULE_LABEL, rule)), num(n)]),
    ),
    "",
  );

  const a = m.anomalies;
  out.push("## 4. 이상징후 발생·처리 현황", "");
  out.push(
    ...table(
      ["항목", "건수"],
      [
        ["그날 신규", num(a.newCount)],
        ["그날 재발 (이전에 종결된 건이 다시 탐지됨)", num(a.recurredCount)],
        ["그날 종결 (조치 완료 + 정상 판정)", num(a.closedCount)],
        ["종결 중 조치 완료", num(a.resolvedCount)],
        ["종결 중 정상 판정", num(a.dismissedCount)],
      ],
    ),
    "",
  );
  out.push("처리상태별 현황 (생성 시점의 현재 상태):", "");
  out.push(...table(["처리상태", "건수"], Object.entries(a.byStatus).map(([s, n]) => [escapeMarkdownCell(labelOf(STATUS_LABEL, s)), num(n)])), "");

  out.push("## 5. 미처리 이상징후 (미확인·검토 중)", "");
  if (m.unresolved.total === 0) {
    out.push("미처리 이상징후가 없습니다.", "");
  } else {
    out.push(`처음 탐지된 시각이 오래된 순서입니다. 전체 ${num(m.unresolved.total)}건.`, "");
    out.push(
      ...table(
        ["번호", "규칙", "물건", "상태", "담당자", "최근 탐지"],
        m.unresolved.rows.map((r) => [
          `#${r.id}`,
          escapeMarkdownCell(labelOf(RULE_LABEL, r.ruleId)),
          escapeMarkdownCell(r.itemKey),
          escapeMarkdownCell(labelOf(STATUS_LABEL, r.status)),
          r.assignee ? escapeMarkdownCell(r.assignee) : "-",
          kst(r.lastDetectedAt),
        ]),
      ),
      "",
    );
    if (m.unresolved.omitted > 0) out.push(`외 ${num(m.unresolved.omitted)}건`, "");
  }

  out.push("## 6. 점검 메모 (비교 제외 사유 등)", "");
  if (m.skipReasons.length === 0) {
    out.push("기록된 메모가 없습니다.", "");
  } else {
    out.push(...table(["코드", "건수", "예시"], m.skipReasons.map((s) => [escapeMarkdownCell(s.code), num(s.count), escapeMarkdownCell(s.sample)])), "");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

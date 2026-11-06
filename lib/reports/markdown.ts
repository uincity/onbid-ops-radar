// 보고서 모델 → Markdown 문자열 (순수 함수). 같은 모델이면 항상 같은 글이 나온다.
import { RULE_LABEL, RUN_STATUS_LABEL, STATUS_LABEL, labelOf } from "@/lib/anomalies/labels";
import { FAIL_CODE_LABEL, PROBE_STATUS_LABEL, PROBE_STATUSES } from "@/lib/checks/probe/status";
import { REASON_LABEL } from "@/lib/availability/summary";
import { formatKst } from "@/lib/time";
import type { ReportModel } from "./model";
import { downText, judgedCount } from "./web-section";

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

const pct = (r: { num: number; den: number }) => (r.den > 0 ? `${((r.num / r.den) * 100).toFixed(1)}% (${num(r.num)} / ${num(r.den)})` : `비율 없음 (${num(r.num)} / ${num(r.den)})`);
const reasonOf = (code: string | null) => (code === null ? "-" : escapeMarkdownCell(REASON_LABEL[code] ?? FAIL_CODE_LABEL[code as keyof typeof FAIL_CODE_LABEL] ?? code));
const listOf = (map: Record<string, number>) =>
  Object.entries(map)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${reasonOf(c)} ${num(n)}`)
    .join(", ") || "없음";

// PUBLIC 보고서의 26종 가용성 절. 우리 점검 요청 기준이라는 점과 미점검·검증 불가를 정상으로 세지 않는다는 점을 항상 적는다.
function renderAvailability(a: NonNullable<ReportModel["availability"]>): string[] {
  const out: string[] = ["## 7. 온비드 OpenAPI 가용성 (PUBLIC)", ""];
  out.push("> 우리 점검 요청에 관측된 결과이며, 온비드 서버 전체의 가용성·호출량·원천 데이터 건수를 뜻하지 않습니다. 검증 불가·미점검은 정상으로도 실패로도 세지 않습니다. DEMO 결과는 포함하지 않습니다.", "");
  out.push(`- 관리 대상: 목표 ${num(a.registry.target)}종 · 등록 확인 ${num(a.registry.registered)}종 · 미확정 ${num(a.registry.unconfirmed)}종 · 오퍼레이션 ${num(a.registry.operations)}개`);
  out.push(`- 가장 최근 판정 시각: ${a.lastCheckedAt ? `${a.lastCheckedAt} KST` : "점검 기록 없음"} (서비스 전체 점검 완료 시각과 다른 값입니다)`);
  out.push(`- 점검 준비 상태: 준비됨 ${num(a.ready.ready)}개 · 준비 안 됨 ${num(a.ready.notReady)}개`, "");
  const total = PROBE_STATUSES.reduce((sum, s) => sum + (a.counts[s] ?? 0), 0);
  out.push(
    ...table(["판정", "오퍼레이션 수"], [...PROBE_STATUSES.map((s) => [PROBE_STATUS_LABEL[s], num(a.counts[s] ?? 0)]), ["합계", `${num(total)} ${total === a.registry.operations ? "(일치)" : "(불일치: 집계 오류 확인 필요)"}`]]),
    "",
  );
  out.push(
    ...table(
      ["지표", "값"],
      [
        ["점검 시도율 (요청을 보낸 수 / 준비된 수)", pct(a.attemptRate)],
        ["기본 정상 비율 (정상 / 실제 시도한 수)", pct(a.basicOk)],
        ["실데이터 검증률 (실데이터 확인 / Positive 점검 등록)", pct({ num: a.realData.passData, den: a.realData.positiveRegistered })],
        ["전체 목표 대비 검증률 (모든 오퍼레이션이 실데이터 확인된 서비스 / 목표)", pct(a.serviceCoverage)],
      ],
    ),
    "",
  );
  out.push(`- 검증 불가 사유: ${listOf(a.reasons.unverified)}`);
  out.push(`- 미점검 사유: ${listOf(a.reasons.notRun)} (점검 기록 없음 ${num(a.noRecord)}개 포함)`);
  out.push(`- 실패 구분: ${listOf(a.failByCode)}`, "");
  out.push(
    ...table(
      ["오퍼레이션", "판정", "사유", "마지막 정상 응답"],
      a.operations.map((o) => [escapeMarkdownCell(o.key), escapeMarkdownCell(PROBE_STATUS_LABEL[o.status as keyof typeof PROBE_STATUS_LABEL] ?? o.status), reasonOf(o.reason), o.lastOkAt ? `${o.lastOkAt} KST` : "-"]),
    ),
    "",
  );
  return out;
}

// 규칙 이름 옆 표기: 품질 이상징후는 담당자가 확인하기 전까지 의심이다
const QUALITY_TARGET_UNIT: Record<string, string> = { DQ_SCHEMA: "개 오퍼레이션", DQ_REQUIRED: "건", DQ_LIST_DETAIL_REF: "건", DQ_CROSS_API_REF: "건" };

// PUBLIC 보고서의 데이터 품질 규칙 적용 현황 절
function renderQuality(q: NonNullable<ReportModel["quality"]>): string[] {
  const out: string[] = ["## 8. 데이터 품질 규칙 적용 현황 (PUBLIC)", ""];
  out.push("> 데이터 품질 이상징후는 담당자가 확인하기 전까지 **의심**이며 확정된 오류가 아닙니다. 우리 점검 요청에 관측된 결과이며 온비드 전체의 데이터 품질을 뜻하지 않습니다.", "");
  out.push(`- 적용 대상: 요청을 보낸 오퍼레이션 ${num(q.applicableApis)}개 · 수집·검사한 데이터 ${num(q.collectedItems)}건`, "");
  out.push(
    ...table(
      ["규칙", "적용 대상", "신규 의심 건수"],
      q.rules.map((r) => [escapeMarkdownCell(labelOf(RULE_LABEL, r.ruleId)), r.targets === null ? "적용 제외 (연결해서 비교할 API 점검 없음)" : `${num(r.targets)}${QUALITY_TARGET_UNIT[r.ruleId] ?? ""}`, num(r.suspected)]),
    ),
    "",
  );
  out.push(`- 판정 보류: ${num(q.deferred)}건 (상세 조회 결과가 없어 정상 종료·철회 등과 구분할 수 없는 물건. 이상징후로 만들지 않음)`);
  out.push(`- 적용 제외된 점검 실행: ${num(q.notApplicableRuns)}회 (교차 참조 규칙)`, "");
  return out;
}

// 실행 품질 절 (DEMO·PUBLIC 공통)
function renderExecution(e: NonNullable<ReportModel["execution"]>, no: number): string[] {
  const out: string[] = [`## ${no}. 실행 품질`, ""];
  out.push(`- 예약 점검(KST 08:00): ${escapeMarkdownCell(e.scheduleTitle)} (${e.scheduleState}) · 그날 시작한 예약 점검 ${num(e.scheduledRunCount)}회`);
  out.push(`- 마지막으로 끝난 점검 실행: ${e.lastFinishedAt ? kst(e.lastFinishedAt) : "없음"} (서비스 전체 점검 완료 시각이며 API별 마지막 성공 시각과 다릅니다)`);
  out.push(`- 마지막으로 정상 완료된 점검 실행: ${e.lastSucceededAt ? kst(e.lastSucceededAt) : "없음"}`);
  out.push("- 차단·일부 완료·미점검의 횟수와 사유는 위 2절(점검 실행 요약)과 6절(점검 메모)을 보세요.", "");
  return out;
}

// 홈페이지 모니터링 절 (PUBLIC 보고서, W23). 정시 점검의 확정 판정만 센다. 가용률 식을 글로 적어 숫자를 검산할 수 있게 한다
function renderWeb(w: NonNullable<ReportModel["web"]>, no: number): string[] {
  const out: string[] = [`## ${no}. 홈페이지 모니터링`, ""];
  out.push("> 단일 지점, 1시간 간격 외부 관측입니다. 모든 이용자의 상태를 뜻하지 않으며, 정시 점검의 확정 판정만 셉니다. 수동 점검은 포함하지 않습니다.", "");
  if (w.unavailable) {
    out.push("홈페이지 점검 집계를 불러오지 못했습니다. 이 절의 숫자는 없습니다. 다시 생성하면 읽을 수 있습니다.", "");
    return out;
  }
  if (w.targets.length === 0) {
    out.push("해당 날짜의 홈페이지 정시 점검 기록이 없습니다.", "");
  }
  for (const t of w.targets) {
    const rate = t.avail.den > 0 ? `${((t.avail.num / t.avail.den) * 100).toFixed(1)}% (${num(t.avail.num)} / ${num(t.avail.den)})` : `비율 없음 (${num(t.avail.num)} / ${num(t.avail.den)})`;
    out.push(`### ${escapeMarkdownCell(t.label)}`, "");
    out.push(`- 판정 분포(정시 ${num(judgedCount(t))}회): 정상 ${num(t.passData)} · 정상(데이터 없음) ${num(t.passNoData)} · 성능 저하 ${num(t.degraded)} · 실패 ${num(t.fail)} · 확인 불가 ${num(t.unverified)} · 미점검 ${num(t.notRun)} · 계획 점검 ${num(t.planned)} · 미등록 점검 ${num(t.unplanned)}`);
    out.push(`- 확정 장애 ${num(t.confirmedDown)}건 (총 지속 ${downText(t.downSeconds)}, 정시 칸 수 기준 추정) · 일시 실패 ${num(t.flap)}회`);
    out.push(`- 응답 시간: 평균 ${ms(t.avgMs)} · 최대 ${ms(t.maxMs)}`);
    out.push(`- 가용률: ${rate} = 정상 계열 ÷ (판정 횟수 − 확인 불가 − 미점검 − 계획 점검 − 미등록 점검). 성능 저하는 정상 계열이 아닙니다.`, "");
  }
  out.push(`- 홈페이지 이상징후: ${w.anomalies.length === 0 ? "없음" : w.anomalies.map((a) => `#${a.id} (${escapeMarkdownCell(labelOf(STATUS_LABEL, a.status))})`).join(", ")}`, "");
  return out;
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

  if (m.availability) out.push(...renderAvailability(m.availability));
  if (m.quality) out.push(...renderQuality(m.quality));
  const webNo = m.availability ? 9 : 7;
  if (m.web) out.push(...renderWeb(m.web, webNo));
  if (m.execution) out.push(...renderExecution(m.execution, webNo + (m.web ? 1 : 0)));

  return `${out.join("\n").trimEnd()}\n`;
}

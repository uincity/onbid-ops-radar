// 저장된 보고서 스냅샷(모델)을 읽기 좋게 보여 주는 화면 조각 (서버 컴포넌트, 값을 그리기만 한다)
import { RULE_LABEL, RUN_STATUS_LABEL, STATUS_LABEL, labelOf } from "@/lib/anomalies/labels";
import { StatusBadge, RuleBadge } from "@/components/ui/badges";
import { REASON_LABEL } from "@/lib/availability/summary";
import { FAIL_CODE_LABEL, PROBE_STATUS_LABEL, PROBE_STATUSES } from "@/lib/checks/probe/status";
import { NO_RECORD_MESSAGE } from "@/lib/reports/markdown";
import type { ReportModel } from "@/lib/reports/model";
import { formatKst } from "@/lib/time";

const kst = (iso: string) => `${formatKst(new Date(iso))} KST`;
const num = (n: number) => n.toLocaleString("en-US");
const ms = (n: number | null) => (n === null ? "-" : `${num(n)} ms`);

const th = "px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400";
const td = "px-3 py-2 text-zinc-900 dark:text-zinc-100";
const box = "overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-950 dark:text-zinc-50">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className={box}>
      <table className="w-full min-w-[20rem] text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportView({ model }: { model: ReportModel }) {
  const m = model;
  const a = m.anomalies;
  const range = m.partialDay
    ? `${m.reportDate} 00:00 ~ ${kst(m.coversUntil)} (오늘 보고서: 생성 시각까지 집계)`
    : `${m.reportDate} 00:00 ~ 24:00 KST`;

  return (
    <div data-testid="report-view">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-600 dark:text-zinc-400">집계 범위</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{range}</dd>
        </div>
        <div>
          <dt className="text-zinc-600 dark:text-zinc-400">점검 기준 시각</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{m.baselineAt ? kst(m.baselineAt) : "없음 (그날 성공한 점검 실행이 없습니다)"}</dd>
        </div>
        <div>
          <dt className="text-zinc-600 dark:text-zinc-400">보고서 생성 시각</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{kst(m.generatedAt)}</dd>
        </div>
        {m.generationMs !== undefined ? (
          <div>
            <dt className="text-zinc-600 dark:text-zinc-400">생성에 걸린 시간</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{(m.generationMs / 1000).toFixed(1)}초 (목표 60초 이내)</dd>
          </div>
        ) : null}
      </dl>

      {!m.hasActivity ? (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="report-empty">
          {NO_RECORD_MESSAGE}.
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="API 호출" value={num(m.api.total)} hint={`성공 ${num(m.api.success)}건`} />
        <Card label="신규 이상징후" value={num(a.newCount)} hint={`재발 ${num(a.recurredCount)}건 포함`} />
        <Card label="그날 종결" value={num(a.closedCount)} hint={`조치 완료 ${num(a.resolvedCount)} · 정상 판정 ${num(a.dismissedCount)}`} />
        <Card label="미처리" value={num(m.unresolved.total)} hint="미확인 + 검토 중" />
      </div>

      <Section title="1. API 점검 요약">
        <SimpleTable
          head={["항목", "값"]}
          rows={[
            ["API 호출 수", num(m.api.total)],
            ["성공", num(m.api.success)],
            ["HTTP 오류", num(m.api.httpError)],
            ["타임아웃", num(m.api.timeout)],
            ["서비스키·한도 문제", num(m.api.authOrQuota)],
            ["빈 결과", num(m.api.emptyResult)],
            ["평균 응답시간", ms(m.api.avgMs)],
            ["최대 응답시간", ms(m.api.maxMs)],
          ]}
        />
      </Section>

      <Section title="2. 점검 실행 요약">
        <SimpleTable
          head={["상태", "횟수"]}
          rows={[["전체 실행", num(m.runs.total)], ...Object.entries(m.runs.byStatus).map(([s, n]) => [labelOf(RUN_STATUS_LABEL, s), num(n)])]}
        />
      </Section>

      <Section title="3. 데이터 검증 결과">
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">검사한 수집 데이터: {num(m.validation.collectedCount)}건</p>
        <SimpleTable
          head={["탐지 규칙", "신규 이상징후"]}
          rows={Object.entries(m.validation.newByRule).map(([rule, n]) => [labelOf(RULE_LABEL, rule), num(n)])}
        />
      </Section>

      <Section title="4. 이상징후 발생·처리 현황">
        <SimpleTable
          head={["항목", "건수"]}
          rows={[
            ["그날 신규", num(a.newCount)],
            ["그날 재발 (이전에 종결된 건이 다시 탐지됨)", num(a.recurredCount)],
            ["그날 종결", num(a.closedCount)],
          ]}
        />
        <p className="mb-2 mt-4 text-sm text-zinc-700 dark:text-zinc-300">처리상태별 현황 (생성 시점의 현재 상태)</p>
        <SimpleTable head={["처리상태", "건수"]} rows={Object.entries(a.byStatus).map(([s, n]) => [labelOf(STATUS_LABEL, s), num(n)])} />
      </Section>

      <Section title="5. 미처리 이상징후 (미확인·검토 중)">
        {m.unresolved.total === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">미처리 이상징후가 없습니다.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">처음 탐지된 시각이 오래된 순서입니다. 전체 {num(m.unresolved.total)}건.</p>
            <SimpleTable
              head={["번호", "규칙", "물건", "상태", "담당자", "최근 탐지"]}
              rows={m.unresolved.rows.map((r) => [
                `#${r.id}`,
                <RuleBadge key="rule" rule={r.ruleId} />,
                r.itemKey,
                <StatusBadge key="status" status={r.status} />,
                r.assignee ?? "-",
                kst(r.lastDetectedAt),
              ])}
            />
            {m.unresolved.omitted > 0 ? <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">외 {num(m.unresolved.omitted)}건</p> : null}
          </>
        )}
      </Section>

      <Section title="6. 점검 메모 (비교 제외 사유 등)">
        {m.skipReasons.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">기록된 메모가 없습니다.</p>
        ) : (
          <SimpleTable head={["코드", "건수", "예시"]} rows={m.skipReasons.map((s) => [s.code, num(s.count), s.sample])} />
        )}
      </Section>

      {m.availability ? <AvailabilitySections a={m.availability} /> : null}
      {m.quality ? <QualitySection q={m.quality} no={8} /> : null}
      {m.execution ? <ExecutionSection e={m.execution} no={m.availability ? 9 : 7} /> : null}
    </div>
  );
}

// ---- R05 보강: 26종 가용성(7절) · 데이터 품질 규칙(8절) · 실행 품질(9절). Markdown 다운로드와 같은 내용을 화면으로 보여 준다 ----
const pct = (r: { num: number; den: number }) => (r.den > 0 ? `${((r.num / r.den) * 100).toFixed(1)}% (${num(r.num)} / ${num(r.den)})` : `비율 없음 (${num(r.num)} / ${num(r.den)})`);
const reasonText = (code: string | null) => (code === null ? "-" : (REASON_LABEL[code] ?? FAIL_CODE_LABEL[code as keyof typeof FAIL_CODE_LABEL] ?? code));
const reasonList = (map: Record<string, number>) =>
  Object.entries(map)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${reasonText(c)} ${num(n)}`)
    .join(", ") || "없음";

function AvailabilitySections({ a }: { a: NonNullable<ReportModel["availability"]> }) {
  const total = PROBE_STATUSES.reduce((sum, s) => sum + (a.counts[s] ?? 0), 0);
  return (
    <Section title="7. 온비드 OpenAPI 가용성 (PUBLIC)">
      <div data-testid="report-availability">
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          우리 점검 요청에 관측된 결과이며, 온비드 서버 전체의 가용성·호출량·원천 데이터 건수를 뜻하지 않습니다. 검증 불가·미점검은 정상으로도 실패로도 세지 않습니다. DEMO 결과는 포함하지 않습니다.
        </p>
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          관리 대상: 목표 {num(a.registry.target)}종 · 등록 확인 {num(a.registry.registered)}종 · 미확정 {num(a.registry.unconfirmed)}종 · 오퍼레이션 {num(a.registry.operations)}개 · 가장 최근 판정 시각 {a.lastCheckedAt ? `${a.lastCheckedAt} KST` : "점검 기록 없음"}
        </p>
        <SimpleTable
          head={["판정", "오퍼레이션 수"]}
          rows={[...PROBE_STATUSES.map((s) => [PROBE_STATUS_LABEL[s], num(a.counts[s] ?? 0)]), ["합계", `${num(total)} ${total === a.registry.operations ? "(일치)" : "(불일치: 집계 오류 확인 필요)"}`]]}
        />
        <div className="mt-3" />
        <SimpleTable
          head={["지표", "값"]}
          rows={[
            ["점검 시도율 (요청을 보낸 수 / 준비된 수)", pct(a.attemptRate)],
            ["기본 정상 비율 (정상 / 실제 시도한 수)", pct(a.basicOk)],
            ["실데이터 검증률 (실데이터 확인 / Positive 점검 등록)", pct({ num: a.realData.passData, den: a.realData.positiveRegistered })],
            ["전체 목표 대비 검증률 (모든 오퍼레이션이 실데이터 확인된 서비스 / 목표)", pct(a.serviceCoverage)],
          ]}
        />
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">검증 불가 사유: {reasonList(a.reasons.unverified)}</p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          미점검 사유: {reasonList(a.reasons.notRun)} (점검 기록 없음 {num(a.noRecord)}개 포함)
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">실패 구분: {reasonList(a.failByCode)}</p>
      </div>
    </Section>
  );
}

function QualitySection({ q, no }: { q: NonNullable<ReportModel["quality"]>; no: number }) {
  return (
    <Section title={`${no}. 데이터 품질 규칙 적용 현황 (PUBLIC)`}>
      <div data-testid="report-quality">
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          데이터 품질 이상징후는 담당자가 확인하기 전까지 <strong>의심</strong>이며 확정된 오류가 아닙니다. 우리 점검 요청에 관측된 결과이며 온비드 전체의 데이터 품질을 뜻하지 않습니다.
        </p>
        <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
          적용 대상: 요청을 보낸 오퍼레이션 {num(q.applicableApis)}개 · 수집·검사한 데이터 {num(q.collectedItems)}건
        </p>
        <SimpleTable
          head={["규칙", "적용 대상", "신규 의심 건수"]}
          rows={q.rules.map((r) => [labelOf(RULE_LABEL, r.ruleId), r.targets === null ? "적용 제외 (연결해서 비교할 API 점검 없음)" : num(r.targets), num(r.suspected)])}
        />
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">판정 보류: {num(q.deferred)}건 (상세 조회 결과가 없어 정상 종료·철회 등과 구분할 수 없는 물건. 이상징후로 만들지 않음)</p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">적용 제외된 점검 실행: {num(q.notApplicableRuns)}회 (교차 참조 규칙)</p>
      </div>
    </Section>
  );
}

function ExecutionSection({ e, no }: { e: NonNullable<ReportModel["execution"]>; no: number }) {
  return (
    <Section title={`${no}. 실행 품질`}>
      <div data-testid="report-execution">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          예약 점검(KST 09:00): {e.scheduleTitle} ({e.scheduleState}) · 그날 시작한 예약 점검 {num(e.scheduledRunCount)}회
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          마지막으로 끝난 점검 실행: {e.lastFinishedAt ? kst(e.lastFinishedAt) : "없음"} (서비스 전체 점검 완료 시각이며 API별 마지막 성공 시각과 다릅니다)
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">마지막으로 정상 완료된 점검 실행: {e.lastSucceededAt ? kst(e.lastSucceededAt) : "없음"}</p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">차단·일부 완료·미점검의 횟수와 사유는 위 2절(점검 실행 요약)과 6절(점검 메모)을 보세요.</p>
      </div>
    </Section>
  );
}

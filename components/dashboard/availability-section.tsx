// 26종 가용성 영역 (대시보드 맨 위). 요약 모델을 받아 그리기만 한다. 데이터 읽기는 app/(app)/page.tsx
// Design Ref: PRD 3-1(지표 산식), 3-3(품질 원칙) — 미점검·검증 불가를 정상으로 세지 않고, "우리 점검 요청 기준"임을 항상 밝힌다.
import { FAIL_CODE_LABEL, PROBE_STATUS_LABEL, PROBE_STATUSES, type ProbeStatus } from "@/lib/checks/probe/status";
import { REASON_LABEL, type AvailabilitySummary, type Ratio } from "@/lib/availability/summary";

const sectionTitle = "text-base font-semibold text-zinc-950 dark:text-zinc-50";
const panel = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

// 색만으로 뜻을 전하지 않도록 항상 글자를 함께 보여 준다
const STATUS_TONE: Record<ProbeStatus, string> = {
  PASS_DATA: "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  PASS_NO_DATA: "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  DEGRADED: "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  FAIL: "bg-red-50 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800",
  UNVERIFIED: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600",
  NOT_RUN: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600",
};

export const ProbeStatusBadge = ({ status }: { status: ProbeStatus }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[status]}`}>{PROBE_STATUS_LABEL[status]}</span>
);

const percent = (r: Ratio) => (r.ratio === null ? "비율 없음" : `${(r.ratio * 100).toFixed(1)}%`);
const fraction = (r: Ratio) => `${r.num} / ${r.den}`;

function Metric({ title, value, detail, testId }: { title: string; value: string; detail: string; testId: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900" data-testid={testId}>
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{title}</span>
      <span className="text-xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">{value}</span>
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{detail}</span>
    </div>
  );
}

const reasonText = (code: string | null) => (code === null ? "" : (REASON_LABEL[code] ?? FAIL_CODE_LABEL[code as keyof typeof FAIL_CODE_LABEL] ?? code));

export function AvailabilitySection({ summary }: { summary: AvailabilitySummary }) {
  const { registry, counts } = summary;
  const reasonList = (map: Record<string, number>) =>
    Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([code, n]) => `${reasonText(code)} ${n}`)
      .join(" · ");

  return (
    <section aria-labelledby="availability" className={panel} data-testid="availability">
      <h2 id="availability" className={sectionTitle}>
        온비드 OpenAPI 가용성 (PUBLIC)
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400" data-testid="availability-basis">
        우리 점검 요청에 관측된 결과이며, 온비드 서버 전체의 가용성이 아닙니다. 가장 최근 판정 시각: {summary.lastCheckedAt ?? "점검 기록 없음"}
      </p>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300" data-testid="availability-registry">
        관리 대상: 목표 {registry.target}종 · 등록 확인 {registry.registered}종 · 미확정 {registry.unconfirmed}종 (공식 목록 대조 전, 분모에 넣지 않음) · 오퍼레이션 {registry.operations}개
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="availability-counts">
        {PROBE_STATUSES.map((status) => (
          <li key={status} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900" data-testid={`availability-count-${status}`}>
            <ProbeStatusBadge status={status} />
            <span className="text-2xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">{counts[status]}개</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400" data-testid="availability-sum">
        합계 {PROBE_STATUSES.reduce((sum, s) => sum + counts[s], 0)}개 / 오퍼레이션 {registry.operations}개 {summary.sumMatches ? "(일치)" : "(불일치: 집계 오류 확인 필요)"}. 미점검에는 점검 기록이 없는 {summary.noRecord}개가 들어 있습니다. 검증 불가와 미점검은 정상으로도 실패로도 세지 않습니다.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric testId="metric-attempt" title="점검 시도율" value={percent(summary.attemptRate)} detail={`요청을 보낸 ${fraction(summary.attemptRate)} (준비된 오퍼레이션 기준, 준비 안 됨 ${summary.ready.notReady}개)`} />
        <Metric testId="metric-basic" title="기본 정상 비율" value={percent(summary.basicOk)} detail={`해당 점검이 정상 ${fraction(summary.basicOk)} (실제 시도한 수 기준)`} />
        <Metric testId="metric-realdata" title="실데이터 검증률" value={percent(summary.realData.ratio)} detail={`실데이터 확인 ${summary.realData.passData}개 / Positive 점검 등록 ${summary.realData.positiveRegistered}개`} />
        <Metric testId="metric-coverage" title="전체 목표 대비 검증률" value={percent(summary.serviceCoverage)} detail={`모든 오퍼레이션이 실데이터 확인된 서비스 ${fraction(summary.serviceCoverage)}`} />
      </div>

      {Object.keys(summary.reasons.unverified).length + Object.keys(summary.reasons.notRun).length > 0 ? (
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300" data-testid="availability-reasons">
          {Object.keys(summary.reasons.unverified).length > 0 ? <>검증 불가 사유: {reasonList(summary.reasons.unverified)}. </> : null}
          {Object.keys(summary.reasons.notRun).length > 0 ? <>미점검 사유: {reasonList(summary.reasons.notRun)}.</> : null}
        </p>
      ) : null}
      {counts.FAIL > 0 ? (
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300" data-testid="availability-fail-codes">
          실패 구분: {Object.entries(summary.failByCode).filter(([, n]) => n > 0).map(([code, n]) => `${FAIL_CODE_LABEL[code as keyof typeof FAIL_CODE_LABEL]} ${n}`).join(" · ")}
        </p>
      ) : null}

      <details className="mt-4" data-testid="availability-details">
        <summary className="cursor-pointer text-sm font-medium text-blue-700 underline dark:text-blue-300">서비스별 오퍼레이션 상태 보기 ({summary.services.length}개 서비스)</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3 font-medium">서비스 / 오퍼레이션</th>
                <th className="py-1 pr-3 font-medium">상태</th>
                <th className="py-1 pr-3 font-medium">사유</th>
                <th className="py-1 pr-3 font-medium">마지막 판정</th>
                <th className="py-1 font-medium">마지막 정상 응답</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {summary.services.flatMap((service) =>
                service.operations.map((op) => (
                  <tr key={op.key} data-testid="availability-row">
                    <td className="py-1.5 pr-3 text-zinc-900 dark:text-zinc-100">
                      <span className="font-medium">{service.name}</span> <span className="text-xs text-zinc-600 dark:text-zinc-400">{op.operationId}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <ProbeStatusBadge status={op.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-300">{reasonText(op.reason) || "-"}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-700 dark:text-zinc-300">{op.checkedAt ?? "-"}</td>
                    <td className="py-1.5 tabular-nums text-zinc-700 dark:text-zinc-300">{op.lastOkAt ?? "-"}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

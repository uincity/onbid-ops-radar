// 이상징후 상세의 "탐지 근거"와 "원본 데이터" 표시 (evidence 모양은 lib/checks/evidence.ts 참고)
// evidence는 DB의 JSON이라 모양이 틀려도 화면이 깨지지 않게, 읽을 때마다 타입을 확인한다.
import { RULE_LABEL, labelOf } from "@/lib/anomalies/labels";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const FIELD_LABEL: Record<string, string> = {
  demo_item_id: "물건 ID",
  item_name: "물건명",
  org_name: "기관명",
  bid_start_at: "입찰시작일시",
  bid_end_at: "입찰종료일시",
  item_status: "물건 상태",
};
const fieldName = (f: string) => FIELD_LABEL[f] ?? f;

const REASON_LABEL: Record<string, string> = { MISSING: "값이 없음", BAD_FORMAT: "형식이 올바르지 않음" };

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(없음)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

// 초 → "3,600초 (1시간)" 처럼 읽기 쉽게
export function formatGap(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const parts = [h > 0 ? `${h}시간` : "", m > 0 ? `${m}분` : "", rest > 0 || s === 0 ? `${rest}초` : ""].filter(Boolean);
  return `${s.toLocaleString("ko-KR")}초 (${parts.join(" ")})`;
}

const SIDE_LABEL = { list: "목록 데이터", detail: "상세 데이터" } as const;

function Line({ children }: { children: React.ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}

function dateOrderLines(evidence: Obj): React.ReactNode[] {
  const findings = isObj(evidence.findings) ? evidence.findings : {};
  const out: React.ReactNode[] = [];
  for (const side of ["list", "detail"] as const) {
    const f = findings[side];
    if (!isObj(f)) continue;
    out.push(
      <Line key={side}>
        <strong>{SIDE_LABEL[side]}</strong>: 입찰종료일시({show(f.bidEndAt)})가 입찰시작일시({show(f.bidStartAt)})보다{" "}
        {typeof f.gapSeconds === "number" ? <strong>{formatGap(f.gapSeconds)}</strong> : "얼마간"} 빠릅니다. (시작과 종료가 뒤집혀 있음)
      </Line>,
    );
  }
  return out;
}

function requiredLines(evidence: Obj): React.ReactNode[] {
  const problems = isObj(evidence.problems) ? evidence.problems : {};
  const out: React.ReactNode[] = [];
  for (const side of ["list", "detail"] as const) {
    const list = problems[side];
    if (!Array.isArray(list) || list.length === 0) continue;
    out.push(
      <Line key={side}>
        <strong>{SIDE_LABEL[side]}</strong>:
        <ul className="ml-5 list-disc">
          {list.filter(isObj).map((p, i) => (
            <li key={i}>
              {fieldName(show(p.field))} — {REASON_LABEL[String(p.reason)] ?? show(p.reason)}
            </li>
          ))}
        </ul>
      </Line>,
    );
  }
  return out;
}

function mismatchLines(evidence: Obj): React.ReactNode[] {
  const diffs = Array.isArray(evidence.diffs) ? evidence.diffs.filter(isObj) : [];
  const out: React.ReactNode[] = diffs.map((d, i) => (
    <Line key={i}>
      <strong>{fieldName(show(d.field))}</strong>: 목록 값 “{show(d.list)}” ≠ 상세 값 “{show(d.detail)}”
    </Line>
  ));
  if (typeof evidence.gapSeconds === "number") {
    out.push(<Line key="gap">목록과 상세를 수집한 시각 차이: {formatGap(evidence.gapSeconds)}</Line>);
  }
  return out;
}

function emptyLines(evidence: Obj): React.ReactNode[] {
  return [
    <Line key="e">
      API <strong>{show(evidence.endpoint)}</strong>가 {typeof evidence.recordCount === "number" ? evidence.recordCount : 0}건을 돌려주었습니다. 이 API는 빈 결과가 정상이
      아니라고 정해 두었습니다.
    </Line>,
  ];
}

export function EvidenceSummary({ ruleId, evidence }: { ruleId: string; evidence: unknown }) {
  const ev = isObj(evidence) ? evidence : {};
  const lines =
    ruleId === "DATE_ORDER"
      ? dateOrderLines(ev)
      : ruleId === "REQUIRED_FIELD"
        ? requiredLines(ev)
        : ruleId === "LIST_DETAIL_MISMATCH"
          ? mismatchLines(ev)
          : ruleId === "EMPTY_RESULT"
            ? emptyLines(ev)
            : [];
  return (
    <section aria-labelledby="evidence-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 id="evidence-title" className="text-base font-semibold">
        탐지 근거 <span className="ml-1 text-sm font-normal text-zinc-500">({labelOf(RULE_LABEL, ruleId)})</span>
      </h2>
      {lines.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm" data-testid="evidence-summary">
          {lines}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">이 이상징후에는 읽을 수 있는 근거가 저장되어 있지 않습니다.</p>
      )}
    </section>
  );
}

// 목록 값과 상세 값을 나란히 비교하는 표. 둘이 다르면 표시한다.
export function RawValuesTable({ evidence }: { evidence: unknown }) {
  const values = isObj(evidence) && isObj(evidence.values) ? evidence.values : null;
  const list = values && isObj(values.list) ? values.list : null;
  const detail = values && isObj(values.detail) ? values.detail : null;
  const fields = [...new Set([...Object.keys(list ?? {}), ...Object.keys(detail ?? {})])];

  return (
    <section aria-labelledby="raw-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 id="raw-title" className="text-base font-semibold">
        원본 데이터 <span className="ml-1 text-sm font-normal text-zinc-500">(저장이 허용된 필드만)</span>
      </h2>
      {fields.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">비교할 원본 값이 없습니다. (API 상태 이상징후는 물건 값이 없습니다.)</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm" data-testid="raw-values">
            <thead className="border-b border-zinc-200 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">필드</th>
                <th scope="col" className="py-2 pr-3 font-medium">목록 값</th>
                <th scope="col" className="py-2 pr-3 font-medium">상세 값</th>
                <th scope="col" className="py-2 font-medium">비교</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fields.map((f) => {
                const a = list ? list[f] : undefined;
                const b = detail ? detail[f] : undefined;
                const differs = list !== null && detail !== null && show(a) !== show(b);
                return (
                  <tr key={f}>
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {fieldName(f)} <span className="font-mono text-xs font-normal text-zinc-500">{f}</span>
                    </th>
                    <td className="py-2 pr-3 font-mono text-xs">{list ? show(a) : "(없음)"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{detail ? show(b) : "(없음)"}</td>
                    <td className="py-2 text-xs">{differs ? <span className="font-medium text-red-700 dark:text-red-300">다름</span> : <span className="text-zinc-500">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

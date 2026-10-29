// 이상징후 목록 화면의 조각들: 빠른 필터 · 세부 필터 · 표 · 쪽 이동 (서버 컴포넌트, 자바스크립트 없이 링크·폼으로 동작)
import Link from "next/link";
import { RuleBadge, SourceBadge, StatusBadge, VerdictBadge } from "@/components/ui/badges";
import { RULE_IDS, RULE_LABEL, SOURCES, STATUS_LABEL } from "@/lib/anomalies/labels";
import {
  QUICK_FILTERS,
  STATUS_FILTERS,
  activeQuickFilter,
  buildListHref,
  quickFilterHref,
  totalPages,
  type ListQuery,
} from "@/lib/anomalies/list-query";
import type { AnomalyListRow } from "@/lib/anomalies/queries";
import { formatKst } from "@/lib/time";

const STATUS_FILTER_LABEL: Record<string, string> = { ...STATUS_LABEL, active: "미처리(미확인+검토 중)", closed: "종결(조치 완료+정상 판정)" };

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";

export function QuickFilters({ query }: { query: ListQuery }) {
  const active = activeQuickFilter(query);
  return (
    <nav aria-label="빠른 필터" className="flex flex-wrap gap-2">
      {QUICK_FILTERS.map((f) => {
        const on = f.key === active;
        return (
          <Link
            key={f.key}
            href={quickFilterHref(query, f.key)}
            aria-current={on ? "true" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              on
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100"
                : "bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}

// 상태·규칙·출처를 고르는 폼 (GET 방식: 누르면 주소의 쿼리가 바뀐다). 담당자 조건은 숨은 값으로 유지한다.
export function DetailFilters({ query }: { query: ListQuery }) {
  return (
    <form action="/anomalies" method="get" className="flex flex-wrap items-end gap-3" aria-label="세부 필터">
      {query.assignee ? <input type="hidden" name="assignee" value={query.assignee} /> : null}
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        상태
        <select name="status" defaultValue={query.status ?? ""} className={selectClass}>
          <option value="">전체</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        규칙
        <select name="rule" defaultValue={query.rule ?? ""} className={selectClass}>
          <option value="">전체</option>
          {RULE_IDS.map((r) => (
            <option key={r} value={r}>
              {RULE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        출처
        <select name="source" defaultValue={query.source ?? ""} className={selectClass}>
          <option value="">전체</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        적용
      </button>
    </form>
  );
}

export function AnomalyTable({ rows, names }: { rows: AnomalyListRow[]; names: Map<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[960px] text-left text-sm" data-testid="anomaly-table">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {["번호", "출처", "규칙", "물건 식별값", "상태", "판정", "담당자", "탐지 횟수", "최근 탐지 (KST)"].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.id} data-testid="anomaly-row">
              <td className="px-3 py-2">
                <Link href={`/anomalies/${r.id}`} className="font-medium text-blue-700 underline underline-offset-2 dark:text-blue-300">
                  #{r.id}
                </Link>
                {r.previous_anomaly_id != null ? (
                  <span className="ml-1 text-xs text-violet-700 dark:text-violet-300" title={`이전 이상징후 #${r.previous_anomaly_id}의 재발`}>
                    재발
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <SourceBadge source={r.source} />
              </td>
              <td className="px-3 py-2">
                <RuleBadge rule={r.rule_id} />
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.item_key}</td>
              <td className="px-3 py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2">
                <VerdictBadge verdict={r.verdict} />
              </td>
              <td className="px-3 py-2">
                {r.assignee_id ? (names.get(r.assignee_id) ?? "알 수 없는 사용자") : <span className="text-zinc-500">담당자 없음</span>}
              </td>
              <td className="px-3 py-2 tabular-nums">{r.detect_count}회</td>
              <td className="px-3 py-2 tabular-nums">{formatKst(new Date(r.last_detected_at))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ query, page, total }: { query: ListQuery; page: number; total: number }) {
  const last = totalPages(total);
  const linkClass =
    "rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-900";
  const disabledClass = "rounded-md px-3 py-1.5 text-sm text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:text-zinc-600 dark:ring-zinc-800";
  return (
    <nav aria-label="쪽 이동" className="flex items-center justify-between gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="anomaly-total">
        총 {total.toLocaleString("ko-KR")}건 · {page} / {last}쪽
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={buildListHref(query, { page: page - 1 })} className={linkClass}>
            이전
          </Link>
        ) : (
          <span className={disabledClass}>이전</span>
        )}
        {page < last ? (
          <Link href={buildListHref(query, { page: page + 1 })} className={linkClass}>
            다음
          </Link>
        ) : (
          <span className={disabledClass}>다음</span>
        )}
      </div>
    </nav>
  );
}

// 이상징후 목록의 주소 쿼리(?status=open&page=2 …)를 안전하게 읽고, DB에 물어볼 조건으로 바꾸는 순수 함수들
// (PLAN 25번, DESIGN §4.4) DB·화면을 모른다. 잘못된 값은 오류로 멈추지 않고 "없는 것"으로 무시한다.
import { z } from "zod";
import { RULE_IDS, SOURCES, STATUSES, type RuleId, type Source } from "./labels";

export const PAGE_SIZE = 20; // 한 쪽에 보여 줄 건수
export const MAX_PAGE = 10000; // 터무니없이 큰 쪽 번호는 여기까지만 인정

// 상태 필터: 4개 상태 + 묶음 2개(active = 미확인+검토 중, closed = 조치 완료+정상 판정)
export const STATUS_FILTERS = [...STATUSES, "active", "closed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const ASSIGNEE_FILTERS = ["me", "unassigned"] as const;
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export type ListQuery = {
  status?: StatusFilter;
  rule?: RuleId;
  source?: Source;
  assignee?: AssigneeFilter;
  page: number;
};

const statusSchema = z.enum(STATUS_FILTERS);
const ruleSchema = z.enum(RULE_IDS);
const sourceSchema = z.enum(SOURCES);
const assigneeSchema = z.enum(ASSIGNEE_FILTERS);
const pageSchema = z.string().regex(/^\d{1,9}$/);

type RawParams = Record<string, string | string[] | undefined>;

// 같은 이름이 여러 번 오면 첫 번째만 쓴다
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseListQuery(raw: RawParams): ListQuery {
  const status = statusSchema.safeParse(first(raw.status));
  const rule = ruleSchema.safeParse(first(raw.rule));
  const source = sourceSchema.safeParse(first(raw.source));
  const assignee = assigneeSchema.safeParse(first(raw.assignee));
  const pageText = pageSchema.safeParse(first(raw.page));

  let page = 1;
  if (pageText.success) page = Math.min(Math.max(Number(pageText.data), 1), MAX_PAGE);

  return {
    ...(status.success ? { status: status.data } : {}),
    ...(rule.success ? { rule: rule.data } : {}),
    ...(source.success ? { source: source.data } : {}),
    ...(assignee.success ? { assignee: assignee.data } : {}),
    page,
  };
}

// DB에 물어볼 조건. supabase-js의 eq / in / is 로만 바꿔 쓰므로 값이 SQL 문장에 섞이지 않는다.
export type FilterPlan = {
  eq: [column: string, value: string][];
  in: [column: string, values: string[]][];
  isNull: string[];
};

export function buildFilterPlan(query: ListQuery, currentUserId: string): FilterPlan {
  const plan: FilterPlan = { eq: [], in: [], isNull: [] };
  if (query.status === "active") plan.in.push(["status", ["open", "investigating"]]);
  else if (query.status === "closed") plan.in.push(["status", ["resolved", "dismissed"]]);
  else if (query.status) plan.eq.push(["status", query.status]);
  if (query.rule) plan.eq.push(["rule_id", query.rule]);
  if (query.source) plan.eq.push(["source", query.source]);
  if (query.assignee === "me") plan.eq.push(["assignee_id", currentUserId]);
  else if (query.assignee === "unassigned") plan.isNull.push("assignee_id");
  return plan;
}

// 쪽 번호 → DB 범위(0부터, 끝 포함)
export function pageRange(page: number): { from: number; to: number } {
  const from = (Math.max(page, 1) - 1) * PAGE_SIZE;
  return { from, to: from + PAGE_SIZE - 1 };
}

export const totalPages = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

type Changes = { [K in keyof ListQuery]?: ListQuery[K] | null };

// 현재 조건에서 일부만 바꾼 목록 주소를 만든다. null은 그 조건을 지운다. page를 따로 주지 않으면 1쪽으로 돌아간다.
export function buildListHref(query: ListQuery, changes: Changes = {}): string {
  const merged = { ...query, ...changes } as Record<string, unknown>;
  const page = "page" in changes && typeof changes.page === "number" ? changes.page : 1;
  const params = new URLSearchParams();
  for (const key of ["status", "rule", "source", "assignee"] as const) {
    const v = merged[key];
    if (typeof v === "string") params.set(key, v);
  }
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/anomalies?${text}` : "/anomalies";
}

// 빠른 필터 버튼 6개 (상태·담당자 조건만 바꾸고, 규칙·출처 조건은 그대로 둔다)
export const QUICK_FILTERS = [
  { key: "all", label: "전체", status: null, assignee: null },
  { key: "open", label: "미확인", status: "open", assignee: null },
  { key: "mine", label: "내 담당", status: null, assignee: "me" },
  { key: "unassigned", label: "담당자 없음", status: "active", assignee: "unassigned" },
  { key: "investigating", label: "검토 중", status: "investigating", assignee: null },
  { key: "closed", label: "종결", status: "closed", assignee: null },
] as const;
export type QuickFilterKey = (typeof QUICK_FILTERS)[number]["key"];

export function quickFilterHref(query: ListQuery, key: QuickFilterKey): string {
  const q = QUICK_FILTERS.find((f) => f.key === key)!;
  return buildListHref(query, { status: q.status, assignee: q.assignee });
}

// 지금 조건이 어느 빠른 필터와 같은지 (없으면 null → 어떤 버튼도 강조하지 않음)
export function activeQuickFilter(query: ListQuery): QuickFilterKey | null {
  const found = QUICK_FILTERS.find((f) => (f.status ?? undefined) === query.status && (f.assignee ?? undefined) === query.assignee);
  return found ? found.key : null;
}

// 이상징후 목록·상세 화면이 DB에서 읽어 오는 함수들 (PLAN 25·28번)
// 로그인한 사용자의 권한(RLS)으로만 읽는다. 서버 관리용 키는 쓰지 않는다.
// 로그인 정보(쿠키)를 읽으므로 <Suspense> 안에서 불러야 한다. (Cache Components)
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "./event-view";
import { PAGE_SIZE, buildFilterPlan, pageRange, type ListQuery } from "./list-query";

export type AnomalyListRow = {
  id: number;
  source: string;
  item_key: string;
  rule_id: string;
  status: string;
  verdict: string;
  assignee_id: string | null;
  detect_count: number;
  last_detected_at: string;
  previous_anomaly_id: number | null;
};

export type AnomalyDetail = AnomalyListRow & {
  version: number;
  evidence: unknown;
  first_detected_at: string;
};

export type ProfileLite = { id: string; displayName: string; role: string };

const LIST_COLUMNS = "id, source, item_key, rule_id, status, verdict, assignee_id, detect_count, last_detected_at, previous_anomaly_id";
const MAX_EVENTS = 200;

export async function fetchProfiles(): Promise<ProfileLite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, display_name, role").order("display_name");
  if (error) throw new Error("사용자 목록을 읽지 못했습니다.");
  return (data ?? []).map((p) => ({ id: p.id as string, displayName: p.display_name as string, role: p.role as string }));
}

export const profileNameMap = (profiles: ProfileLite[]) => new Map(profiles.map((p) => [p.id, p.displayName]));

export async function fetchAnomalyList(query: ListQuery, currentUserId: string) {
  const supabase = await createClient();
  const plan = buildFilterPlan(query, currentUserId);

  const run = async (page: number) => {
    let q = supabase.from("anomalies").select(LIST_COLUMNS, { count: "exact" });
    for (const [column, value] of plan.eq) q = q.eq(column, value);
    for (const [column, values] of plan.in) q = q.in(column, values);
    for (const column of plan.isNull) q = q.is(column, null);
    const { from, to } = pageRange(page);
    return q.order("last_detected_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  };

  let page = query.page;
  let result = await run(page);
  // 건수보다 큰 쪽 번호를 주소에 직접 적은 경우: 1쪽을 대신 보여 준다
  if (result.error && page > 1) {
    page = 1;
    result = await run(page);
  }
  if (result.error) throw new Error("이상징후 목록을 읽지 못했습니다.");

  const rows = (result.data ?? []) as unknown as AnomalyListRow[];
  const total = result.count ?? 0;

  // 담당자 이름 (목록에 나온 사람만)
  const ids = [...new Set(rows.map((r) => r.assignee_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
    for (const p of data ?? []) names.set(p.id as string, p.display_name as string);
  }

  return { rows, total, page, pageSize: PAGE_SIZE, names };
}

// id는 호출하는 쪽에서 숫자 모양인지 먼저 검사한다. 없으면 null.
export async function fetchAnomalyDetail(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anomalies")
    .select(`${LIST_COLUMNS}, version, evidence, first_detected_at`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("이상징후를 읽지 못했습니다.");
  if (!data) return null;

  // 이력: 최신 200줄을 가져와 오래된 것이 위로 오게 뒤집는다
  const events = await supabase
    .from("anomaly_events")
    .select("id, actor_type, actor_id, actor_role, event_type, from_value, to_value, note, created_at", { count: "exact" })
    .eq("anomaly_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_EVENTS);
  if (events.error) throw new Error("이상징후 이력을 읽지 못했습니다.");

  const eventRows = ((events.data ?? []) as unknown as EventRow[]).slice().reverse();
  const eventTotal = events.count ?? eventRows.length;

  const profiles = await fetchProfiles();
  return {
    anomaly: data as unknown as AnomalyDetail,
    events: eventRows,
    omittedEvents: Math.max(0, eventTotal - eventRows.length),
    profiles,
    names: profileNameMap(profiles),
  };
}

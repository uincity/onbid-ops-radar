// 26종 가용성이 읽는 데이터 (서버 쪽에서만 호출한다). 로그인한 사용자 권한(RLS)으로 읽고 서버 관리용 키는 쓰지 않는다.
// PUBLIC 점검 결과(probe_results)만 읽는다. DEMO와 합산하지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProbeRow } from "./summary";

const COLUMNS = "api_id, operation_id, status, attempted, reason, checked_at";
// 점검 한 번이 오퍼레이션 수(28)만큼 줄을 남기므로, 최근 판정 600줄이면 20번 넘는 점검을 덮는다
const ROW_LIMIT = 600;
const OK_STATUSES = ["PASS_DATA", "PASS_NO_DATA", "DEGRADED"];

// range를 주면 [from, to) 안의 판정만 (일일 보고서). 안 주면 날짜와 관계없는 가장 최근 판정 (대시보드)
export async function loadAvailabilityRows(supabase: SupabaseClient, range?: { from: Date; to: Date }): Promise<{ rows: ProbeRow[]; okRows: ProbeRow[] }> {
  const base = () => {
    let q = supabase.from("probe_results").select(COLUMNS).eq("source", "PUBLIC");
    if (range) q = q.gte("checked_at", range.from.toISOString()).lt("checked_at", range.to.toISOString());
    return q;
  };
  // 마지막 정상 응답은 보고 범위의 끝까지(이전 날짜 포함) 거슬러 찾는다
  const okQuery = () => {
    let q = supabase.from("probe_results").select(COLUMNS).eq("source", "PUBLIC").in("status", OK_STATUSES);
    if (range) q = q.lt("checked_at", range.to.toISOString());
    return q;
  };
  const [rows, okRows] = await Promise.all([
    base().order("id", { ascending: false }).limit(ROW_LIMIT),
    okQuery().order("id", { ascending: false }).limit(ROW_LIMIT),
  ]);
  if (rows.error || okRows.error) throw new Error("26종 가용성 데이터를 읽지 못했습니다.");
  return { rows: (rows.data ?? []) as ProbeRow[], okRows: (okRows.data ?? []) as ProbeRow[] };
}

// 예약 점검 상태 판단에 필요한 읽기. 로그인한 사용자 권한(RLS)으로 읽는다 (run_logs는 로그인 사용자 읽기 허용).
import type { SupabaseClient } from "@supabase/supabase-js";

// 오늘(KST 날짜) 예약 누락이 DB에 기록되었는가
export async function loadScheduleMissedRecorded(supabase: SupabaseClient, kstDate: string): Promise<boolean> {
  const { count, error } = await supabase.from("run_logs").select("id", { count: "exact", head: true }).eq("code", "SCHEDULE_MISSED").eq("log_date", kstDate);
  if (error) throw new Error("예약 누락 기록을 읽지 못했습니다.");
  return (count ?? 0) > 0;
}

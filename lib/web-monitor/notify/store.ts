// Design Ref: docs/design-homepage-monitoring.md §6.3 / Plan W12 — 알림 발송 저장소의 Supabase 구현 (서버 관리용 연결을 받는 서버 코드에서만 쓴다)
// DB가 돌려준 오류 문구에는 내부 정보가 섞일 수 있어 그대로 옮기지 않는다(SEC-11).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotifyStore, UnsentNotification } from "./types";

const fail = (what: string): never => {
  throw new Error(`${what} (DB 응답 오류)`);
};

export function createSupabaseNotifyStore(supabase: SupabaseClient): NotifyStore {
  return {
    async listUnsent(opts) {
      const { data, error } = await supabase.rpc("list_unsent_web_notifications", { p_older_minutes: opts.olderThanMinutes, p_keys: opts.keys ? [...opts.keys] : null, p_limit: opts.limit });
      if (error) return fail("미발송 알림을 읽지 못했습니다");
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): UnsentNotification => ({
          key: r.out_key as string,
          kind: r.out_kind as string,
          targetKey: r.out_target_key as string,
          incidentNo: r.out_incident_no == null ? null : Number(r.out_incident_no),
          payload: (r.out_payload ?? {}) as Record<string, unknown>,
          attempts: Number(r.out_attempts ?? 0),
          createdAt: new Date(r.out_created_at as string),
        }),
      );
    },

    async lease(key, seconds) {
      const { data, error } = await supabase.rpc("lease_web_notification", { p_key: key, p_seconds: seconds });
      if (error) return fail("알림 발송 임대를 받지 못했습니다");
      return data === true;
    },

    async recordAttempt(input) {
      const { error } = await supabase.rpc("record_notification_attempt", {
        p_key: input.key,
        p_attempt: input.attempt,
        p_channel: input.channel,
        p_status: input.status,
        p_response_code: input.responseCode,
        p_error_class: input.errorClass,
      });
      if (error) fail("알림 시도를 기록하지 못했습니다");
    },

    async latestAnomalyId(targetKey) {
      const { data, error } = await supabase.from("anomalies").select("id").eq("source", "WEB").eq("item_key", targetKey).order("id", { ascending: false }).limit(1).maybeSingle();
      if (error) return fail("이상징후를 읽지 못했습니다");
      return data ? Number((data as { id: number }).id) : null;
    },
  };
}

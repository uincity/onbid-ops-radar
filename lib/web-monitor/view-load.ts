// Design Ref: docs/design-homepage-monitoring.md §10 / Plan W13 — `/web` 화면이 쓸 데이터 읽기 구현 고르기 (서버 전용)
// 운영·개발: 로그인 사용자 권한(RLS)으로 읽는 Supabase 구현. WEB_MONITOR_STORE=mock: 메모리 목 구현(화면 시험용) — 운영 배포에서는 켜지지 않는다(값이 있으면 오류로 멈춘다).
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WebViewSource } from "./view-source";
import { createMockViewSource } from "./view-mock";
import { createSupabaseViewSource } from "./view-supabase";

export function isMockStore(): boolean {
  return process.env.WEB_MONITOR_STORE === "mock";
}

export async function getWebViewSource(): Promise<WebViewSource> {
  if (isMockStore()) {
    // 목 저장소가 운영에 켜져 있으면 가짜 데이터가 진짜처럼 보이므로 시작하지 않는다
    if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new Error("WEB_MONITOR_STORE=mock은 운영 배포에서 쓸 수 없습니다.");
    }
    return createMockViewSource();
  }
  return createSupabaseViewSource(await createClient());
}

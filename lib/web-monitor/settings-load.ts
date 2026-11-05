// Design Ref: docs/design-homepage-monitoring.md §6.5 / Plan W05 — DB의 web_settings 테이블을 읽어 검증된 WebSettings로 돌려주는 서버 전용 함수
// 기존 lib/settings/load.ts와 같은 방식이지만 읽는 테이블이 다르다(web_settings). 호출하는 쪽이 DB 연결을 넘긴다.
//   - 점검 실행기·예약 점검: createAdminClient() (서버 관리용 키)
//   - 화면·서버 액션: await createClient() (로그인 사용자, RLS가 읽기를 허용)
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { parseWebSettings, WebSettingsError, type WebSettings } from "./settings";

export async function loadWebSettings(supabase: SupabaseClient): Promise<WebSettings> {
  // 설정은 요청이 들어온 뒤에만 읽는다 (화면을 미리 만드는 단계에서 읽으면 안 된다)
  await connection();

  const { data, error } = await supabase.from("web_settings").select("key, value");
  if (error) {
    // DB가 돌려준 오류 문구는 내부 정보가 섞일 수 있어 그대로 옮기지 않는다 (SEC-11)
    throw new WebSettingsError(["웹 설정을 읽지 못했습니다 (DB 응답 오류)"]);
  }
  return parseWebSettings(data ?? []);
}

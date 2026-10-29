// Design Ref: DESIGN §6.1(settings), §9 — DB의 settings 테이블을 읽어 검증된 Settings로 돌려주는 서버 전용 함수
// 호출하는 쪽이 어떤 권한의 DB 연결을 쓸지 직접 넘긴다.
//   - 화면·서버 액션: `await createClient()` (로그인한 사용자 권한, RLS가 읽기를 허용)
//   - 점검 엔진·예약 점검: `createAdminClient()` (서버 관리용 키)
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { parseSettings, SettingsError, type Settings } from "./schema";

export async function loadSettings(supabase: SupabaseClient): Promise<Settings> {
  // 설정값은 요청이 들어온 뒤에만 읽는다. (화면을 미리 만드는 단계에서 읽으면 안 된다 — DESIGN 2.3)
  await connection();

  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) {
    // DB가 돌려준 오류 문구는 내부 정보가 섞일 수 있어 그대로 옮기지 않는다. (SEC-11)
    throw new SettingsError(["설정값을 읽지 못했습니다 (DB 응답 오류)"]);
  }
  return parseSettings(data ?? []);
}

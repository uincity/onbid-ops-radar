"use server";
// 서버 액션: 계획 점검 창 등록·취소 (DESIGN §5.6, Plan W15)
// 순서: 로그인·팀장 확인(서버에서 다시 확인, 버튼을 숨기는 것만으로는 안 됨) → Zod로 입력 검사(+KST→+09:00 변환은 maintenance.ts 한 곳) → DB 함수(팀장 한 번 더 확인, 겹침·길이 검사)
// 대상은 폼 값이 아니라 서버의 대상 등록부에서 가져온다(전체 대상 창은 만들지 않는다).
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { parseWindowInput, windowErrorMessage, WINDOW_ERROR_TEXT } from "@/lib/web-monitor/maintenance";
import { WEB_TARGETS } from "@/lib/web-monitor/registry";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { loadWebSettings } from "@/lib/web-monitor/settings-load";
import { getWebWindowWriter, isMockStore } from "@/lib/web-monitor/view-load";

export type WindowActionState = { status: "idle" } | { status: "ok"; message: string } | { status: "error"; message: string };

const fail = (message: string): WindowActionState => ({ status: "error", message });

export async function createWindowAction(_prev: WindowActionState, formData: FormData): Promise<WindowActionState> {
  // 1) 로그인과 팀장 확인은 화면이 아니라 서버에서 한다
  const user = await requireUser();
  if (user.role !== "admin") return fail(WINDOW_ERROR_TEXT.FORBIDDEN);

  // 2) 최대 길이 설정(web_window_max_hours). 화면 시험용 목 저장소에서는 DB를 읽지 않고 기본값을 쓴다
  let maxHours: number = DEFAULT_WEB_SETTINGS.windowMaxHours;
  if (!isMockStore()) {
    try {
      maxHours = (await loadWebSettings(await createClient())).windowMaxHours;
    } catch {
      return fail("점검 설정을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  // 3) 입력 검사 (KST 입력 → +09:00 ISO)
  const parsed = parseWindowInput(
    { targetKey: WEB_TARGETS.targets[0].key, start: formData.get("start"), end: formData.get("end"), reason: formData.get("reason") },
    { now: new Date(), maxHours },
  );
  if (!parsed.ok) return fail(parsed.message);

  // 4) 저장 (DB 함수가 팀장·겹침·길이를 다시 검사한다)
  let result;
  try {
    result = await (await getWebWindowWriter()).create(parsed.value);
  } catch {
    return fail(windowErrorMessage(null));
  }
  if (!result.ok) return fail(windowErrorMessage(result.code));

  revalidatePath("/web");
  return { status: "ok", message: "계획 점검 창을 등록했습니다." };
}

export async function cancelWindowAction(_prev: WindowActionState, formData: FormData): Promise<WindowActionState> {
  const user = await requireUser();
  if (user.role !== "admin") return fail(WINDOW_ERROR_TEXT.FORBIDDEN);

  const raw = formData.get("id");
  if (typeof raw !== "string" || !/^[1-9]\d{0,17}$/.test(raw)) return fail(WINDOW_ERROR_TEXT.WINDOW_NOT_FOUND);

  let result;
  try {
    result = await (await getWebWindowWriter()).cancel(Number(raw));
  } catch {
    return fail(windowErrorMessage(null));
  }
  if (!result.ok) return fail(windowErrorMessage(result.code));

  revalidatePath("/web");
  return { status: "ok", message: "점검 창을 취소했습니다." };
}

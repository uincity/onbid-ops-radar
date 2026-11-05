"use server";
// 서버 액션: 계획 점검 창 등록·취소 (DESIGN §5.6, Plan W15)
// 순서: 로그인·팀장 확인(서버에서 다시 확인, 버튼을 숨기는 것만으로는 안 됨) → Zod로 입력 검사(+KST→+09:00 변환은 maintenance.ts 한 곳) → DB 함수(팀장 한 번 더 확인, 겹침·길이 검사)
// 대상은 폼 값이 아니라 서버의 대상 등록부에서 가져온다(전체 대상 창은 만들지 않는다).
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { runManualWebCheck } from "@/lib/web-monitor/manual-check";
import { parseWindowInput, windowErrorMessage, WINDOW_ERROR_TEXT } from "@/lib/web-monitor/maintenance";
import { nodeTransport } from "@/lib/web-monitor/probes/node-transport";
import { allWebTargets, WEB_TARGETS } from "@/lib/web-monitor/registry";
import { runWebCheck } from "@/lib/web-monitor/runner";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { loadWebSettings } from "@/lib/web-monitor/settings-load";
import { createSupabaseWebStore } from "@/lib/web-monitor/store";
import { VERDICT_VIEW } from "@/lib/web-monitor/view";
import { buildMockData } from "@/lib/web-monitor/view-mock";
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

// ----- 수동 점검 (W17, DESIGN §5.7): 팀장의 "지금 점검" -----
// 결과는 기록만 한다: 상태·사건·이상징후·알림·재확인 예약을 바꾸지 않는다(핵심 흐름은 lib/web-monitor/manual-check.ts).
// 서울 리전은 vercel.json의 regions(icn1), 최대 실행 시간은 이 경로의 page.tsx maxDuration을 따른다.
export type ManualCheckState =
  | { status: "idle" }
  | { status: "ok"; message: string; runId: number }
  | { status: "error"; message: string };

export async function runWebCheckNowAction(): Promise<ManualCheckState> {
  // 로그인과 팀장 확인은 화면(버튼 숨김)이 아니라 서버에서 한다
  const user = await requireUser();
  if (user.role !== "admin") return { status: "error", message: "수동 점검은 팀장만 할 수 있습니다." };

  // 화면 시험용 목 저장소: 실제 사이트를 부르지 않고, 목 데이터의 수동 점검 줄로 연결한다
  if (isMockStore()) {
    if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("WEB_MONITOR_STORE=mock은 운영 배포에서 쓸 수 없습니다.");
    const manual = buildMockData(new Date(), WEB_TARGETS.targets[0].key).runs.find((r) => r.trigger === "manual");
    return manual ? { status: "ok", message: "점검을 마쳤습니다 (시험용 목 데이터).", runId: manual.id } : { status: "error", message: "시험용 데이터를 찾을 수 없습니다." };
  }

  const result = await runManualWebCheck({
    userId: user.id,
    prepare: async () => {
      const admin = createAdminClient();
      return { settings: await loadWebSettings(admin), store: createSupabaseWebStore(admin) };
    },
    targets: () => allWebTargets(),
    transport: nodeTransport,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    runWebCheck,
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/web");
  const verdictText = result.verdict ? `결과: ${VERDICT_VIEW[result.verdict].label}` : "점검을 끝까지 마치지 못했습니다";
  return { status: "ok", message: `${verdictText}. 점검 이력에 "수동"으로 기록되었고 현재 상태·알림에는 반영되지 않았습니다.`, runId: result.runId };
}

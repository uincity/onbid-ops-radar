"use server";
// 이상징후 처리 서버 액션 (PLAN 26·27): 배정 · 검토 시작 · 판정 저장 · 조치 완료 · 정상 판정 · 검토 재개
// 순서: ① 로그인·역할 확인 → ② Zod 입력 검사 → ③ 로그인한 사용자 연결로 DB 함수 호출 → ④ 성공하면 화면 갱신 → ⑤ 단순 결과 반환
// 권한·상태 전이·판정 짝·10자 규칙·버전 확인의 최종 판단은 DB 함수가 한다. 여기서는 그 결과를 화면용으로 옮길 뿐이다.
// 주의: 서버 관리용 연결(createAdminClient)은 쓰지 않는다. 쓰면 사용자가 없어 FORBIDDEN이 된다.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { ACTION_ERROR_MESSAGE, assignAnomaly, changeAnomalyStatus, setVerdict, type AnomalyActionResult } from "@/lib/anomalies/rpc";
import { SUCCESS_MESSAGE, formDataToRecord, parseActionInput, toRpcCall, type ActionState } from "@/lib/anomalies/action-input";

// useActionState에 넘기는 하나의 액션. 폼의 숨은 값 intent로 어떤 동작인지 구분한다.
export async function anomalyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(); // 로그인하지 않았거나 역할이 없으면 로그인/접근 불가 화면으로 보낸다

  const parsed = parseActionInput(formDataToRecord(formData));
  if (!parsed.ok) return { status: "error", code: parsed.code, message: parsed.message };

  const call = toRpcCall(parsed.action);
  const supabase = await createClient(); // 로그인한 사용자 권한(RLS 적용)

  let result: AnomalyActionResult;
  try {
    if (call.fn === "assign") result = await assignAnomaly(supabase, call);
    else if (call.fn === "verdict") result = await setVerdict(supabase, call);
    else result = await changeAnomalyStatus(supabase, call);
  } catch {
    // 연결 문제 등 예상 밖 오류: 내부 정보는 화면에 옮기지 않는다
    return { status: "error", code: "UNKNOWN", message: ACTION_ERROR_MESSAGE.UNKNOWN };
  }

  if (!result.ok) {
    return { status: "error", code: result.code, message: result.message, ...(result.duplicateId ? { duplicateId: result.duplicateId } : {}) };
  }

  revalidatePath(`/anomalies/${call.id}`);
  revalidatePath("/anomalies");
  revalidatePath("/");
  return { status: "success", message: SUCCESS_MESSAGE[parsed.action.intent], version: result.version };
}

// Design Ref: DESIGN §7(서버 액션 signIn/signOut), §8(오류 처리), PRD 4-4(이메일·비밀번호 로그인)
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "./schemas";
import { safeNextPath } from "./safe-next";

export type SignInState = {
  message?: string;
  // 틀렸을 때 이메일 칸을 다시 채워 주기 위한 값. 비밀번호는 절대 돌려주지 않는다.
  email?: string;
};

// 로그인 실패 이유를 사용자에게 보여 줄 말로 바꾼다.
// 계정이 없는지 비밀번호가 틀렸는지는 알려 주지 않고, 내부 오류 내용도 보여 주지 않는다. (SEC-11)
function messageFor(error: { code?: string; status?: number }): string {
  if (error.code === "invalid_credentials" || error.code === "email_not_confirmed") {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { message: "이메일과 비밀번호를 올바르게 입력해 주세요.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { message: messageFor(error), email };
  }

  // 성공하면 원래 가려던 화면(안전하게 다듬은 주소)으로 보낸다. redirect()는 try/catch 밖에서 불러야 한다.
  redirect(safeNextPath(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  // 이 브라우저의 로그인만 끝낸다. (같은 계정의 다른 기기 로그인은 유지)
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

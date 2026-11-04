// 비밀번호 설정 링크 확인 — 관리자가 만들어 준 일회용 링크(/auth/confirm?token_hash=...&type=recovery)를 확인하고 로그인시킨 뒤 비밀번호 설정 화면으로 보낸다.
// 링크 값이 틀렸거나 이미 썼거나 만료되었으면 로그인 화면으로 돌려보낸다. 이유(어느 쪽인지)는 알려 주지 않는다. (SEC-11)
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recoveryLinkSchema } from "@/lib/auth/schemas";

export async function GET(request: NextRequest) {
  const failed = () => NextResponse.redirect(new URL("/login?error=link", request.url));

  const parsed = recoveryLinkSchema.safeParse({
    token_hash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type"),
  });
  if (!parsed.success) return failed();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error) return failed();

  return NextResponse.redirect(new URL("/reset-password", request.url));
}

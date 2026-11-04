// 비밀번호 설정 화면 — 관리자가 준 링크로 들어온 사용자가 본인 비밀번호를 정한다.
// 로그인한 사용자만 열 수 있다(proxy.ts). 역할이 없는 계정은 사용 권한 없음 화면으로 보낸다.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getAuthState } from "@/lib/auth/current-user";

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-sm text-zinc-500">확인 중…</p>}>
        <ResetPasswordContent />
      </Suspense>
    </AuthShell>
  );
}

async function ResetPasswordContent() {
  const state = await getAuthState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "no-profile") redirect("/no-access");
  return <ResetPasswordForm email={state.user.email} />;
}

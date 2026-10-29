// Design Ref: DESIGN §4.1 — /login 로그인 화면 (로그인 없이 열 수 있는 유일한 화면)
// 폼은 처음부터 끝까지 같은 폼으로 유지한다. (?next=... 값은 폼 안의 숨은 칸이 알아서 읽는다 — login-form.tsx)
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}

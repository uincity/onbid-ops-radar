// Design Ref: DESIGN §4.1 — /login 로그인 화면 (로그인 없이 열 수 있는 유일한 화면)
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/auth/safe-next";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <AuthShell>
      {/* 주소의 ?next=...는 요청마다 달라지는 값이라 <Suspense>로 감싼다. 기다리는 동안에도 폼은 바로 보인다. */}
      <Suspense fallback={<LoginForm next="/" />}>
        <LoginWithNext searchParams={props.searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function LoginWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  return <LoginForm next={next} />;
}

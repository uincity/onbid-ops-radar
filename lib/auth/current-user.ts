// Design Ref: DESIGN §2.2(lib/auth), §9 — 서버에서 "지금 로그인한 사용자가 누구이고 역할이 무엇인지" 확인한다.
// proxy.ts가 1차로 막지만, 화면과 서버 액션은 여기서 다시 확인한다. (Next.js 문서: 서버 쪽에서 매번 재검증)
// 로그인 정보(쿠키)를 읽으므로, 이 함수를 부르는 화면 조각은 <Suspense>로 감싸야 한다. (Cache Components)
import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type Role = "operator" | "admin";

export type CurrentUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: Role;
};

export const ROLE_LABEL: Record<Role, string> = {
  operator: "운영 담당자",
  admin: "팀장",
};

export type AuthState =
  | { status: "anonymous" } // 로그인하지 않음
  | { status: "no-profile" } // 로그인은 했지만 역할(profiles)이 없음 → 사용 권한 없음
  | { status: "member"; user: CurrentUser };

export async function getAuthState(): Promise<AuthState> {
  // 로그인 확인은 반드시 "사용자 요청이 들어온 뒤"에만 실행한다. (화면을 미리 만드는 단계에서 실행되면 안 된다)
  // 로그인 확인 과정이 현재 시각(Date.now)을 읽기 때문에, 이 한 줄이 없으면 Next.js가 미리 만들기 중에 오류를 남긴다.
  await connection();

  const supabase = await createClient();

  // getUser()는 로그인 서비스(Auth)에 직접 물어보므로 쿠키를 위조해도 속지 않는다.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "anonymous" };

  // RLS가 적용된 사용자 권한으로 본인의 프로필(이름·역할)을 읽는다.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "operator" && profile.role !== "admin")) {
    return { status: "no-profile" };
  }

  return {
    status: "member",
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      displayName: profile.display_name,
      role: profile.role,
    },
  };
}

// 로그인하고 역할이 있는 사용자만 통과시킨다. 아니면 알맞은 화면으로 보낸다.
export async function requireUser(): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "no-profile") redirect("/no-access");
  return state.user;
}

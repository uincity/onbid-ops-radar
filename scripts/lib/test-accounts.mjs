// 시험 전용 계정 2개(팀장·운영 담당자)를 시험이 돌 때만 쓸 수 있게 준비하고, 끝나면 정지하는 도우미
// 화면 자동 테스트(test:e2e)와 계정 확인(check:accounts)이 함께 쓴다. 실사용 계정(실명)과는 전혀 다른 계정이다.
//
// - 비밀번호는 시험을 시작할 때마다 새로 무작위로 만들어 이 프로세스의 환경변수(E2E_*)에만 둔다. 파일·.env·로그에 남기지 않는다.
// - 시험이 끝나면 계정을 정지(ban)한다. 정지된 계정은 로그인할 수 없고 담당자 선택 목록에도 나타나지 않는다.
// - 계정을 지우지는 않는다: 시험 중 만든 처리 이력·보고서가 계정을 가리켜 지울 수 없다(이력은 수정·삭제 금지).
// - 이메일은 가상 도메인(example.com)이다. 실제 사람의 계정을 건드리지 않는다.
import { randomBytes } from "node:crypto";

export const TEST_ACCOUNTS = [
  { label: "팀장", role: "admin", displayName: "시험 팀장", email: "e2e-admin@example.com", emailVar: "E2E_ADMIN_EMAIL", passwordVar: "E2E_ADMIN_PASSWORD" },
  { label: "운영 담당자", role: "operator", displayName: "시험 담당자", email: "e2e-operator@example.com", emailVar: "E2E_OPERATOR_EMAIL", passwordVar: "E2E_OPERATOR_PASSWORD" },
];

const BAN_FOREVER = "876000h"; // 약 100년

async function findUserByEmail(supabase, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`계정 목록을 가져오지 못했습니다. (${error.message})`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

// 계정이 없으면 만들고, 정지를 풀고, 새 비밀번호를 정하고, 역할을 맞춘 뒤 환경변수(E2E_*)에 이메일·비밀번호를 둔다.
export async function prepareTestAccounts(supabase) {
  for (const account of TEST_ACCOUNTS) {
    const password = randomBytes(18).toString("base64url"); // 24자
    let user = await findUserByEmail(supabase, account.email);
    if (!user) {
      const { data, error } = await supabase.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { test: true } });
      if (error || !data.user) throw new Error(`시험 ${account.label} 계정을 만들지 못했습니다. (${error?.message ?? "알 수 없는 오류"})`);
      user = data.user;
    } else {
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true, ban_duration: "none" });
      if (error) throw new Error(`시험 ${account.label} 계정을 준비하지 못했습니다. (${error.message})`);
    }
    const { error: profileError } = await supabase.from("profiles").upsert({ id: user.id, display_name: account.displayName, role: account.role }, { onConflict: "id" });
    if (profileError) throw new Error(`시험 ${account.label} 계정의 역할을 저장하지 못했습니다. (${profileError.message})`);
    process.env[account.emailVar] = account.email;
    process.env[account.passwordVar] = password;
  }
}

// 시험이 끝나면 두 계정을 정지하고 비밀번호도 새 무작위 값으로 바꿔 둔다(이번 시험의 비밀번호가 남지 않게).
export async function releaseTestAccounts(supabase) {
  for (const account of TEST_ACCOUNTS) {
    const user = await findUserByEmail(supabase, account.email);
    if (!user) continue;
    await supabase.auth.admin.updateUserById(user.id, { password: randomBytes(24).toString("base64url"), ban_duration: BAN_FOREVER });
    delete process.env[account.passwordVar];
  }
}

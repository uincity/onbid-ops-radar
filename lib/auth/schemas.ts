// Design Ref: DESIGN §3(Zod), §7(서버 액션은 Zod로 입력값 검사) — 로그인 입력값 규칙
import { z } from "zod";

export const loginSchema = z.object({
  // 이메일은 형식과 길이(최대 254자)만 확인한다. 존재하는 계정인지는 로그인 서비스(Auth)가 판단한다.
  email: z.email().max(254),
  // 비밀번호는 비어 있지 않고 지나치게 길지만 않으면 된다. (규칙 검사는 계정을 만들 때 이미 했다)
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

// 비밀번호를 처음 정하거나 바꿀 때의 규칙: 길이만 본다(12~72자). 72자는 Supabase가 비밀번호를 저장할 때 읽는 한계다.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

export const newPasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"] });

// 비밀번호 설정 링크(/auth/confirm?token_hash=...&type=recovery)의 값 확인
export const recoveryLinkSchema = z.object({
  token_hash: z.string().min(10).max(200).regex(/^[A-Za-z0-9._-]+$/),
  type: z.literal("recovery"),
});

// 비밀번호 설정 규칙과 설정 링크 값 확인 (경계값: 11/12자, 72/73자)
import { describe, expect, it } from "vitest";
import { newPasswordSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, recoveryLinkSchema } from "@/lib/auth/schemas";

const pw = (length: number) => "a".repeat(length);

describe("newPasswordSchema (새 비밀번호)", () => {
  it("12자는 통과, 11자는 거부한다", () => {
    expect(newPasswordSchema.safeParse({ password: pw(PASSWORD_MIN_LENGTH), confirm: pw(PASSWORD_MIN_LENGTH) }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: pw(PASSWORD_MIN_LENGTH - 1), confirm: pw(PASSWORD_MIN_LENGTH - 1) }).success).toBe(false);
  });

  it("72자는 통과, 73자는 거부한다", () => {
    expect(newPasswordSchema.safeParse({ password: pw(PASSWORD_MAX_LENGTH), confirm: pw(PASSWORD_MAX_LENGTH) }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: pw(PASSWORD_MAX_LENGTH + 1), confirm: pw(PASSWORD_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it("확인 칸이 다르면 거부하고, 문제 위치는 confirm이다", () => {
    const result = newPasswordSchema.safeParse({ password: pw(14), confirm: pw(13) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path[0])).toEqual(["confirm"]);
  });
});

describe("recoveryLinkSchema (비밀번호 설정 링크 값)", () => {
  const hash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01";

  it("정상 값은 통과한다", () => {
    expect(recoveryLinkSchema.safeParse({ token_hash: hash, type: "recovery" }).success).toBe(true);
  });

  it("종류가 recovery가 아니거나 값이 없으면 거부한다", () => {
    expect(recoveryLinkSchema.safeParse({ token_hash: hash, type: "signup" }).success).toBe(false);
    expect(recoveryLinkSchema.safeParse({ token_hash: null, type: "recovery" }).success).toBe(false);
    expect(recoveryLinkSchema.safeParse({ token_hash: hash, type: null }).success).toBe(false);
  });

  it("너무 짧거나(9자) 허용하지 않는 문자가 들어 있으면 거부한다", () => {
    expect(recoveryLinkSchema.safeParse({ token_hash: "a".repeat(9), type: "recovery" }).success).toBe(false);
    expect(recoveryLinkSchema.safeParse({ token_hash: "a".repeat(10), type: "recovery" }).success).toBe(true);
    expect(recoveryLinkSchema.safeParse({ token_hash: `${hash}/../x`, type: "recovery" }).success).toBe(false);
    expect(recoveryLinkSchema.safeParse({ token_hash: "a".repeat(201), type: "recovery" }).success).toBe(false);
  });
});

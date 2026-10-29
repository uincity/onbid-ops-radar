// Design Ref: DESIGN §11.1 — Supabase 연결에 필요한 환경변수를 한곳에서 읽고 검사한다.
// 브라우저에도 공개되는 값(NEXT_PUBLIC_)만 이 파일에서 읽는다.
// NEXT_PUBLIC_ 값은 Next.js가 빌드할 때 코드에 직접 끼워 넣으므로 process.env.이름 형태로 그대로 써야 한다.

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 넣어 주세요. (npm run setup:env)",
    );
  }

  return { url, publishableKey };
}

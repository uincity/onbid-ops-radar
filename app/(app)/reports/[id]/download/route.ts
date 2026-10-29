// 보고서 Markdown 다운로드 (DESIGN §4.7). 로그인한 사용자만 받을 수 있다. 저장된 글을 그대로 내려준다.
import { reportFileName } from "@/lib/reports/model";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } }, { status: 401 });
  }

  if (!/^\d{1,15}$/.test(id)) return new Response("보고서를 찾을 수 없습니다.", { status: 404 });

  const { data } = await supabase.from("reports").select("report_date, source, content_md").eq("id", Number(id)).maybeSingle();
  if (!data) return new Response("보고서를 찾을 수 없습니다.", { status: 404 });

  return new Response(data.content_md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // 파일 이름에는 날짜와 출처만 쓴다 (한글·특수문자 없음)
      "Content-Disposition": `attachment; filename="${reportFileName(data.report_date, data.source)}"`,
      "Cache-Control": "no-store",
    },
  });
}

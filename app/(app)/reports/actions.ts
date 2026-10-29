"use server";
// 서버 액션: [보고서 생성] (DESIGN §5.3, PRD 5-4)
// 순서: 로그인·팀장 확인(SEC-03) → Zod로 날짜·출처 검사 → DB에서 집계(60초 안에) → reports에 스냅샷 1줄 추가 → 미리보기로 이동
// reports는 서버 관리용 키로만 추가할 수 있으므로, 팀장 확인이 끝난 뒤에만 createAdminClient를 쓴다.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidDateString, toKstDateString } from "@/lib/time";
import { generateReportModel, ReportError } from "@/lib/reports/generate";
import { renderReportMarkdown } from "@/lib/reports/markdown";

export type GenerateReportState = { status: "idle" } | { status: "error"; message: string };

// 보고서를 만드는 데 허용하는 시간(밀리초). PRD 3-1: 60초 이내
const TIME_LIMIT_MS = 60_000;

const inputSchema = z.object({
  date: z.string().refine(isValidDateString, "날짜를 YYYY-MM-DD 형식의 실제 있는 날짜로 입력해 주세요."),
  source: z.enum(["DEMO", "PUBLIC"], "출처는 DEMO 또는 PUBLIC 중에서 골라 주세요."),
});

const fail = (message: string): GenerateReportState => ({ status: "error", message });

export async function generateReportAction(_prev: GenerateReportState, formData: FormData): Promise<GenerateReportState> {
  // 1) 로그인과 팀장 확인은 화면이 아니라 서버에서 한다
  const user = await requireUser();
  if (user.role !== "admin") return fail("보고서 생성은 팀장만 할 수 있습니다.");

  // 2) 입력 검사
  const parsed = inputSchema.safeParse({ date: formData.get("date"), source: formData.get("source") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  const { date, source } = parsed.data;

  const now = new Date();
  if (date > toKstDateString(now)) return fail("아직 오지 않은 날짜의 보고서는 만들 수 없습니다.");

  // 3) 집계 (60초 제한)
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let model;
  try {
    const supabase = await createClient();
    model = await Promise.race([
      generateReportModel(supabase, { date, source, now }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReportError("보고서 생성이 60초를 넘어 중단했습니다. 잠시 뒤 다시 시도해 주세요.")), TIME_LIMIT_MS);
      }),
    ]);
  } catch (error) {
    return fail(error instanceof ReportError ? error.message : "보고서를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  model.generationMs = Date.now() - startedAt;
  const contentMd = renderReportMarkdown(model);

  // 4) 스냅샷 저장 (추가만 가능. 같은 날짜·출처를 여러 번 만들면 모두 남는다)
  const { data, error } = await createAdminClient()
    .from("reports")
    .insert({
      report_date: date,
      source,
      generated_by: user.id,
      covers_until: model.coversUntil,
      content_md: contentMd,
      summary: model,
    })
    .select("id")
    .single();

  if (error || !data) {
    // DB가 한 번 더 막은 경우(팀장 아님·미래 날짜 등)도 같은 안내로 돌려준다. 내부 오류 문구는 화면에 옮기지 않는다.
    return fail("보고서를 저장하지 못했습니다. 날짜와 권한을 확인한 뒤 다시 시도해 주세요.");
  }

  revalidatePath("/reports");
  redirect(`/reports/${data.id}`);
}

// Design Ref: DESIGN §4.6, §5.1 / PRD SEC-03 — 팀장의 수동 점검 실행 로직
// 서버 액션(app/(app)/runs/actions.ts)이 쓰는 핵심 흐름을 따로 뺀 것이다.
// 로그인 확인·설정 읽기·점검 엔진을 "밖에서 넣어 주는" 방식(의존 주입)이라 DB 없이도 시험할 수 있다.
// 순서: ① 로그인·팀장 확인 → ② 입력(출처·응답 종류) 검사 → ③ 점검 실행 → ④ 결과를 한국어 문구로 바꿈
import { z } from "zod";
import type { Settings } from "@/lib/settings/schema";
import { DEMO_MODES, createDemoFetcher } from "./demo-fetcher";
import type { RunCheckInput, RunCheckResult } from "./run-check";
import type { CheckStore } from "./types";

// 화면이 받는 결과. tone은 문구 색(성공/주의/실패)을 정한다.
export type ManualCheckResult = {
  ok: boolean;
  tone: "success" | "warning" | "error";
  message: string;
  runId?: number;
};

// 입력 검사: 출처는 DEMO/PUBLIC, 응답 시뮬레이션은 네 가지 중 하나여야 한다
export const manualCheckInputSchema = z.object({
  source: z.enum(["DEMO", "PUBLIC"]),
  mode: z.enum(DEMO_MODES),
});

export type ManualCheckUser = { id: string; role: "operator" | "admin" };

export type ManualCheckDeps = {
  // 지금 로그인한 사용자 (로그인하지 않았거나 역할이 없으면 null)
  getUser: () => Promise<ManualCheckUser | null>;
  // 서버 관리용 연결로 설정값과 저장소를 준비한다
  prepare: () => Promise<{ settings: Settings; store: CheckStore }>;
  runCheck: (input: RunCheckInput) => Promise<RunCheckResult>;
  now: () => number; // 지금 시각(ms)
};

const fail = (message: string): ManualCheckResult => ({ ok: false, tone: "error", message });

const STATUS_TEXT: Record<string, string> = {
  succeeded: "점검이 완료되었습니다.",
  partial: "점검이 일부만 완료되었습니다.",
  failed: "점검이 실패했습니다.",
};

export async function runManualCheck(rawInput: unknown, deps: ManualCheckDeps): Promise<ManualCheckResult> {
  // ① 화면에서 버튼을 숨기는 것만 믿지 않고, 서버에서 로그인과 팀장 역할을 다시 확인한다 (SEC-03)
  const user = await deps.getUser();
  if (!user) return fail("로그인이 필요합니다. 다시 로그인해 주세요.");
  if (user.role !== "admin") return fail("수동 점검은 팀장만 실행할 수 있습니다.");

  // ② 입력 검사
  const parsed = manualCheckInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("선택한 값이 올바르지 않습니다. 출처와 응답 시뮬레이션을 다시 골라 주세요.");
  const { source, mode } = parsed.data;
  if (source !== "DEMO") return fail("PUBLIC 조회기는 아직 없습니다(PLAN 33번). 지금은 DEMO만 점검할 수 있습니다.");

  // ③ 실행. 어떤 예외가 나도 내부 오류 문구는 화면에 내지 않는다
  try {
    const { settings, store } = await deps.prepare();
    const result = await deps.runCheck({
      trigger: "manual",
      source,
      triggeredBy: user.id,
      settings,
      store,
      fetcher: createDemoFetcher({ timeoutSeconds: settings.apiTimeoutSeconds, baseMs: deps.now(), mode }),
    });

    // ④ 결과 문구
    if (result.status === "blocked") {
      return { ok: false, tone: "warning", message: "이미 점검이 실행 중입니다. 끝난 뒤 다시 실행해 주세요.", runId: result.runId };
    }
    const r = result.registered;
    const message = `${STATUS_TEXT[result.status] ?? "점검이 끝났습니다."} API 호출 ${result.apiCallCount}회, 이상징후 등록: 새 건 ${r.created}, 재발 ${r.recurred}, 다시 탐지 ${r.detected_again}, 정상 판정 건과 같은 값 ${r.suppressed}.`;
    const tone = result.status === "succeeded" ? "success" : result.status === "partial" ? "warning" : "error";
    return { ok: result.status !== "failed", tone, message, runId: result.runId };
  } catch {
    return fail("점검을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

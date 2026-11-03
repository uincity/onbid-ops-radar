// Design Ref: DESIGN §5.1(예약 호출 방식), SEC-09·11 — 예약 점검 입구(POST /api/cron/daily-check)의 핵심 흐름
// 로그인 사용자가 아니라 Supabase Cron이 부르는 입구라서 CRON_SECRET 헤더로만 인증한다.
// 인증·설정 읽기·점검 엔진을 "밖에서 넣어 주는" 방식(의존 주입)이라 DB 없이도 시험할 수 있다. (manual-check.ts와 같은 방식)
// 응답에는 내부 정보(오류 문구·설정값·키)를 담지 않는다. 판단은 DB의 check_runs 기록으로 한다.
import { timingSafeEqual } from "node:crypto";
import type { Settings } from "@/lib/settings/schema";
import { createDemoFetcher } from "@/lib/checks/demo-fetcher";
import { buildPublicCheck } from "@/lib/checks/public-setup";
import type { RunCheckInput, RunCheckResult } from "@/lib/checks/run-check";
import type { CheckStore, Fetcher } from "@/lib/checks/types";

export type CronResponse = { httpStatus: number; body: { ok: boolean; message: string; runId?: number; status?: string } };

export type CronCheckDeps = {
  secret: () => string | undefined; // 서버에 설정된 CRON_SECRET
  prepare: () => Promise<{ settings: Settings; store: CheckStore }>;
  runCheck: (input: RunCheckInput) => Promise<RunCheckResult>;
  now: () => number;
  serviceKey: () => string | undefined; // DATA_GO_KR_SERVICE_KEY (PUBLIC 예약 점검에서만 읽는다)
};

const reply = (httpStatus: number, message: string, extra: Partial<CronResponse["body"]> = {}): CronResponse => ({ httpStatus, body: { ok: httpStatus === 200, message, ...extra } });

// 길이가 달라도 시간 차이로 값을 추측할 수 없게 같은 길이의 해시 대신 고정 길이로 맞춰 비교한다
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // 길이가 달라도 비교에 걸리는 시간을 비슷하게 맞춘다
    return false;
  }
  return timingSafeEqual(a, b);
}

// 헤더에서 비밀값을 꺼낸다: "Authorization: Bearer <값>" 만 받는다 (주소·본문으로는 받지 않는다)
export function bearerToken(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/.exec(authorization ?? "");
  return match ? match[1] : null;
}

export async function runScheduledCheck(authorization: string | null, deps: CronCheckDeps): Promise<CronResponse> {
  // ① 인증. 서버에 비밀값이 없으면 입구를 열어 두지 않고 거부한다 (설정 누락이 "인증 없음"이 되지 않게)
  const expected = deps.secret();
  if (!expected) return reply(503, "예약 점검 입구가 설정되지 않았습니다.");
  const given = bearerToken(authorization);
  if (!given || !sameSecret(given, expected)) return reply(401, "인증에 실패했습니다.");

  // ② 실행. 어떤 예외가 나도 내부 오류 문구는 응답에 내지 않는다
  try {
    const { settings, store } = await deps.prepare();
    const source = settings.scheduledSource; // 설정값: 예약 점검이 조회하는 출처 (기본 DEMO)
    let fetcher: Fetcher;
    let extraEndpoints: { endpoint: string; operationKey: string }[] | undefined;
    if (source === "PUBLIC") {
      const key = deps.serviceKey();
      // 서비스키가 없으면 요청을 보내지 않는다. 점검 기록이 생기지 않으므로 09:30 누락 감지가 이를 알린다
      if (!key) return reply(503, "예약 점검 출처가 PUBLIC인데 서비스키가 서버에 설정되어 있지 않아 실행하지 않았습니다.");
      const publicCheck = buildPublicCheck({ serviceKey: key, timeoutSeconds: settings.apiTimeoutSeconds, now: new Date(deps.now()), callIntervalMs: settings.publicCallIntervalMs });
      fetcher = publicCheck.fetcher;
      extraEndpoints = publicCheck.extraEndpoints;
    } else {
      fetcher = createDemoFetcher({ timeoutSeconds: settings.apiTimeoutSeconds, baseMs: deps.now(), mode: "normal" });
    }
    const result = await deps.runCheck({ trigger: "scheduled", source, triggeredBy: null, settings, store, fetcher, extraEndpoints });
    // 점검이 막혔거나 실패해도 "요청은 처리됨"이다. 결과는 check_runs에 남고 대시보드가 보여 준다
    return reply(200, "예약 점검 요청을 처리했습니다.", { runId: result.runId, status: result.status });
  } catch {
    return reply(500, "예약 점검 중 오류가 생겼습니다.");
  }
}

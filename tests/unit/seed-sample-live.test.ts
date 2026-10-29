// 예시 운영 데이터를 "진짜 Supabase DB"에 한 번 넣는 시드 (화면이 비어 보이지 않게 하는 용도)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run seed:sample`로만 실행한다 (SEED_SAMPLE=1).
// 주의: 이상징후 이력(anomaly_events)은 한번 만들면 지울 수 없다. 그래서 이상징후가 이미 하나라도 있으면 아무것도 하지 않고 끝낸다.
// 필요한 .env 값: 서버 관리용 키, 공개 키(publishable), 시연 계정 2개의 이메일·비밀번호. (값은 출력하지 않는다)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { assignAnomaly, changeAnomalyStatus, setVerdict, type AnomalyActionResult } from "@/lib/anomalies/rpc";
import { createDemoFetcher } from "@/lib/checks/demo-fetcher";
import { runCheck, type RunCheckResult } from "@/lib/checks/run-check";
import {
  buildPastRunPlan,
  buildTriagePlan,
  checkSeedSafety,
  logDateKst,
  tallyBy,
  validatePastRunPlan,
  type Actor,
  type TriageStep,
} from "@/lib/checks/sample-plan";
import { createSupabaseCheckStore } from "@/lib/checks/supabase-store";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { parseSettings, type Settings } from "@/lib/settings/schema";
import { toKstDateString } from "@/lib/time";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DEMO_ADMIN_EMAIL",
  "DEMO_ADMIN_PASSWORD",
  "DEMO_OPERATOR_EMAIL",
  "DEMO_OPERATOR_PASSWORD",
] as const;

const enabled = process.env.SEED_SAMPLE === "1";
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);

// 어디까지 했는지 기록해 두었다가, 중간에 멈추면 "부분 진행 상태"를 알려 준다
const progress: string[] = [];
const say = (line: string) => {
  progress.push(line);
  console.log(line);
};

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

describe.skipIf(!enabled)("예시 운영 데이터 시드", () => {
  it(
    "처음 실행할 때만 과거 점검 이력 · 이상징후 · 처리 이력을 만든다",
    async () => {
      // 필요한 환경변수가 없으면 어떤 것이 빠졌는지 이름만 알려 주고 멈춘다 (값은 출력하지 않는다)
      expect(missingEnv, `.env에 값이 없는 항목: ${missingEnv.join(", ")}`).toEqual([]);

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const db: SupabaseClient = createClient(url, process.env.SUPABASE_SECRET_KEY!, authOptions);

      // ----- 0. 안전장치: 처음 실행일 때만 -----
      const { count: runningCount, error: runningError } = await db.from("check_runs").select("id", { count: "exact", head: true }).eq("status", "running");
      expect(runningError).toBeNull();
      const { count: anomalyCount, error: anomalyError } = await db.from("anomalies").select("id", { count: "exact", head: true });
      expect(anomalyError).toBeNull();
      const safety = checkSeedSafety({ runningCount: runningCount ?? 0, anomalyCount: anomalyCount ?? 0 });
      if (!safety.ok) {
        console.log(safety.reason);
        console.log("아무것도 하지 않았습니다.");
        return; // 정상 종료
      }

      // 미리 모든 입력을 검증한다 (중간에 멈추는 일을 줄이기 위해)
      const { data: settingRows, error: settingsError } = await db.from("settings").select("key, value");
      expect(settingsError).toBeNull();
      const settings: Settings = parseSettings(settingRows ?? []);

      const login = async (actor: Actor) => {
        const prefix = actor === "admin" ? "DEMO_ADMIN" : "DEMO_OPERATOR";
        const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, authOptions);
        const { data, error } = await client.auth.signInWithPassword({ email: process.env[`${prefix}_EMAIL`]!, password: process.env[`${prefix}_PASSWORD`]! });
        if (error || !data.user) throw new Error(`시연 ${actor === "admin" ? "팀장" : "운영 담당자"} 계정으로 로그인하지 못했습니다. (npm run check:accounts로 확인해 주세요)`);
        const { data: profile } = await db.from("profiles").select("role").eq("id", data.user.id).single();
        const wantedRole = actor === "admin" ? "admin" : "operator";
        if (profile?.role !== wantedRole) throw new Error(`시연 ${actor} 계정의 역할이 ${wantedRole}이(가) 아닙니다. (npm run setup:accounts)`);
        return { client, id: data.user.id };
      };
      const admin = await login("admin");
      const operator = await login("operator");
      const actors: Record<Actor, { client: SupabaseClient; id: string }> = { admin, operator };

      const countOf = (endpoint: "demo-list" | "demo-detail") => DEMO_SCENARIOS.filter((s) => (endpoint === "demo-list" ? s.list : s.detail)).length;
      const pastPlan = buildPastRunPlan(toKstDateString(new Date()), { list: countOf("demo-list"), detail: countOf("demo-detail") });
      const problems = validatePastRunPlan(pastPlan);
      expect(problems, `과거 점검 이력 계획에 문제가 있습니다: ${problems.join(" / ")}`).toEqual([]);
      say("입력 검증 통과: 안전장치·설정값·시연 계정 2개·과거 이력 계획");

      const runIds: number[] = []; // 이 시드가 만든 점검 실행 번호들

      // ----- 1. 과거 6일치 점검 이력 (직접 insert) -----
      const pastIds: number[] = [];
      try {
        for (const run of pastPlan) {
          const { data, error } = await db
            .from("check_runs")
            .insert({
              trigger: run.trigger,
              source: "DEMO",
              status: run.status,
              started_at: run.startedAt.toISOString(),
              finished_at: run.finishedAt.toISOString(),
              api_call_count: run.apiCallCount,
              triggered_by: run.byAdmin ? admin.id : null,
            })
            .select("id")
            .single();
          if (error || !data) throw new Error(`과거 점검 실행을 넣지 못했습니다: ${run.label}`);
          pastIds.push(data.id);
          if (run.apiChecks.length > 0) {
            const { error: apiError } = await db.from("api_checks").insert(
              run.apiChecks.map((c) => ({
                run_id: data.id,
                endpoint_name: c.endpointName,
                http_status: c.httpStatus,
                duration_ms: c.durationMs,
                outcome: c.outcome,
                record_count: c.recordCount,
                data_valid: c.dataValid,
                checked_at: c.checkedAt.toISOString(),
              })),
            );
            if (apiError) throw new Error(`과거 API 점검 결과를 넣지 못했습니다: ${run.label}`);
          }
          if (run.logs.length > 0) {
            const { error: logError } = await db.from("run_logs").insert(
              run.logs.map((l) => ({ run_id: data.id, log_date: logDateKst(l.loggedAt), level: l.level, code: l.code, message: l.message, logged_at: l.loggedAt.toISOString() })),
            );
            if (logError) throw new Error(`과거 실행 메모를 넣지 못했습니다: ${run.label}`);
          }
        }
      } catch (error) {
        // 아직 이상징후가 없으므로 과거 이력은 깔끔하게 되돌릴 수 있다
        if (pastIds.length > 0) {
          await db.from("api_checks").delete().in("run_id", pastIds);
          await db.from("run_logs").delete().in("run_id", pastIds);
          await db.from("check_runs").delete().in("id", pastIds);
        }
        console.log("과거 점검 이력을 넣다가 실패해 넣은 것을 모두 되돌렸습니다. 이상징후는 만들지 않았습니다.");
        throw error;
      }
      runIds.push(...pastIds);
      say(`1단계 완료: 과거 점검 이력 ${pastIds.length}건 (api_checks·run_logs 포함)`);

      // ----- 이 아래부터는 이상징후가 만들어지므로 되돌릴 수 없다. 실패하면 어디까지 했는지 알리고 멈춘다 -----
      try {
        const runEngine = async (trigger: "scheduled" | "manual", label: string): Promise<RunCheckResult> => {
          const result = await runCheck({
            trigger,
            source: "DEMO",
            triggeredBy: trigger === "manual" ? admin.id : null,
            settings,
            store: createSupabaseCheckStore(db),
            fetcher: createDemoFetcher({ timeoutSeconds: settings.apiTimeoutSeconds, baseMs: Date.now() }),
          });
          runIds.push(result.runId);
          if (result.status !== "succeeded") throw new Error(`${label}: 점검이 정상 완료되지 않았습니다 (상태: ${result.status}).`);
          say(`${label} 완료: 점검 #${result.runId} · 탐지 ${result.detections.length}건 · 새 건 ${result.registered.created} / 재발 ${result.registered.recurred} / 재탐지 ${result.registered.detected_again} / 정상 판정과 같은 값 ${result.registered.suppressed}`);
          return result;
        };

        // ----- 2. 점검 엔진 1회차 (수동): 이상징후가 새로 생긴다 -----
        await runEngine("manual", "2단계(점검 1회차, 수동)");

        // ----- 3. 시연 계정으로 담당자 배정·검토·판정·종결·재개 -----
        const { data: rows, error: listError } = await db.from("anomalies").select("id").eq("source", "DEMO").order("id");
        if (listError || !rows) throw new Error("이상징후 목록을 읽지 못했습니다.");
        const steps: TriageStep[] = buildTriagePlan(rows.map((r) => Number(r.id)));

        const latestVersion = async (id: number): Promise<number> => {
          const { data, error } = await db.from("anomalies").select("version").eq("id", id).single();
          if (error || !data) throw new Error(`이상징후 #${id}의 최신 버전을 읽지 못했습니다.`);
          return Number(data.version);
        };

        for (const [index, step] of steps.entries()) {
          const expectedVersion = await latestVersion(step.anomalyId);
          const client = actors[step.actor].client;
          let result: AnomalyActionResult;
          if (step.kind === "assign") {
            result = await assignAnomaly(client, { id: step.anomalyId, assigneeId: actors[step.assignee].id, expectedVersion });
          } else if (step.kind === "verdict") {
            result = await setVerdict(client, { id: step.anomalyId, verdict: step.verdict, expectedVersion });
          } else {
            result = await changeAnomalyStatus(client, { id: step.anomalyId, toStatus: step.toStatus, verdict: step.verdict, note: step.note, expectedVersion });
          }
          if (!result.ok) {
            throw new Error(`3단계 처리 시나리오 ${index + 1}/${steps.length}번째 실패: 이상징후 #${step.anomalyId} ${step.kind} (${step.actor}) → 결과 코드 ${result.code}`);
          }
        }
        say(`3단계 완료: 담당자 배정·검토·판정·종결·재개 ${steps.length}단계 (이상징후 ${new Set(steps.map((s) => s.anomalyId)).size}건)`);

        // ----- 4. 점검 엔진 2회 더: 재탐지·재발·정상 판정 억제 이력이 생긴다 -----
        await runEngine("scheduled", "4단계(점검 2회차, 예약)");
        await runEngine("manual", "4단계(점검 3회차, 수동)");
      } catch (error) {
        console.log("");
        console.log("=== 시드가 중간에 멈췄습니다. 이상징후는 지울 수 없어 아래까지 진행된 상태로 남아 있습니다 ===");
        for (const line of progress) console.log(`  - ${line}`);
        console.log(`  - 만들어진 점검 실행 번호: ${runIds.join(", ")}`);
        throw error;
      }

      // ----- 요약 -----
      const { data: all } = await db.from("anomalies").select("status");
      const { count: eventCount } = await db.from("anomaly_events").select("id", { count: "exact", head: true });
      const byStatus = tallyBy((all ?? []).map((a) => String(a.status)));
      console.log("");
      console.log("=== 예시 운영 데이터 시드 완료 ===");
      console.log(`점검 실행: ${runIds.length}건 (과거 ${pastIds.length}건 + 엔진 실행 3건)`);
      console.log(`이상징후: 총 ${all?.length ?? 0}건 | 미확인 ${byStatus.open ?? 0} · 검토 중 ${byStatus.investigating ?? 0} · 조치 완료 ${byStatus.resolved ?? 0} · 정상 판정 ${byStatus.dismissed ?? 0}`);
      console.log(`이상징후 이력(anomaly_events): ${eventCount ?? 0}건`);
    },
    300_000,
  );
});

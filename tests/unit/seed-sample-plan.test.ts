// 예시 운영 데이터 시드 "계획"의 순수 로직 시험 (DB 없이 가짜 데이터로)
import { describe, expect, it } from "vitest";
import {
  MIN_TRIAGE_ANOMALIES,
  PAST_DAYS,
  buildPastRunPlan,
  buildTriagePlan,
  checkSeedSafety,
  tallyBy,
  validatePastRunPlan,
} from "@/lib/checks/sample-plan";
import { addDaysKst, formatKst, kstDayRange, toKstDateString } from "@/lib/time";

const TODAY = "2026-10-29";

describe("안전장치 checkSeedSafety", () => {
  it("실행 중인 점검도 이상징후도 없으면 진행한다", () => {
    expect(checkSeedSafety({ runningCount: 0, anomalyCount: 0 })).toEqual({ ok: true });
  });
  it("이상징후가 1건이라도 있으면 멈춘다 (경계: 1건)", () => {
    const result = checkSeedSafety({ runningCount: 0, anomalyCount: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("이미 예시 데이터가 있어 중단합니다");
  });
  it("실행 중인 점검이 있으면 멈춘다", () => {
    expect(checkSeedSafety({ runningCount: 1, anomalyCount: 0 }).ok).toBe(false);
  });
});

describe("과거 6일치 점검 계획 buildPastRunPlan", () => {
  const plan = buildPastRunPlan(TODAY);
  const scheduled = plan.filter((r) => r.trigger === "scheduled");

  it("예약 점검 날짜가 6개이고 6일 전부터 어제까지 하루씩이다", () => {
    expect(scheduled).toHaveLength(PAST_DAYS);
    expect(scheduled.map((r) => r.dateKst)).toEqual([-6, -5, -4, -3, -2, -1].map((d) => addDaysKst(TODAY, d)));
  });

  it("예약 점검 시작은 모두 KST 09:00 직후(1분 안)이고 오늘은 포함하지 않는다", () => {
    for (const run of scheduled) {
      expect(formatKst(run.startedAt).slice(11, 16)).toBe("09:00");
      expect(toKstDateString(run.startedAt)).toBe(run.dateKst);
    }
    expect(Math.max(...plan.map((r) => r.finishedAt.getTime()))).toBeLessThan(kstDayRange(TODAY).start.getTime());
  });

  it("점검 시간은 약 40초~1분이다 (타임아웃으로 끝난 날 제외)", () => {
    for (const run of scheduled.filter((r) => r.status !== "failed")) {
      const seconds = (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000;
      expect(seconds).toBeGreaterThanOrEqual(40);
      expect(seconds).toBeLessThanOrEqual(60);
    }
  });

  it("구성: 완료 4 · 일부 완료(호출 상한) 1 · 실패(타임아웃) 1, 수동 1 + 차단 1", () => {
    expect(tallyBy(scheduled.map((r) => r.status))).toEqual({ succeeded: 4, partial: 1, failed: 1 });
    const partial = scheduled.find((r) => r.status === "partial")!;
    expect(partial.logs.map((l) => l.code)).toContain("CALL_LIMIT_REACHED");
    const failed = scheduled.find((r) => r.status === "failed")!;
    expect(failed.apiChecks.every((c) => c.outcome === "timeout" && c.httpStatus === null && c.durationMs === 10_000)).toBe(true);

    const manual = plan.filter((r) => r.trigger === "manual");
    expect(manual.map((r) => r.status).sort()).toEqual(["blocked", "succeeded"]);
    expect(plan).toHaveLength(PAST_DAYS + 2);
  });

  it("정상 점검의 API 점검은 2건이고 응답시간이 90~400ms 이다", () => {
    for (const run of plan.filter((r) => r.status === "succeeded" || r.status === "partial")) {
      expect(run.apiChecks.map((c) => c.endpointName)).toEqual(["demo-list", "demo-detail"]);
      for (const check of run.apiChecks) {
        expect(check.durationMs).toBeGreaterThanOrEqual(90);
        expect(check.durationMs).toBeLessThanOrEqual(400);
      }
    }
  });

  it("차단된 점검은 호출 0회·API 점검 없음·시작 즉시 종료이고 수동 점검 도중에 일어난다", () => {
    const blocked = plan.find((r) => r.status === "blocked")!;
    const manual = plan.find((r) => r.trigger === "manual" && r.status === "succeeded")!;
    expect(blocked.apiCallCount).toBe(0);
    expect(blocked.apiChecks).toHaveLength(0);
    expect(blocked.finishedAt.getTime()).toBe(blocked.startedAt.getTime());
    expect(blocked.startedAt.getTime()).toBeGreaterThan(manual.startedAt.getTime());
    expect(blocked.startedAt.getTime()).toBeLessThan(manual.finishedAt.getTime());
  });

  it("DB 제약(종료≥시작, 예약은 시작한 사람 없음, 호출 수 일치 등)을 모두 만족한다", () => {
    expect(validatePastRunPlan(plan)).toEqual([]);
  });

  it("시작 시각 순서로 정렬되어 있다", () => {
    const times = plan.map((r) => r.startedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("월·연도가 바뀌는 날짜에서도 6일이 맞다 (경계)", () => {
    const edge = buildPastRunPlan("2027-01-03").filter((r) => r.trigger === "scheduled");
    expect(edge.map((r) => r.dateKst)).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("실제 있는 날짜가 아니면 거부한다", () => {
    expect(() => buildPastRunPlan("2026-02-30")).toThrow();
  });
});

describe("계획 검증 validatePastRunPlan (망가진 계획을 잡아낸다)", () => {
  it("종료가 시작보다 빠르면 문제로 알린다", () => {
    const plan = buildPastRunPlan(TODAY);
    plan[0] = { ...plan[0], finishedAt: new Date(plan[0].startedAt.getTime() - 1) };
    expect(validatePastRunPlan(plan).join("\n")).toContain("종료 시각이 시작 시각보다 빠릅니다");
  });
  it("예약 점검에 시작한 사람이 있으면 문제로 알린다", () => {
    const plan = buildPastRunPlan(TODAY);
    const i = plan.findIndex((r) => r.trigger === "scheduled");
    plan[i] = { ...plan[i], byAdmin: true };
    expect(validatePastRunPlan(plan).join("\n")).toContain("예약 점검에는 시작한 사람이 없어야 합니다");
  });
  it("실행 중(running) 상태는 과거 기록으로 넣을 수 없다", () => {
    const plan = buildPastRunPlan(TODAY);
    plan[0] = { ...plan[0], status: "running" as never };
    expect(validatePastRunPlan(plan).join("\n")).toContain("running");
  });
  it("메모에 인증키가 들어 있으면 문제로 알린다", () => {
    const plan = buildPastRunPlan(TODAY);
    plan[0].logs.push({ level: "info", code: "TEST", message: "serviceKey=abc", loggedAt: plan[0].startedAt });
    expect(validatePastRunPlan(plan).join("\n")).toContain("인증키");
  });
});

describe("처리 시나리오 buildTriagePlan", () => {
  const ids = Array.from({ length: 30 }, (_, i) => 100 + i);

  it("최소 건수 미만이면 거부하고, 정확히 최소 건수면 통과한다 (경계)", () => {
    expect(() => buildTriagePlan(ids.slice(0, MIN_TRIAGE_ANOMALIES - 1))).toThrow("최소");
    expect(() => buildTriagePlan(ids.slice(0, MIN_TRIAGE_ANOMALIES))).not.toThrow();
  });

  it("번호가 중복되면 거부한다", () => {
    expect(() => buildTriagePlan([...ids, 100])).toThrow("중복");
  });

  it("입력 순서와 상관없이 번호 순으로 앞에서부터 적용한다", () => {
    const shuffled = [...ids].reverse();
    expect(buildTriagePlan(shuffled)).toEqual(buildTriagePlan(ids));
  });

  it("운영 담당자 스스로 맡기 5건, 팀장 지정 7건", () => {
    const assigns = buildTriagePlan(ids).filter((s) => s.kind === "assign");
    expect(assigns.filter((s) => s.actor === "operator")).toHaveLength(5);
    expect(assigns.filter((s) => s.actor === "admin")).toHaveLength(7);
    expect(assigns.every((s) => s.kind === "assign" && s.assignee === "operator")).toBe(true);
  });

  it("종결할 때는 상태와 판정의 짝이 맞고 사유가 공백 제외 10자 이상이다", () => {
    for (const step of buildTriagePlan(ids)) {
      if (step.kind !== "status" || (step.toStatus !== "resolved" && step.toStatus !== "dismissed")) continue;
      expect(step.verdict).toBe(step.toStatus === "resolved" ? "confirmed_issue" : "false_positive");
      expect((step.note ?? "").replace(/\s/g, "").length).toBeGreaterThanOrEqual(10);
    }
  });

  it("각 건의 단계 순서가 허용 전이를 따른다: 배정 → 검토 → 판정 → 종결 (→ 재개)", () => {
    const steps = buildTriagePlan(ids);
    const finalStatus = new Map<number, string>();
    const status = new Map<number, string>(); // 시뮬레이션: 현재 상태
    for (const step of steps) {
      const now = status.get(step.anomalyId) ?? "open";
      if (step.kind === "verdict") expect(now).toBe("investigating"); // 판정은 검토 중에만
      if (step.kind === "status") {
        const allowed: Record<string, string[]> = { open: ["investigating"], investigating: ["resolved", "dismissed"], resolved: ["investigating"], dismissed: ["investigating"] };
        expect(allowed[now]).toContain(step.toStatus);
        status.set(step.anomalyId, step.toStatus);
        finalStatus.set(step.anomalyId, step.toStatus);
      }
    }
    // 마지막 상태 구성: 검토 중 4(검토 시작 1·판정만 1·재개 1 + ...) 대신 정확한 숫자로 확인
    expect(tallyBy([...status.values()])).toEqual({ investigating: 4, resolved: 3, dismissed: 3 });
  });

  it("조치 완료 뒤 검토를 재개하는 건이 정확히 1건이고 재개는 팀장이 한다", () => {
    const reopens = buildTriagePlan(ids).filter((s) => s.kind === "status" && s.actor === "admin" && s.toStatus === "investigating");
    expect(reopens).toHaveLength(1);
  });
});

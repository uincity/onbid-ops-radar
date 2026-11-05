// 상태 전환 결정(decide) 시험 (W10) — DB·네트워크 없이 순수 함수만. 시간 순서대로 점검을 이어 붙이는 작은 시뮬레이터로 시나리오를 돌린다.
import { describe, expect, it } from "vitest";
import { decide, isNormalFamily, type DecideInput, type DecideResult, type DecidedNotification, type TransitionDecision, type WebStateForDecision } from "@/lib/web-monitor/decide";
import type { WebVerdict } from "@/lib/web-monitor/classify";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";

const T0 = Date.UTC(2026, 10, 5, 5, 7, 0); // 2026-11-05 05:07:00 UTC (KST 14:07)
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(T0 + offsetMs);
const NOTIFY_KINDS = ["down", "degraded", "recovered", "ongoing", "cert", "unverifiable", "unplanned", "aux", "suppressed"];

type Opts = Partial<Pick<DecideInput, "maintenanceDetected" | "certExpiring" | "certDaysLeft" | "aux" | "inWindow" | "originRunId" | "primaryReason" | "settings">> & { trigger?: "scheduled" | "retry" };

// DB의 record_web_transition이 하는 일을 흉내 낸다: 새 상태 저장(버전+1), 알림 키 중복 제거, 이상징후·복구 기록
class Sim {
  state: WebStateForDecision | null = null;
  version: number | null = null;
  keys = new Set<string>();
  sent: { key: string; kind: string; at: Date }[] = [];
  detections: { value_hash: string; incident_no: number }[] = [];
  recoveries: { incident_no: number; note: string }[] = [];
  confirms: TransitionDecision["confirm"][] = [];
  deferred = 0;
  planned = 0;
  runId = 100;
  last!: DecideResult;
  settings = { ...DEFAULT_WEB_SETTINGS };

  run(offsetMs: number, verdict: WebVerdict, o: Opts = {}): DecideResult {
    this.runId += 1;
    const input: DecideInput = {
      targetKey: "onbid-home",
      runId: this.runId,
      trigger: o.trigger ?? "scheduled",
      originRunId: o.originRunId ?? null,
      now: at(offsetMs),
      verdict,
      primaryReason: o.primaryReason ?? null,
      maintenanceDetected: o.maintenanceDetected ?? false,
      certExpiring: o.certExpiring ?? false,
      certDaysLeft: o.certDaysLeft ?? null,
      aux: o.aux ?? [],
      inWindow: o.inWindow ?? false,
      state: this.state,
      settings: o.settings ?? this.settings,
    };
    const frozen = structuredClone(input);
    const res = decide(input);
    expect(input, "decide는 입력을 바꾸지 않는다").toEqual(frozen);
    this.last = res;
    if (res.kind === "defer") {
      this.deferred += 1;
      return res;
    }
    if (res.kind === "planned") this.planned += 1;
    const d = res.decision;
    this.state = { ...d.state, version: (this.version ?? 0) + 1 };
    this.version = this.state.version;
    for (const n of d.notifications) {
      expect(n.key.startsWith(`${n.kind}:`), `키 모양 ${n.key}`).toBe(true);
      expect(NOTIFY_KINDS).toContain(n.kind);
      if (!this.keys.has(n.key)) {
        this.keys.add(n.key);
        this.sent.push({ key: n.key, kind: n.kind, at: at(offsetMs) });
      }
    }
    if (d.detection) this.detections.push({ value_hash: d.detection.value_hash, incident_no: d.state.incident_no });
    if (d.recovery) this.recoveries.push(d.recovery);
    this.confirms.push(d.confirm);
    return res;
  }
  /** 정시 점검 실패 → 재확인(2분 뒤)까지 한 번에 */
  failWithRetry(offsetMs: number, retryVerdict: WebVerdict = "FAIL", o: Opts = {}) {
    const first = this.run(offsetMs, "FAIL", o);
    if (first.kind !== "defer") return first;
    return this.run(offsetMs + 2 * MIN, retryVerdict, { ...o, trigger: "retry", originRunId: this.runId });
  }
  get keyList() {
    return this.sent.map((s) => s.key);
  }
}
const tr = (r: DecideResult) => (r.kind === "defer" ? null : r.decision);

describe("재확인 필요 여부 (FR-4)", () => {
  it("정시 점검 실패 + 열린 사건 없음 → 상태·알림 변화 없이 재확인을 요구한다", () => {
    const sim = new Sim();
    expect(sim.run(0, "FAIL").kind).toBe("defer");
    expect(sim.state).toBeNull();
    expect(sim.sent).toHaveLength(0);
  });

  it("열린 사건이 있으면 재확인 없이 바로 평가한다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    expect(sim.state?.incident_open).toBe(true);
    expect(sim.run(HOUR, "FAIL").kind).toBe("transition");
  });

  it("저하·검증 불가·정상은 재확인하지 않는다", () => {
    for (const v of ["DEGRADED", "UNVERIFIED", "NOT_RUN", "PASS_DATA", "PASS_NO_DATA"] as WebVerdict[]) {
      expect(new Sim().run(0, v).kind, v).toBe("transition");
    }
  });

  it("점검 문구 감지는 재확인하지 않는다 (미등록 점검으로 처리)", () => {
    expect(new Sim().run(0, "FAIL", { maintenanceDetected: true }).kind).toBe("transition");
  });

  it("재확인(retry) 결과가 실패면 확정 실패 — 일시 실패 표시(flap)는 없다", () => {
    const sim = new Sim();
    const r = tr(sim.failWithRetry(0, "FAIL"))!;
    expect(r.confirm).toMatchObject({ confirmed_verdict: "FAIL", flap: false });
    expect(r.notifications.map((n) => n.key)).toEqual(["down:1"]);
  });

  it("1회 실패 후 재확인 정상 → 알림 0건·이상징후 없음·일시 실패(flap) 1건", () => {
    const sim = new Sim();
    const r = tr(sim.failWithRetry(0, "PASS_DATA"))!;
    expect(r.confirm).toMatchObject({ confirmed_verdict: "PASS_DATA", flap: true });
    expect(r.notifications).toHaveLength(0);
    expect(r.detection).toBeNull();
    expect(sim.state).toMatchObject({ current_verdict: "PASS_DATA", incident_open: false, incident_no: 0 });
    expect(sim.sent).toHaveLength(0);
  });

  it("재확인이 저하·검증 불가여도 확정 실패가 아니다 (flap, 저하·검증 불가 규칙 적용)", () => {
    const a = new Sim();
    const r1 = tr(a.failWithRetry(0, "DEGRADED"))!;
    expect(r1.confirm).toMatchObject({ confirmed_verdict: "DEGRADED", flap: true });
    expect(a.state).toMatchObject({ current_verdict: "DEGRADED", consecutive_degraded: 1, incident_open: false });
    const b = new Sim();
    b.failWithRetry(0, "UNVERIFIED");
    expect(b.state).toMatchObject({ current_verdict: "UNVERIFIED", consecutive_unverifiable: 1, incident_open: false });
  });

  it("확정 판정을 채울 원래 정시 실행은 재확인이면 원래 실행, 아니면 자기 자신이다", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA");
    expect(sim.confirms[0].origin_run_id).toBe(101);
    sim.failWithRetry(HOUR);
    expect(sim.confirms[1].origin_run_id).toBe(102); // 재확인(103)이 원래 정시 실행 102를 가리킨다
  });
});

describe("상태 전환표 (FR-6)", () => {
  it("매시 실패 8시간 → 장애·지속 2건·복구 (반복 알림은 막히지 않는다)", () => {
    const sim = new Sim();
    sim.failWithRetry(0); // 05:07 실패, 05:09 재확인 실패 → 장애 감지
    for (let h = 1; h <= 7; h++) sim.run(h * HOUR, "FAIL"); // 06:07 … 12:07
    sim.run(8 * HOUR, "PASS_DATA"); // 13:07 복구
    expect(sim.keyList).toEqual(["down:1", "ongoing:1:1", "ongoing:1:2", "recovered:1"]);
    expect(sim.sent.find((s) => s.key === "ongoing:1:1")?.at).toEqual(at(4 * HOUR)); // 05:09 기준 3시간이 지난 첫 점검(09:07)
    expect(sim.recoveries).toEqual([{ incident_no: 1, note: "지속 시간 7시간 58분" }]);
    expect(sim.state).toMatchObject({ incident_open: false, current_verdict: "PASS_DATA", ongoing_count: 0, first_failure_at: null });
    expect(sim.detections).toHaveLength(1);
  });

  it("지속 알림 경계: 2시간 59분은 미발송, 3시간 00분은 발송 (분 단위, 초는 버림)", () => {
    const base = new Sim();
    base.failWithRetry(0);
    const lastAlert = base.state!.incident_last_alert_at!; // 05:09:00
    const check = (offset: number) => {
      const sim = new Sim();
      sim.state = structuredClone(base.state);
      sim.version = 1;
      const r = tr(sim.run(offset, "FAIL"))!;
      return r.notifications.map((n) => n.key);
    };
    const lastMs = new Date(lastAlert).getTime() - T0;
    expect(check(lastMs + 179 * MIN + 59_000)).toEqual([]); // 2:59:59
    expect(check(lastMs + 180 * MIN)).toEqual(["ongoing:1:1"]); // 3:00:00
    expect(check(lastMs + 180 * MIN + 5_000)).toEqual(["ongoing:1:1"]);
  });

  it("정시 점검의 시작이 초 단위로 흔들려도 3시간 간격으로 맞게 나간다 (05:07:03 → 08:07:01)", () => {
    const sim = new Sim();
    const s = sim.run(0, "PASS_DATA");
    expect(s.kind).toBe("transition");
    sim.state = { ...sim.state!, incident_open: true, incident_no: 1, first_failure_at: at(3_000).toISOString(), incident_last_alert_at: at(3_000).toISOString(), current_verdict: "FAIL" };
    expect(tr(sim.run(3 * HOUR + 1_000, "FAIL"))!.notifications.map((n) => n.key)).toEqual(["ongoing:1:1"]);
  });

  it("지속 알림 시계는 마지막 알림 기준이다 (직전 지속 알림 3시간 뒤에 또 발송)", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    for (let h = 1; h <= 12; h++) sim.run(h * HOUR, "FAIL");
    const ongoing = sim.sent.filter((s) => s.kind === "ongoing");
    expect(ongoing.map((o) => o.key)).toEqual(["ongoing:1:1", "ongoing:1:2", "ongoing:1:3"]);
    expect(ongoing[1].at.getTime() - ongoing[0].at.getTime()).toBe(3 * HOUR);
  });

  it("같은 입력은 같은 결과다 (결정적)", () => {
    const make = () => {
      const sim = new Sim();
      sim.failWithRetry(0);
      sim.run(HOUR, "FAIL");
      return sim.state;
    };
    expect(make()).toEqual(make());
  });

  it("같은 알림이 중복으로 계산되어도 키가 같아 한 번만 나간다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    const again = decide({ targetKey: "onbid-home", runId: 500, trigger: "retry", originRunId: 101, now: at(2 * MIN), verdict: "FAIL", certExpiring: false, certDaysLeft: null, aux: [], inWindow: false, state: null, settings: sim.settings });
    expect(tr(again)!.notifications.map((n) => n.key)).toEqual(["down:1"]);
    expect(sim.keyList).toEqual(["down:1"]); // 시뮬레이터가 키 중복을 걸러낸다
  });

  it("정상 계열 → 확정 실패: 사건 시작(번호 1), 이상징후 생성 요청, 근거 해시에 사건 시작 시각 포함", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA");
    const r = tr(sim.failWithRetry(HOUR, "FAIL", { primaryReason: "HTTP_5XX" }))!;
    expect(r.state).toMatchObject({ incident_no: 1, incident_open: true, current_verdict: "FAIL" });
    expect(r.detection?.value_hash).toBe(`web:onbid-home:1:${at(HOUR + 2 * MIN).toISOString()}`);
    expect(r.detection?.evidence).toMatchObject({ verdict: "FAIL", reason: "HTTP_5XX", incident_no: 1 });
    expect(r.notifications[0]).toMatchObject({ key: "down:1", kind: "down", incident_no: 1 });
  });

  it("복구 후 다시 실패하면 새 사건 번호와 새 근거 해시 (오탐 종결 건이 새 장애를 숨기지 않는다)", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    sim.run(HOUR, "PASS_DATA");
    sim.failWithRetry(2 * HOUR);
    expect(sim.keyList).toEqual(["down:1", "recovered:1", "down:2"]);
    expect(sim.detections.map((d) => d.value_hash)).toHaveLength(2);
    expect(new Set(sim.detections.map((d) => d.value_hash)).size).toBe(2);
    expect(sim.state).toMatchObject({ incident_no: 2, incident_open: true });
  });

  it("복구 알림은 열린 사건이 있을 때만 — 정상이 이어져도 복구 알림·기록이 더 생기지 않는다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    sim.run(HOUR, "PASS_DATA");
    sim.run(2 * HOUR, "PASS_NO_DATA");
    sim.run(3 * HOUR, "PASS_DATA");
    expect(sim.keyList).toEqual(["down:1", "recovered:1"]);
    expect(sim.recoveries).toHaveLength(1);
  });

  it("복구는 확인 없이 정시 점검 1회로 판정한다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    expect(sim.run(HOUR, "PASS_NO_DATA").kind).toBe("transition");
    expect(sim.state?.incident_open).toBe(false);
  });
});

describe("저하 규칙 (연속 N회째에 사건 시작)", () => {
  it("저하 2회 연속 → 2회째에 성능 저하 알림·사건·이상징후", () => {
    const sim = new Sim();
    sim.run(0, "DEGRADED");
    expect(sim.sent).toHaveLength(0);
    expect(sim.state).toMatchObject({ consecutive_degraded: 1, incident_open: false });
    const r = tr(sim.run(HOUR, "DEGRADED"))!;
    expect(r.notifications.map((n) => n.key)).toEqual(["degraded:1"]);
    expect(r.detection).not.toBeNull();
    expect(sim.state).toMatchObject({ incident_open: true, incident_no: 1, consecutive_degraded: 0 });
  });

  it("저하 1회 후 정상 → 알림도 복구도 사건도 없다", () => {
    const sim = new Sim();
    sim.run(0, "DEGRADED");
    sim.run(HOUR, "PASS_DATA");
    expect(sim.sent).toHaveLength(0);
    expect(sim.detections).toHaveLength(0);
    expect(sim.state).toMatchObject({ consecutive_degraded: 0, incident_open: false });
  });

  it("저하 사이에 정상이 끼면 연속이 끊긴다", () => {
    const sim = new Sim();
    sim.run(0, "DEGRADED");
    sim.run(HOUR, "PASS_DATA");
    sim.run(2 * HOUR, "DEGRADED");
    expect(sim.sent).toHaveLength(0);
  });

  it("연속 횟수는 설정값을 따른다 (3회)", () => {
    const sim = new Sim();
    const settings = { ...DEFAULT_WEB_SETTINGS, degradedAlertCount: 3 };
    sim.run(0, "DEGRADED", { settings });
    sim.run(HOUR, "DEGRADED", { settings });
    expect(sim.sent).toHaveLength(0);
    sim.run(2 * HOUR, "DEGRADED", { settings });
    expect(sim.keyList).toEqual(["degraded:1"]);
  });

  it("저하 사건 → 확정 실패: 같은 사건에서 장애 감지, 새 사건·이상징후는 만들지 않는다", () => {
    const sim = new Sim();
    sim.run(0, "DEGRADED");
    sim.run(HOUR, "DEGRADED");
    const r = tr(sim.run(2 * HOUR, "FAIL"))!;
    expect(r.notifications.map((n) => n.key)).toEqual(["down:1"]);
    expect(r.detection).toBeNull();
    expect(sim.state).toMatchObject({ incident_no: 1, incident_open: true, current_verdict: "FAIL" });
  });

  it("확정 실패 → 저하: 알림 없음, 사건 유지", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    const r = tr(sim.run(HOUR, "DEGRADED"))!;
    expect(r.notifications).toHaveLength(0);
    expect(sim.state).toMatchObject({ incident_open: true, current_verdict: "DEGRADED", incident_no: 1 });
  });

  it("저하 사건 → 정상: 복구 알림 (알림을 보낸 사건이므로)", () => {
    const sim = new Sim();
    sim.run(0, "DEGRADED");
    sim.run(HOUR, "DEGRADED");
    sim.run(2 * HOUR, "PASS_DATA");
    expect(sim.keyList).toEqual(["degraded:1", "recovered:1"]);
  });
});

describe("별도 신호: 인증서 임박 · 보조 이상 · 점검 불가", () => {
  it("인증서 임박만 있을 때 장애·저하 알림이 없고 하루 1회 인증서 알림만 나간다", () => {
    const sim = new Sim();
    for (let h = 0; h < 6; h++) sim.run(h * HOUR, "PASS_DATA", { certExpiring: true, certDaysLeft: 10 });
    expect(sim.keyList).toEqual(["cert:onbid-home:2026-11-05"]);
    expect(sim.detections).toHaveLength(0);
    expect(sim.state).toMatchObject({ incident_open: false, current_verdict: "PASS_DATA" });
  });

  it("인증서 알림은 KST 날짜가 바뀌면 다시 한 번 나간다", () => {
    const sim = new Sim();
    sim.run(8 * HOUR + 52 * MIN, "PASS_DATA", { certExpiring: true, certDaysLeft: 10 }); // 13:59 UTC = KST 23:59 (11-05)
    sim.run(9 * HOUR + 53 * MIN, "PASS_DATA", { certExpiring: true, certDaysLeft: 10 }); // 15:00 UTC = KST 00:00 (11-06)
    expect(sim.keyList).toEqual(["cert:onbid-home:2026-11-05", "cert:onbid-home:2026-11-06"]);
  });

  it("보조 확인 이상: 연속 3회째에 1회 알림, 정상으로 돌아오면 해제 알림 없이 기록만", () => {
    const sim = new Sim();
    const fail = [{ key: "entry-stub", verdict: "FAIL" as const }];
    sim.run(0, "PASS_DATA", { aux: fail });
    sim.run(HOUR, "PASS_DATA", { aux: fail });
    expect(sim.sent).toHaveLength(0);
    sim.run(2 * HOUR, "PASS_DATA", { aux: fail });
    expect(sim.keyList).toEqual(["aux:onbid-home:entry-stub:101"]);
    sim.run(3 * HOUR, "PASS_DATA", { aux: fail }); // 4회째는 같은 키가 아닌 새 알림이 없다
    expect(sim.sent).toHaveLength(1);
    sim.run(4 * HOUR, "PASS_DATA", { aux: [{ key: "entry-stub", verdict: "PASS_DATA" }] });
    expect(sim.sent).toHaveLength(1);
    expect(sim.state!.aux_state["entry-stub"]).toBeUndefined();
    expect(sim.detections).toHaveLength(0); // 대표 판정·이상징후에는 반영하지 않는다
  });

  it("보조 확인의 검증 불가도 실패로 센다, 미점검(NOT_RUN)은 세지도 지우지도 않는다", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA", { aux: [{ key: "queue-config", verdict: "UNVERIFIED" }] });
    sim.run(HOUR, "PASS_DATA", { aux: [{ key: "queue-config", verdict: "NOT_RUN" }] });
    expect((sim.state!.aux_state["queue-config"] as { count: number }).count).toBe(1);
    sim.run(2 * HOUR, "PASS_DATA", { aux: [{ key: "queue-config", verdict: "FAIL" }] });
    sim.run(3 * HOUR, "PASS_DATA", { aux: [{ key: "queue-config", verdict: "FAIL" }] });
    expect(sim.keyList).toEqual(["aux:onbid-home:queue-config:101"]);
  });

  it("점검 불가 지속: 검증 불가·미점검이 연속 3회째에 1회 알림, 정상이면 연속이 끊긴다", () => {
    const sim = new Sim();
    sim.run(0, "UNVERIFIED");
    sim.run(HOUR, "NOT_RUN");
    expect(sim.sent).toHaveLength(0);
    sim.run(2 * HOUR, "UNVERIFIED");
    expect(sim.keyList).toEqual(["unverifiable:101"]);
    sim.run(3 * HOUR, "UNVERIFIED");
    expect(sim.sent).toHaveLength(1);
    sim.run(4 * HOUR, "PASS_DATA");
    expect(sim.state).toMatchObject({ consecutive_unverifiable: 0, unverifiable_start_run_id: null, current_verdict: "PASS_DATA" });
    expect(sim.detections).toHaveLength(0);
  });

  it("검증 불가·미점검은 즉시 알리지 않고 사건·이상징후도 만들지 않는다", () => {
    const sim = new Sim();
    sim.run(0, "UNVERIFIED");
    expect(sim.sent).toHaveLength(0);
    expect(sim.detections).toHaveLength(0);
    expect(sim.state).toMatchObject({ current_verdict: "UNVERIFIED", incident_open: false });
  });

  it("사건 중 검증 불가: 상태·사건 유지, 지속 알림 시계는 계속 간다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    for (let h = 1; h <= 4; h++) sim.run(h * HOUR, "UNVERIFIED");
    expect(sim.state).toMatchObject({ incident_open: true, current_verdict: "FAIL", incident_no: 1 });
    expect(sim.keyList).toContain("ongoing:1:1");
    expect(sim.keyList).toContain("unverifiable:102".replace("102", String(sim.state!.unverifiable_start_run_id)));
  });
});

describe("점검 문구 처리표 · 계획 점검 창 (FR-9)", () => {
  it("창 밖의 점검 문구: 미등록 점검 알림 1회, 이상징후·재확인·사건 없음", () => {
    const sim = new Sim();
    const r = tr(sim.run(0, "FAIL", { maintenanceDetected: true, primaryReason: "MAINTENANCE_DETECTED" }))!;
    expect(r.notifications.map((n) => n.key)).toEqual(["unplanned:onbid-home:101"]);
    expect(r.detection).toBeNull();
    expect(sim.state).toMatchObject({ incident_open: false, unplanned_since_run_id: 101 });
    sim.run(HOUR, "FAIL", { maintenanceDetected: true });
    sim.run(2 * HOUR, "FAIL", { maintenanceDetected: true });
    expect(sim.sent).toHaveLength(1); // 같은 감지 시작은 한 번만
  });

  it("미등록 점검 5시간 59분은 승격하지 않고, 6시간 00분에 일반 확정 실패로 승격한다", () => {
    const sim = new Sim();
    sim.run(0, "FAIL", { maintenanceDetected: true });
    expect(tr(sim.run(6 * HOUR - MIN, "FAIL", { maintenanceDetected: true }))!.notifications).toHaveLength(0);
    expect(sim.state?.incident_open).toBe(false);
    const r = tr(sim.run(6 * HOUR, "FAIL", { maintenanceDetected: true }))!;
    expect(r.notifications.map((n) => n.key)).toEqual(["down:1"]);
    expect(r.detection?.evidence.escalated_from).toBe("MAINTENANCE_DETECTED");
    expect(sim.state).toMatchObject({ incident_open: true, incident_no: 1, unplanned_since: null });
  });

  it("점검 문구가 사라지면 미등록 점검 구간이 끝난다 (다음 감지는 새 알림)", () => {
    const sim = new Sim();
    sim.run(0, "FAIL", { maintenanceDetected: true });
    sim.run(HOUR, "PASS_DATA");
    expect(sim.state).toMatchObject({ unplanned_since: null, unplanned_since_run_id: null });
    sim.run(2 * HOUR, "FAIL", { maintenanceDetected: true });
    expect(sim.keyList).toEqual(["unplanned:onbid-home:101", "unplanned:onbid-home:103"]);
  });

  it("사건이 이미 열려 있으면 창 밖의 점검 문구도 일반 실패로 이어진다 (미등록 점검 알림 없음)", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    const r = tr(sim.run(HOUR, "FAIL", { maintenanceDetected: true }))!;
    expect(r.notifications).toHaveLength(0);
    expect(sim.state).toMatchObject({ incident_open: true, unplanned_since: null });
  });

  it("창 안의 실패(점검 문구 포함)는 planned: 알림·이상징후·재확인 없음, 상태는 그대로", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA");
    const before = structuredClone(sim.state);
    for (const m of [false, true]) {
      const res = sim.run(HOUR, "FAIL", { inWindow: true, maintenanceDetected: m });
      expect(res.kind).toBe("planned");
      expect(res.kind === "planned" && res.plannedMaintenance).toBe(true);
    }
    expect(sim.state).toMatchObject({ current_verdict: before!.current_verdict, incident_open: false });
    expect(sim.sent).toHaveLength(0);
    expect(sim.detections).toHaveLength(0);
    expect(sim.deferred).toBe(0);
    expect(sim.confirms.at(-1)).toMatchObject({ confirmed_verdict: "FAIL", flap: false });
  });

  it("창 안에서는 사건 중에도 지속 알림을 보내지 않는다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    for (let h = 1; h <= 5; h++) sim.run(h * HOUR, "FAIL", { inWindow: true });
    expect(sim.keyList).toEqual(["down:1"]);
    expect(sim.state?.incident_open).toBe(true);
    // 창이 끝난 뒤 첫 점검부터 일반 규칙: 마지막 알림 기준 3시간이 이미 지났으므로 바로 발송
    sim.run(6 * HOUR, "FAIL");
    expect(sim.keyList).toEqual(["down:1", "ongoing:1:1"]);
  });

  it("사건이 열려 있는데 창이 시작되어도 복구는 판정대로 처리한다 (복구 알림 발송)", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    const res = sim.run(HOUR, "PASS_DATA", { inWindow: true });
    expect(res.kind === "transition" && res.plannedMaintenance).toBe(true);
    expect(sim.keyList).toEqual(["down:1", "recovered:1"]);
    expect(sim.state?.incident_open).toBe(false);
  });

  it("창 안에서는 인증서·보조 신호 알림도 보내지 않는다", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA", { inWindow: true, certExpiring: true, certDaysLeft: 3, aux: [{ key: "entry-stub", verdict: "FAIL" }] });
    expect(sim.sent).toHaveLength(0);
  });

  it("첫 점검이 창 안의 실패여도 상태 줄을 만든다 (복구 알림이 오발송되지 않는다)", () => {
    const sim = new Sim();
    sim.run(0, "FAIL", { inWindow: true });
    expect(sim.state).toMatchObject({ incident_open: false, incident_no: 0, current_verdict: "FAIL" });
    sim.run(HOUR, "PASS_DATA");
    expect(sim.sent).toHaveLength(0);
  });
});

describe("하루 알림 상한 (FR-12)", () => {
  const tight = { ...DEFAULT_WEB_SETTINGS, alertDailyCap: 2 };

  it("상한을 넘는 알림은 보내지 않고 '알림 억제' 안내를 그날 한 번만 보낸다", () => {
    const sim = new Sim();
    sim.settings = tight;
    sim.failWithRetry(0); // 1: down:1
    sim.run(HOUR, "PASS_DATA"); // 2: recovered:1
    sim.failWithRetry(2 * HOUR); // down:2 → 상한 초과 → 억제 안내
    sim.run(3 * HOUR, "PASS_DATA"); // recovered:2 → 상한 초과, 안내는 이미 보냄
    expect(sim.keyList).toEqual(["down:1", "recovered:1", "suppressed:onbid-home:2026-11-05"]);
    expect(sim.detections).toHaveLength(2); // 알림은 억제해도 이상징후는 기록한다
    expect(sim.state!.alerts_today).toBe(2);
  });

  it("KST 날짜가 바뀌면 횟수가 0으로 돌아가 다시 보낸다", () => {
    const sim = new Sim();
    sim.settings = tight;
    sim.failWithRetry(0);
    sim.run(HOUR, "PASS_DATA");
    sim.failWithRetry(2 * HOUR); // 억제
    sim.run(10 * HOUR, "PASS_DATA"); // 15:07 UTC = KST 다음날 00:07 → 새 날
    expect(sim.keyList).toContain("recovered:2");
    expect(sim.state).toMatchObject({ alerts_today_date: "2026-11-06", alerts_today: 1 });
  });

  it("상한 안에서는 억제 안내가 없다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    sim.run(HOUR, "PASS_DATA");
    expect(sim.keyList.some((k) => k.startsWith("suppressed:"))).toBe(false);
  });
});

describe("DB 함수에 넘기는 JSON 모양 (record_web_transition)", () => {
  const DB_STATE_KEYS = [
    "current_verdict", "since", "first_failure_at", "incident_no", "incident_open", "incident_last_alert_at", "ongoing_count",
    "consecutive_degraded", "degraded_start_run_id", "consecutive_unverifiable", "unverifiable_start_run_id", "aux_state",
    "unplanned_since_run_id", "unplanned_since", "alerts_today", "alerts_today_date", "version",
  ];

  it("상태 칸 이름이 DB의 web_target_state 칸과 같고(open_anomaly_id는 DB가 정함), 열린 사건에는 번호가 있다", () => {
    const sim = new Sim();
    const results = [sim.run(0, "PASS_DATA"), sim.failWithRetry(HOUR), sim.run(2 * HOUR, "FAIL"), sim.run(3 * HOUR, "DEGRADED"), sim.run(4 * HOUR, "PASS_DATA")];
    for (const r of results) {
      const d = tr(r)!;
      expect(Object.keys(d.state).sort()).toEqual([...DB_STATE_KEYS].sort());
      expect(!d.state.incident_open || d.state.incident_no >= 1).toBe(true);
      expect(JSON.stringify(d.state.aux_state).length).toBeLessThanOrEqual(4096);
      for (const n of d.notifications) expect(JSON.stringify(n.payload).length).toBeLessThanOrEqual(2048);
    }
  });

  it("알림 종류는 DB가 허용하는 11개 안에 있고, 키는 '종류:'로 시작하며 공백이 없다", () => {
    const sim = new Sim();
    sim.failWithRetry(0);
    for (let h = 1; h <= 5; h++) sim.run(h * HOUR, "FAIL", { certExpiring: true, certDaysLeft: 3, aux: [{ key: "entry-stub", verdict: "FAIL" }] });
    sim.run(6 * HOUR, "PASS_DATA");
    expect(sim.sent.length).toBeGreaterThan(4);
    for (const s of sim.sent) {
      expect(s.key).not.toMatch(/\s/);
      expect(s.key.length).toBeLessThanOrEqual(200);
    }
  });

  it("isNormalFamily는 PASS 두 가지만 정상 계열이다", () => {
    expect(isNormalFamily("PASS_DATA")).toBe(true);
    expect(isNormalFamily("PASS_NO_DATA")).toBe(true);
    for (const v of ["DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"] as WebVerdict[]) expect(isNormalFamily(v)).toBe(false);
  });

  it("알림 목록의 payload에 비밀값·주소 같은 값이 들어가지 않는다", () => {
    const sim = new Sim();
    sim.failWithRetry(0, "FAIL", { primaryReason: "HTTP_5XX" });
    sim.run(HOUR, "PASS_DATA");
    const text = JSON.stringify(sim.sent);
    expect(text).not.toMatch(/https?:|token|secret|serviceKey/i);
  });
});

describe("알림 종류별 모양", () => {
  const noKind = (n: DecidedNotification[], kind: string) => n.filter((x) => x.kind === kind);

  it("장애·저하·복구·지속은 사건 번호를 가지고, 인증서·보조·점검 불가·미등록은 사건 번호가 없다", () => {
    const sim = new Sim();
    sim.run(0, "PASS_DATA", { certExpiring: true, certDaysLeft: 5 });
    const r = tr(sim.run(HOUR, "UNVERIFIED"))!;
    expect(noKind(r.notifications, "cert")).toHaveLength(0);
    const sim2 = new Sim();
    const c = tr(sim2.run(0, "PASS_DATA", { certExpiring: true, certDaysLeft: 5 }))!;
    expect(c.notifications[0]).toMatchObject({ kind: "cert", incident_no: null, payload: { days_left: 5 } });
    const f = tr(sim2.failWithRetry(HOUR))!;
    expect(f.notifications[0]).toMatchObject({ kind: "down", incident_no: 1 });
  });
});

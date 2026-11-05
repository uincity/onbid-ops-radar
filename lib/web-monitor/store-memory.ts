// Design Ref: docs/design-homepage-monitoring.md §10(WEB_MONITOR_STORE=mock) / Plan W06·W11 — 메모리에만 남는 가짜 웹 점검 저장소
// 시험과 (나중에) 화면 시험에서 운영 DB를 건드리지 않으려고 쓴다. DB 함수와 같은 핵심 규칙만 흉내 낸다:
//   W06 점검 기록: 실행 중은 하나만, 이미 실행 중이면 blocked(정시면 대체 실행 대기 줄 예약), 같은 정시 칸 중복은 blocked(예약 없음), 종료는 running인 줄만.
//   W11 상태·재시도: 상태 버전 충돌(CONFLICT), 알림 키 중복 제거, 확인 재시도 예약(대상별 1개)·원자적 선점·멈춘 줄 복구·만료·다시 시도(최대 3번).
import type { ProbeResult, WebVerdict } from "./classify";
import { isInsideWindow, type MaintenanceWindow } from "./maintenance";
import type { TransitionDecision, WebStateForDecision } from "./decide";
import type { FinishWebRunInput, StartWebRunInput, StartWebRunResult, WebCheckStore } from "./store";
import type { NotifyStore, RecordAttemptInput, UnsentNotification } from "./notify/types";
import type { ClaimedRetry, RetryOriginRun, RetryOutcome, WebRetryStore, WebTransitionResult, WebTransitionStore } from "./transition-store";

export type MemoryRun = {
  id: number;
  targetKey: string;
  trigger: StartWebRunInput["trigger"];
  slotAt: Date | null;
  status: "running" | "succeeded" | "partial" | "failed" | "blocked";
  originRunId: number | null;
  triggeredBy: string | null;
  requestCount: number;
  overallVerdict: string | null;
  plannedMaintenance: boolean;
  startedAtMs: number;
  confirmedVerdict: WebVerdict | null;
  flap: boolean;
};
export type MemoryQueueRow = {
  id: number;
  targetKey: string;
  kind: "confirm" | "replace";
  originRunId: number | null;
  status: "pending" | "claimed" | "done" | "cancelled";
  dueAtMs: number;
  claimedAtMs: number | null;
  attempts: number;
};
export type MemoryNotification = { key: string; kind: string; targetKey: string; incidentNo: number | null; payload: Record<string, unknown>; createdAtMs: number };

export type MemoryWebStore = WebCheckStore &
  WebTransitionStore &
  WebRetryStore &
  NotifyStore & {
    readonly runs: MemoryRun[];
    readonly probes: { runId: number; targetKey: string; probe: ProbeResult }[];
    readonly queue: MemoryQueueRow[];
    readonly states: Map<string, WebStateForDecision>;
    readonly notifications: MemoryNotification[];
    readonly detections: { targetKey: string; valueHash: string; anomalyId: number }[];
    readonly recoveries: { anomalyId: number; incidentNo: number; note: string }[];
    /** 시험용: 알림 시도 기록(추가 전용 줄) */
    readonly attempts: RecordAttemptInput[];
    /** 시험용: 대상의 열린 이상징후를 담당자가 닫은 것처럼 만든다 */
    closeAnomaly(anomalyId: number): void;
    /** 시험용: 계획 점검 창을 검사 없이 등록한다 */
    readonly windows: MaintenanceWindow[];
    addWindow(w: { targetKey: string; startsAt: string; endsAt: string; cancelledAt?: string | null }): void;
  };

const STALE_CLAIM_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export function createMemoryWebStore(options: { now?: () => number } = {}): MemoryWebStore {
  const now = options.now ?? (() => Date.now());
  const runs: MemoryRun[] = [];
  const probes: MemoryWebStore["probes"] = [];
  const queue: MemoryQueueRow[] = [];
  const states = new Map<string, WebStateForDecision>();
  const notifications: MemoryNotification[] = [];
  const detections: MemoryWebStore["detections"] = [];
  const recoveries: MemoryWebStore["recoveries"] = [];
  const anomalies: { id: number; targetKey: string; open: boolean }[] = [];
  const notificationKeys = new Set<string>();
  const attempts: RecordAttemptInput[] = [];
  const leases = new Map<string, number>(); // 키 → 임대 끝 시각(ms)
  const windows: MaintenanceWindow[] = [];
  let nextId = 1;
  let nextQueueId = 1;
  let nextAnomalyId = 1;

  const isActive = (r: MemoryQueueRow) => r.status === "pending" || r.status === "claimed";

  // 멈춘 처리 중 줄 되돌리기(최대 3번)와 만료 — DB의 web_retry_housekeeping()과 같은 규칙
  const housekeeping = () => {
    for (const q of queue) {
      if (q.status === "claimed" && q.claimedAtMs !== null && now() - q.claimedAtMs > STALE_CLAIM_MS) {
        if (q.attempts < MAX_ATTEMPTS) {
          q.status = "pending";
          q.claimedAtMs = null;
          q.dueAtMs = now();
        } else q.status = "cancelled";
      }
    }
    for (const q of queue) {
      if (q.status !== "pending" || q.kind !== "confirm") continue;
      const origin = runs.find((r) => r.id === q.originRunId);
      const superseded = origin !== undefined && runs.some((n) => n.targetKey === q.targetKey && n.trigger === "scheduled" && n.status !== "blocked" && n.startedAtMs > origin.startedAtMs);
      if (!origin || superseded) q.status = "cancelled";
    }
  };

  const store: MemoryWebStore = {
    runs,
    probes,
    queue,
    states,
    notifications,
    detections,
    recoveries,
    attempts,
    closeAnomaly(anomalyId) {
      const a = anomalies.find((x) => x.id === anomalyId);
      if (a) a.open = false;
    },
    windows,
    addWindow(w) {
      windows.push({ id: windows.length + 1, targetKey: w.targetKey, startsAt: w.startsAt, endsAt: w.endsAt, reason: "시험", createdAt: new Date(now()).toISOString(), cancelledAt: w.cancelledAt ?? null });
    },

    // ----- W06 점검 기록 -----
    async startRun(input: StartWebRunInput): Promise<StartWebRunResult> {
      // DB의 제약과 같은 입력 규칙 (어긋나면 DB도 거부한다)
      if ((input.trigger === "scheduled") !== (input.slotAt != null)) throw new Error("정시 점검에만 정시 칸 시각이 있어야 합니다");
      if (input.triggeredBy && input.trigger !== "manual") throw new Error("담당자는 수동 점검에만 붙일 수 있습니다");
      if (input.originRunId != null && input.trigger !== "retry") throw new Error("원래 실행은 재확인에만 붙일 수 있습니다");

      const base: Omit<MemoryRun, "id" | "status"> = {
        targetKey: input.targetKey,
        trigger: input.trigger,
        slotAt: input.slotAt ?? null,
        originRunId: input.originRunId ?? null,
        triggeredBy: input.triggeredBy ?? null,
        requestCount: 0,
        overallVerdict: null,
        plannedMaintenance: false,
        startedAtMs: now(),
        confirmedVerdict: null,
        flap: false,
      };
      const running = runs.some((r) => r.status === "running");
      const slotTaken =
        input.trigger === "scheduled" &&
        runs.some((r) => r.trigger === "scheduled" && r.status !== "blocked" && r.targetKey === input.targetKey && r.slotAt?.getTime() === input.slotAt?.getTime());

      if (!running && !slotTaken) {
        const run: MemoryRun = { ...base, id: nextId++, status: "running" };
        runs.push(run);
        return { runId: run.id, status: "running" };
      }
      const blocked: MemoryRun = { ...base, id: nextId++, status: "blocked" };
      runs.push(blocked);
      // 정시가 "실행 중" 때문에 막혔을 때만 대체 실행을 예약한다(대상별 대기 줄 1개)
      if (input.trigger === "scheduled" && running && !slotTaken && !queue.some((q) => q.targetKey === input.targetKey && isActive(q))) {
        queue.push({ id: nextQueueId++, targetKey: input.targetKey, kind: "replace", originRunId: blocked.id, status: "pending", dueAtMs: now() + 60_000, claimedAtMs: null, attempts: 0 });
      }
      return { runId: blocked.id, status: "blocked" };
    },

    async saveProbeResults(runId, targetKey, list) {
      for (const probe of list) probes.push({ runId, targetKey, probe });
    },

    async finishRun(input: FinishWebRunInput) {
      const run = runs.find((r) => r.id === input.runId);
      if (!run || run.status !== "running") return false;
      run.status = input.status;
      run.overallVerdict = input.overallVerdict;
      run.requestCount = input.requestCount;
      run.plannedMaintenance = input.plannedMaintenance ?? false;
      return true;
    },

    // ----- W11 상태 전환 -----
    async loadState(targetKey) {
      const s = states.get(targetKey);
      return s ? structuredClone(s) : null;
    },

    async recordTransition(input): Promise<WebTransitionResult> {
      const cur = states.get(input.targetKey);
      if ((cur && input.expectedVersion !== cur.version) || (!cur && input.expectedVersion !== null)) return { result: "CONFLICT", version: cur ? cur.version : null };
      const run = runs.find((r) => r.id === input.runId);
      if (!run || run.targetKey !== input.targetKey) throw new Error("점검 실행을 찾을 수 없거나 대상이 다릅니다");
      if (run.trigger === "manual") throw new Error("수동 점검은 상태를 바꿀 수 없습니다");
      if (run.status !== "succeeded" && run.status !== "partial") throw new Error("정상 종료된 실행만 상태를 바꿀 수 있습니다");

      const d: TransitionDecision = input.decision;
      let anomalyId = cur ? openAnomalyOf(input.targetKey) : null;
      const oldAnomaly = anomalyId;
      if (d.detection) {
        const open = anomalies.find((a) => a.targetKey === input.targetKey && a.open);
        if (open) anomalyId = open.id;
        else {
          anomalyId = nextAnomalyId++;
          anomalies.push({ id: anomalyId, targetKey: input.targetKey, open: true });
        }
        detections.push({ targetKey: input.targetKey, valueHash: d.detection.value_hash, anomalyId });
      }
      let recovered = false;
      if (d.recovery) {
        const a = oldAnomaly === null ? undefined : anomalies.find((x) => x.id === oldAnomaly);
        if (a?.open) {
          recoveries.push({ anomalyId: a.id, incidentNo: d.recovery.incident_no, note: d.recovery.note });
          recovered = true;
        }
        if (!d.detection) anomalyId = null;
      }
      const version = (cur?.version ?? 0) + 1;
      states.set(input.targetKey, { ...structuredClone(d.state), version });
      openAnomalyByTarget.set(input.targetKey, anomalyId);

      const claimed: string[] = [];
      for (const n of d.notifications) {
        if (notificationKeys.has(n.key)) continue;
        notificationKeys.add(n.key);
        notifications.push({ key: n.key, kind: n.kind, targetKey: input.targetKey, incidentNo: n.incident_no, payload: n.payload, createdAtMs: now() });
        claimed.push(n.key);
      }
      let confirmed = false;
      const origin = runs.find((r) => r.id === d.confirm.origin_run_id);
      if (origin && origin.targetKey === input.targetKey && origin.trigger === "scheduled" && origin.confirmedVerdict === null) {
        origin.confirmedVerdict = d.confirm.confirmed_verdict;
        origin.flap = d.confirm.flap;
        confirmed = true;
      }
      return { result: "OK", version, anomalyId, claimed, recovered, confirmed };
    },

    async enqueueConfirm(input) {
      const origin = runs.find((r) => r.id === input.originRunId);
      if (!origin || origin.targetKey !== input.targetKey) throw new Error("원래 점검 실행을 찾을 수 없거나 대상이 다릅니다");
      if (origin.trigger !== "scheduled" || (origin.status !== "succeeded" && origin.status !== "partial")) throw new Error("정상 종료된 정시 실행만 확인 재시도를 예약할 수 있습니다");
      if (queue.some((q) => q.targetKey === input.targetKey && isActive(q))) return null;
      const row: MemoryQueueRow = { id: nextQueueId++, targetKey: input.targetKey, kind: "confirm", originRunId: input.originRunId, status: "pending", dueAtMs: now() + input.delaySec * 1000, claimedAtMs: null, attempts: 0 };
      queue.push(row);
      return row.id;
    },

    // ----- W15 계획 점검 창 -----
    async inMaintenance(targetKey, at) {
      return isInsideWindow(windows, targetKey, at);
    },

    async markPlanned(runId) {
      const run = runs.find((r) => r.id === runId);
      if (!run || run.trigger === "manual" || (run.status !== "succeeded" && run.status !== "partial")) return false;
      run.plannedMaintenance = true;
      return true;
    },

    // ----- W11 대기 줄 -----
    async claimDue(): Promise<ClaimedRetry | null> {
      housekeeping();
      const due = queue.filter((q) => q.status === "pending" && q.dueAtMs <= now()).sort((a, b) => a.dueAtMs - b.dueAtMs || a.id - b.id)[0];
      if (!due) return null;
      due.status = "claimed";
      due.claimedAtMs = now();
      due.attempts += 1;
      return { id: due.id, targetKey: due.targetKey, kind: due.kind, originRunId: due.originRunId, attempts: due.attempts };
    },

    async finish(id: number, outcome: RetryOutcome) {
      const row = queue.find((q) => q.id === id);
      if (!row || row.status !== "claimed") return false;
      if (outcome === "retry" && row.attempts < MAX_ATTEMPTS) {
        row.status = "pending";
        row.claimedAtMs = null;
        row.dueAtMs = now() + 60_000;
      } else row.status = outcome === "done" ? "done" : "cancelled";
      return true;
    },

    // ----- W12 알림 발송 -----
    async listUnsent(opts): Promise<UnsentNotification[]> {
      return notifications
        .filter((n) => !["stale", "resumed"].includes(n.kind))
        .filter((n) => n.createdAtMs <= now() - opts.olderThanMinutes * 60_000)
        .filter((n) => !opts.keys || opts.keys.includes(n.key))
        .filter((n) => {
          const mine = attempts.filter((a) => a.key === n.key);
          return !mine.some((a) => a.status === "sent") && Math.max(0, ...mine.map((a) => a.attempt)) < 5;
        })
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .slice(0, opts.limit)
        .map((n) => ({ key: n.key, kind: n.kind, targetKey: n.targetKey, incidentNo: n.incidentNo, payload: n.payload, attempts: Math.max(0, ...attempts.filter((a) => a.key === n.key).map((a) => a.attempt)), createdAt: new Date(n.createdAtMs) }));
    },

    async lease(key, seconds) {
      const mine = attempts.filter((a) => a.key === key);
      if (!notificationKeys.has(key) || mine.some((a) => a.status === "sent") || Math.max(0, ...mine.map((a) => a.attempt)) >= 5) return false;
      const until = leases.get(key);
      if (until !== undefined && until >= now()) return false;
      leases.set(key, now() + seconds * 1000);
      return true;
    },

    async recordAttempt(input) {
      const mine = attempts.filter((a) => a.key === input.key);
      if (!notificationKeys.has(input.key)) throw new Error("선점되지 않은 알림 키입니다");
      if (mine.some((a) => a.status === "sent")) throw new Error("이미 발송된 알림에는 시도를 더할 수 없습니다");
      if (input.attempt !== Math.max(0, ...mine.map((a) => a.attempt)) + 1) throw new Error("시도 번호는 마지막 시도 다음 번호여야 합니다");
      attempts.push({ ...input });
    },

    async latestAnomalyId(targetKey) {
      const mine = anomalies.filter((a) => a.targetKey === targetKey);
      return mine.length > 0 ? mine[mine.length - 1].id : null;
    },

    async getRun(runId): Promise<RetryOriginRun | null> {
      const r = runs.find((x) => x.id === runId);
      return r ? { targetKey: r.targetKey, trigger: r.trigger, slotAt: r.slotAt } : null;
    },
  };

  const openAnomalyByTarget = new Map<string, number | null>();
  function openAnomalyOf(targetKey: string): number | null {
    return openAnomalyByTarget.get(targetKey) ?? null;
  }
  return store;
}

// Design Ref: docs/design-homepage-monitoring.md §10(WEB_MONITOR_STORE=mock) / Plan W06 — 메모리에만 남는 가짜 웹 점검 저장소
// 시험과 (나중에) 화면 시험에서 운영 DB를 건드리지 않으려고 쓴다. DB 함수(start_web_check_run)와 같은 핵심 규칙만 흉내 낸다:
//   실행 중은 하나만, 이미 실행 중이면 blocked(정시면 대체 실행 대기 줄 예약), 같은 정시 칸 중복은 blocked(예약 없음), 종료는 running인 줄만.
import type { ProbeResult } from "./classify";
import type { FinishWebRunInput, StartWebRunInput, StartWebRunResult, WebCheckStore } from "./store";

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
};
export type MemoryQueueRow = { targetKey: string; kind: "replace"; originRunId: number; status: "pending" };

export type MemoryWebStore = WebCheckStore & {
  readonly runs: MemoryRun[];
  readonly probes: { runId: number; targetKey: string; probe: ProbeResult }[];
  readonly queue: MemoryQueueRow[];
};

export function createMemoryWebStore(): MemoryWebStore {
  const runs: MemoryRun[] = [];
  const probes: MemoryWebStore["probes"] = [];
  const queue: MemoryQueueRow[] = [];
  let nextId = 1;

  const store: MemoryWebStore = {
    runs,
    probes,
    queue,

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
      if (input.trigger === "scheduled" && running && !slotTaken && !queue.some((q) => q.targetKey === input.targetKey)) {
        queue.push({ targetKey: input.targetKey, kind: "replace", originRunId: blocked.id, status: "pending" });
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
  };
  return store;
}

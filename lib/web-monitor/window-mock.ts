// Design Ref: docs/design-homepage-monitoring.md §10(WEB_MONITOR_STORE=mock) / Plan W15 — 계획 점검 창 목 저장소 (화면 시험용, 운영 DB를 건드리지 않는다)
// 화면(읽기)과 서버 액션(쓰기)이 같은 창 목록을 보도록 globalThis에 둔다. 규칙은 DB 함수와 같게 검사한다(겹침·시작 전/진행 중 취소·끝난 창 거부).
import { overlapsAny, windowState, type MaintenanceWindow } from "./maintenance";
import type { WebWindowWriter } from "./window-store";

type Holder = { windows: MaintenanceWindow[]; nextId: number };
const KEY = "__webMockWindows";
const holder = (): Holder => {
  const g = globalThis as unknown as Record<string, Holder | undefined>;
  return (g[KEY] ??= { windows: [], nextId: 900 });
};

/** 화면용 목록(시작 늦은 순). 처음 읽을 때 예정된 창 하나를 심어 둔다 */
export function mockWindows(now: Date, targetKey: string): MaintenanceWindow[] {
  const h = holder();
  if (h.windows.length === 0) {
    const start = now.getTime() + 2 * 24 * 3_600_000;
    h.windows.push({ id: h.nextId++, targetKey, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3 * 3_600_000).toISOString(), reason: "시스템 정기 점검 (시험용)", createdAt: now.toISOString(), cancelledAt: null });
  }
  return [...h.windows].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export function createMockWindowWriter(): WebWindowWriter {
  return {
    async create(input) {
      const h = holder();
      const now = new Date();
      if (Date.parse(input.endsAt) <= now.getTime() || Date.parse(input.endsAt) <= Date.parse(input.startsAt)) return { ok: false, code: "WINDOW_INVALID" };
      if (overlapsAny(h.windows, input.targetKey, input.startsAt, input.endsAt)) return { ok: false, code: "WINDOW_OVERLAP" };
      const id = h.nextId++;
      h.windows.push({ id, targetKey: input.targetKey, startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(), reason: input.reason, createdAt: now.toISOString(), cancelledAt: null });
      return { ok: true, id };
    },
    async cancel(id) {
      const h = holder();
      const w = h.windows.find((x) => x.id === id);
      if (!w) return { ok: false, code: "WINDOW_NOT_FOUND" };
      const now = new Date();
      const state = windowState(w, now);
      if (state === "cancelled" || state === "ended") return { ok: false, code: "WINDOW_INVALID" };
      if (state === "active") w.endsAt = now.toISOString(); // 진행 중: 종료 시각을 지금으로 당긴다
      w.cancelledAt = now.toISOString();
      return { ok: true, id };
    },
  };
}

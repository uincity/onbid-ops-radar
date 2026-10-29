// lib/dashboard/summary.ts (대시보드 숫자 집계) 단위 테스트
// 오늘 경계(00:00:00 KST 포함 / 24:00 제외), 빈 데이터, 담당자 유무, 종결 건 제외를 중심으로 채점한다.
import { describe, expect, it } from "vitest";
import { summarizeDashboard, type AnomalyRow, type RunRow } from "@/lib/dashboard/summary";

// 2026-10-29 12:00 KST = 03:00 UTC
const NOW = new Date("2026-10-29T03:00:00Z");
// KST 2026-10-29 00:00:00 = UTC 2026-10-28 15:00:00
const DAY_START = "2026-10-28T15:00:00Z";
const DAY_END = "2026-10-29T15:00:00Z";
const ME = "user-me";
const OTHER = "user-other";

const run = (id: number, status: string, startedAt: string, extra: Partial<RunRow> = {}): RunRow => ({
  id,
  trigger: "scheduled",
  source: "DEMO",
  status,
  started_at: startedAt,
  finished_at: status === "running" ? null : startedAt,
  ...extra,
});

const anomaly = (extra: Partial<AnomalyRow> = {}): AnomalyRow => ({
  source: "DEMO",
  status: "open",
  rule_id: "DATE_ORDER",
  assignee_id: null,
  first_detected_at: "2026-10-20T00:00:00Z",
  ...extra,
});

const summarize = (runs: RunRow[], anomalies: AnomalyRow[], userId: string | null = ME) =>
  summarizeDashboard({ now: NOW, runs, anomalies, userId });

describe("빈 데이터", () => {
  it("모든 수치가 0이고 isEmpty이다", () => {
    const s = summarize([], []);
    expect(s.isEmpty).toBe(true);
    expect(s.date).toBe("2026-10-29");
    expect(s.today.runCount).toEqual({ total: 0, DEMO: 0, PUBLIC: 0 });
    expect(s.today.lastRun).toBeNull();
    expect(s.today.lastSuccessAt).toBeNull();
    expect(s.backlog.unresolved.total).toBe(0);
    expect(s.backlog.mine?.total).toBe(0);
    expect(s.recentRuns).toEqual([]);
  });

  it("userId가 없으면 내 담당 건수는 null이다", () => {
    expect(summarize([], [], null).backlog.mine).toBeNull();
  });
});

describe("오늘(KST) 점검 경계", () => {
  it("오늘 00:00:00 KST는 포함하고, 24:00(다음 날 00:00:00)은 제외한다", () => {
    const s = summarize(
      [
        run(1, "succeeded", "2026-10-28T14:59:59Z"), // 어제 23:59:59 KST → 제외
        run(2, "succeeded", DAY_START), // 오늘 00:00:00 → 포함
        run(3, "failed", "2026-10-29T14:59:59Z"), // 오늘 23:59:59 → 포함
        run(4, "succeeded", DAY_END), // 내일 00:00:00 → 제외
      ],
      [],
    );
    expect(s.today.runCount.total).toBe(2);
    expect(s.today.byStatus.succeeded.total).toBe(1);
    expect(s.today.byStatus.failed.total).toBe(1);
  });

  it("상태별(성공·일부·실패·차단·실행 중)과 출처별로 센다", () => {
    const s = summarize(
      [
        run(1, "succeeded", "2026-10-29T00:00:00Z"),
        run(2, "partial", "2026-10-29T01:00:00Z", { source: "PUBLIC" }),
        run(3, "failed", "2026-10-29T01:30:00Z"),
        run(4, "blocked", "2026-10-29T02:00:00Z"),
        run(5, "running", "2026-10-29T02:30:00Z"),
      ],
      [],
    );
    expect(s.today.runCount).toEqual({ total: 5, DEMO: 4, PUBLIC: 1 });
    expect(s.today.byStatus.partial).toEqual({ total: 1, DEMO: 0, PUBLIC: 1 });
    expect(s.today.byStatus.blocked.total).toBe(1);
    expect(s.today.byStatus.running.total).toBe(1);
  });

  it("마지막 실행은 오늘 가장 늦게 시작한 실행이고, 점검 기준 시각은 마지막 성공 실행의 종료 시각이다", () => {
    const s = summarize(
      [
        run(1, "succeeded", "2026-10-29T00:00:00Z", { finished_at: "2026-10-29T00:00:12Z" }),
        run(2, "failed", "2026-10-29T02:00:00Z"),
      ],
      [],
    );
    expect(s.today.lastRun).toMatchObject({ id: 2, status: "failed", startedAt: "2026-10-29 11:00:00" });
    expect(s.today.lastSuccessAt).toBe("2026-10-29 09:00:12");
  });

  it("오늘 실행이 없으면 마지막 실행은 null이지만 최근 실행 목록에는 어제 실행이 나온다", () => {
    const s = summarize([run(1, "succeeded", "2026-10-28T00:00:00Z")], []);
    expect(s.today.lastRun).toBeNull();
    expect(s.recentRuns.map((r) => r.id)).toEqual([1]);
  });
});

describe("최근 점검 실행 목록", () => {
  it("같은 번호는 한 번만, 최신순으로 5건까지 보여 준다", () => {
    const runs = [1, 2, 3, 4, 5, 6, 7].map((id) => run(id, "succeeded", `2026-10-2${id}T00:00:00Z`));
    const s = summarize([...runs, runs[6]], []);
    expect(s.recentRuns.map((r) => r.id)).toEqual([7, 6, 5, 4, 3]);
    expect(s.recentRuns[0].startedAt).toBe("2026-10-27 09:00:00");
  });
});

describe("미처리·미배정·내 담당", () => {
  it("미처리는 open+investigating이고 종결 건(resolved·dismissed)은 제외한다", () => {
    const s = summarize(
      [],
      [
        anomaly({ status: "open" }),
        anomaly({ status: "investigating", source: "PUBLIC" }),
        anomaly({ status: "resolved" }),
        anomaly({ status: "dismissed" }),
      ],
    );
    expect(s.backlog.unresolved).toEqual({ total: 2, DEMO: 1, PUBLIC: 1 });
    expect(s.backlog.byStatus.open.total).toBe(1);
    expect(s.backlog.byStatus.resolved.total).toBe(1);
    expect(s.backlog.byStatus.dismissed.total).toBe(1);
  });

  it("미배정은 담당자가 없는 미처리 건만 센다 (담당자 있음·종결 건 제외)", () => {
    const s = summarize(
      [],
      [
        anomaly({ assignee_id: null, status: "open" }),
        anomaly({ assignee_id: null, status: "investigating" }),
        anomaly({ assignee_id: OTHER, status: "open" }),
        anomaly({ assignee_id: null, status: "resolved" }),
      ],
    );
    expect(s.backlog.unassigned.total).toBe(2);
  });

  it("내 담당 미처리는 내게 배정된 미처리 건만 센다", () => {
    const s = summarize(
      [],
      [
        anomaly({ assignee_id: ME, status: "open" }),
        anomaly({ assignee_id: ME, status: "investigating", source: "PUBLIC" }),
        anomaly({ assignee_id: ME, status: "resolved" }),
        anomaly({ assignee_id: OTHER, status: "open" }),
        anomaly({ assignee_id: null, status: "open" }),
      ],
    );
    expect(s.backlog.mine).toEqual({ total: 2, DEMO: 1, PUBLIC: 1 });
  });
});

describe("규칙별 신규 이상징후 (오늘 first_detected_at)", () => {
  it("오늘 00:00:00 KST는 포함, 24:00은 제외하고 규칙별·출처별로 센다", () => {
    const s = summarize(
      [],
      [
        anomaly({ rule_id: "DATE_ORDER", first_detected_at: "2026-10-28T14:59:59Z" }), // 어제 → 제외
        anomaly({ rule_id: "DATE_ORDER", first_detected_at: DAY_START }),
        anomaly({ rule_id: "REQUIRED_FIELD", first_detected_at: "2026-10-29T14:59:59Z", source: "PUBLIC" }),
        anomaly({ rule_id: "LIST_DETAIL_MISMATCH", first_detected_at: DAY_END }), // 내일 → 제외
        anomaly({ rule_id: "EMPTY_RESULT", first_detected_at: "2026-10-29T05:00:00Z" }),
      ],
    );
    expect(s.newToday.DATE_ORDER.total).toBe(1);
    expect(s.newToday.REQUIRED_FIELD).toEqual({ total: 1, DEMO: 0, PUBLIC: 1 });
    expect(s.newToday.LIST_DETAIL_MISMATCH.total).toBe(0);
    expect(s.newToday.EMPTY_RESULT.total).toBe(1);
  });

  it("종결된 건도 오늘 처음 탐지됐다면 신규에 포함된다 (현재 건수와 기준이 다르다)", () => {
    const s = summarize([], [anomaly({ status: "dismissed", first_detected_at: "2026-10-29T01:00:00Z" })]);
    expect(s.newToday.DATE_ORDER.total).toBe(1);
    expect(s.backlog.unresolved.total).toBe(0);
  });
});

describe("모르는 값", () => {
  it("모르는 출처·규칙·상태는 세지 않아 화면이 깨지지 않는다", () => {
    const s = summarize(
      [run(1, "weird", "2026-10-29T01:00:00Z", { source: "ETC" })],
      [anomaly({ source: "ETC", rule_id: "X", status: "weird" })],
    );
    expect(s.today.runCount.total).toBe(0);
    expect(s.recentRuns).toEqual([]);
    expect(s.backlog.unresolved.total).toBe(0);
    expect(s.isEmpty).toBe(false);
  });
});

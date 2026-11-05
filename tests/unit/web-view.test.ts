// `/web` 화면의 값 계산 시험 (W13) — 24시간 띠 칸, 점검 이력 줄, 알림 기록 모으기, 경고 띠 두 종류의 켜짐·꺼짐 조건, 상태 카드. DB·화면 없이 순수 함수만.
import { describe, expect, it } from "vitest";
import { evaluateNotifyBanner, evaluateStaleBanner, buildStatusCard, buildStrip, formatSpan, groupNotifications, historyRow, HOUR_MS, offBanner, STRIP_LABEL, type WebNotificationRow, type WebProbeView, type WebRunView } from "@/lib/web-monitor/view";
import { bannersFrom } from "@/lib/web-monitor/view-banners";
import { buildMockData } from "@/lib/web-monitor/view-mock";
import { mapAnomaliesByIncident, toRunView, type RunRow } from "@/lib/web-monitor/view-source";

const NOW = new Date(Date.UTC(2026, 10, 5, 8, 30, 0)); // 2026-11-05 17:30 KST, 정시 칸 = 08:00 UTC
const SLOT = (i: number) => Math.floor(NOW.getTime() / HOUR_MS) * HOUR_MS - i * HOUR_MS; // i시간 전의 정시 칸
const probe = (layer: WebProbeView["layer"], verdict: WebProbeView["verdict"] = "PASS_DATA", extra: Partial<WebProbeView> = {}): WebProbeView => ({ layer, countsTowardOverall: !layer.startsWith("AUX"), verdict, reason: null, httpStatus: null, durationMs: null, finalUrl: null, certDaysLeft: null, detail: null, ...extra });
let id = 1;
const run = (over: Partial<WebRunView> = {}): WebRunView => ({
  id: id++, targetKey: "onbid-home", trigger: "scheduled", status: "succeeded", slotAt: new Date(SLOT(0)).toISOString(), startedAt: new Date(SLOT(0) + 7 * 60_000).toISOString(), finishedAt: new Date(SLOT(0) + 7 * 60_000 + 1500).toISOString(),
  originRunId: null, requestCount: 5, overall: "PASS_DATA", confirmed: "PASS_DATA", flap: false, planned: false, probes: [probe("L1_CONNECT"), probe("L2_HTTP", "PASS_DATA", { durationMs: 1100 }), probe("L3_CONTENT")], ...over,
});
const at = (i: number, over: Partial<WebRunView> = {}) => run({ slotAt: new Date(SLOT(i)).toISOString(), startedAt: new Date(SLOT(i) + 7 * 60_000).toISOString(), ...over });

describe("24시간 띠 (buildStrip)", () => {
  it("24칸이고 마지막 칸이 지금이 속한 정시 칸이다 (KST 시각 표시)", () => {
    const cells = buildStrip([at(0)], NOW);
    expect(cells).toHaveLength(24);
    expect(cells[23].slotAt).toBe(new Date(SLOT(0)).toISOString());
    expect(cells[23].hour).toBe("17"); // 08:00 UTC = 17시 KST
    expect(cells[0].hour).toBe("18"); // 23시간 전
  });

  it("기록이 없는 칸은 '기록 없음'이다 (현재 칸은 정시 점검 전이라는 안내)", () => {
    const cells = buildStrip([], NOW);
    expect(cells.every((c) => c.kind === "missing")).toBe(true);
    expect(cells[23].detail).toContain("전");
    expect(cells[0].detail).toContain("기록이 없습니다");
  });

  it("정상·저하·실패·확인 불가·미점검은 확정 판정으로 칸을 채운다", () => {
    const verdicts = ["PASS_DATA", "PASS_NO_DATA", "DEGRADED", "FAIL", "UNVERIFIED", "NOT_RUN"] as const;
    const cells = buildStrip(verdicts.map((v, i) => at(i, { overall: v, confirmed: v })), NOW);
    expect(verdicts.map((_, i) => cells[23 - i].kind)).toEqual([...verdicts]);
  });

  it("재확인을 기다리는 칸(실패인데 확정 판정이 비어 있음)은 '확인 중'이다", () => {
    const [cell] = buildStrip([at(2, { overall: "FAIL", confirmed: null })], NOW).filter((c) => c.runId !== null);
    expect(cell.kind).toBe("checking");
    expect(cell.label).toBe("확인 중");
  });

  it("재확인에서 정상이 된 칸은 정상이고 일시 실패(flap) 표시가 붙는다", () => {
    const [cell] = buildStrip([at(2, { overall: "FAIL", confirmed: "PASS_DATA", flap: true })], NOW).filter((c) => c.runId !== null);
    expect(cell).toMatchObject({ kind: "PASS_DATA", flap: true });
    expect(cell.detail).toContain("일시 실패");
  });

  it("계획 점검 표시가 있으면 '계획 점검', 점검 문구 감지인데 계획 점검이 아니면 '미등록 점검'이다", () => {
    const maintenance = [probe("L1_CONNECT"), probe("L2_HTTP", "FAIL", { reason: "MAINTENANCE_DETECTED" })];
    const cells = buildStrip([at(1, { overall: "FAIL", confirmed: "FAIL", planned: true, probes: maintenance }), at(3, { overall: "FAIL", confirmed: "FAIL", planned: false, probes: maintenance })], NOW);
    expect(cells[22].kind).toBe("planned");
    expect(cells[20].kind).toBe("unplanned");
  });

  it("차단된 실행·수동·재확인 실행은 띠에 들어가지 않는다 (정시 점검의 확정 판정만)", () => {
    const cells = buildStrip([at(1, { status: "blocked", overall: null, confirmed: null }), at(1, { trigger: "manual", slotAt: null }), at(1, { trigger: "retry", slotAt: null })], NOW);
    expect(cells[22].kind).toBe("missing");
  });

  it("같은 칸에 정시 실행이 둘이면 정상 종료된 것을 쓴다 (대체 실행)", () => {
    const failed = at(1, { status: "failed", overall: null, confirmed: null });
    const good = at(1, { overall: "PASS_DATA", confirmed: "PASS_DATA" });
    expect(buildStrip([failed, good], NOW)[22].kind).toBe("PASS_DATA");
    expect(buildStrip([good, failed], NOW)[22].kind).toBe("PASS_DATA");
  });

  it("점검 자체가 실패한 실행은 미점검 칸이다", () => {
    expect(buildStrip([at(1, { status: "failed", overall: null, confirmed: null })], NOW)[22].kind).toBe("NOT_RUN");
  });

  it("칸 이름과 설명에 글자가 있다 (색만으로 뜻을 전하지 않음)", () => {
    for (const c of buildStrip([at(0)], NOW)) expect(`${c.label}${c.detail}`.length).toBeGreaterThan(2);
    expect(Object.values(STRIP_LABEL).every((l) => l.length > 0)).toBe(true);
  });
});

describe("점검 이력 줄 (historyRow)", () => {
  it("정시 정상: 층 표시·응답 시간·확정 결과", () => {
    expect(historyRow(at(0, {}))).toMatchObject({ triggerLabel: "정시", resultLabel: "정상", responseMs: 1100, layers: { L1_CONNECT: "ok", L2_HTTP: "ok", L3_CONTENT: "ok" }, note: "" });
  });

  it("수동 점검은 '상태에 반영 안 됨'을 표시한다", () => {
    expect(historyRow(run({ trigger: "manual", slotAt: null, confirmed: null })).note).toContain("수동(상태에 반영 안 됨)");
  });

  it("재확인에서 정상이 된 정시 실행은 '일시 실패 해소', 실패 사유를 비고에 남긴다", () => {
    const r = run({ overall: "FAIL", confirmed: "PASS_DATA", flap: true, probes: [probe("L1_CONNECT"), probe("L2_HTTP", "FAIL", { reason: "HTTP_5XX", durationMs: 10000 }), probe("L3_CONTENT", "NOT_RUN")] });
    const h = historyRow(r);
    expect(h.note).toContain("일시 실패 해소");
    expect(h.note).toContain("HTTP_5XX");
    expect(h.layers).toMatchObject({ L2_HTTP: "fail", L3_CONTENT: "skip" });
  });

  it("차단된 실행은 결과 대신 '차단됨', 보조 확인은 층 표시에 쓰지 않는다", () => {
    const h = historyRow(run({ status: "blocked", overall: null, confirmed: null, probes: [] }));
    expect(h.resultLabel).toBe("차단됨");
    expect(h.note).toContain("건너뜀");
    expect(h.layers).toEqual({ L1_CONNECT: "none", L2_HTTP: "none", L3_CONTENT: "none" });
    const withAux = historyRow(run({ probes: [probe("L1_CONNECT"), probe("AUX_STUB", "FAIL")] }));
    expect(withAux.layers.L1_CONNECT).toBe("ok");
  });
});

describe("알림 기록 모으기 (groupNotifications)", () => {
  const n = (key: string, attempt: number, status: WebNotificationRow["status"], createdMin: number, kind = "down", extra: Partial<WebNotificationRow> = {}): WebNotificationRow =>
    ({ key, kind, targetKey: "onbid-home", attempt, status, responseCode: null, errorClass: null, createdAt: new Date(NOW.getTime() - createdMin * 60_000).toISOString(), ...extra });

  it("시도를 모아 알림 1건에 한 줄로 만들고 시도 횟수와 결과를 보인다", () => {
    const [g] = groupNotifications([n("down:1", 0, "queued", 60), n("down:1", 1, "failed", 60, "down", { errorClass: "http_5xx" }), n("down:1", 2, "sent", 59, "down", { responseCode: 200 })], NOW);
    expect(g).toMatchObject({ key: "down:1", attempts: 2, lastStatus: "sent", resultLabel: "발송됨", problem: false, kindLabel: "🔴 장애 감지" });
  });

  it("3회 모두 실패하면 '발송 실패'로 붉게(problem)", () => {
    const rows = [n("down:1", 0, "queued", 60), ...[1, 2, 3].map((a) => n("down:1", a, "failed", 60, "down", { errorClass: "timeout" }))];
    expect(groupNotifications(rows, NOW)[0]).toMatchObject({ resultLabel: "발송 실패", problem: true, attempts: 3, lastErrorClass: "timeout" });
  });

  it("실패가 1~2번이면 아직 '재시도 대기'로 문제로 세지 않는다", () => {
    expect(groupNotifications([n("down:1", 0, "queued", 20), n("down:1", 1, "failed", 20)], NOW)[0]).toMatchObject({ resultLabel: "재시도 대기", problem: false });
  });

  it("대기(queued)만 있고 15분이 지나지 않았으면 '발송 대기', 15분을 넘기면 '미발송'", () => {
    expect(groupNotifications([n("down:1", 0, "queued", 14)], NOW)[0]).toMatchObject({ resultLabel: "발송 대기", problem: false });
    expect(groupNotifications([n("down:1", 0, "queued", 16)], NOW)[0]).toMatchObject({ resultLabel: "미발송", problem: true });
  });

  it("최근 알림이 위로 정렬된다", () => {
    const keys = groupNotifications([n("down:1", 0, "queued", 300), n("cert:a:b", 0, "queued", 10, "cert")], NOW).map((g) => g.key);
    expect(keys).toEqual(["cert:a:b", "down:1"]);
  });
});

describe("경고 띠 ① 점검 정지 (evaluateStaleBanner)", () => {
  const base = { now: NOW, enabled: true, enabledSince: null, staleMin: 130 };
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

  it("마지막 정상 종료가 기준 시간 이내면 띠가 없고, 넘기면 켜진다 (경계: 130분 / 131분)", () => {
    expect(evaluateStaleBanner({ ...base, lastGoodFinishedAt: ago(130) })).toBeNull();
    const b = evaluateStaleBanner({ ...base, lastGoodFinishedAt: ago(131) });
    expect(b).toMatchObject({ id: "stale", level: "warning" });
    expect(b?.detail).toContain("131분");
  });

  it("점검이 꺼져 있으면 오래돼도 띄우지 않는다", () => {
    expect(evaluateStaleBanner({ ...base, enabled: false, lastGoodFinishedAt: ago(1000) })).toBeNull();
  });

  it("기준 시각은 max(마지막 정상 종료, 점검을 다시 켠 시각): 방금 켰으면 오래된 기록이 있어도 띄우지 않는다", () => {
    expect(evaluateStaleBanner({ ...base, lastGoodFinishedAt: ago(1000), enabledSince: ago(30) })).toBeNull();
    expect(evaluateStaleBanner({ ...base, lastGoodFinishedAt: ago(1000), enabledSince: ago(500) })).not.toBeNull();
  });

  it("정상 종료 기록이 한 번도 없으면 띠를 띄우지 않는다 (첫 점검 전)", () => {
    expect(evaluateStaleBanner({ ...base, lastGoodFinishedAt: null })).toBeNull();
  });
});

describe("경고 띠 ② 알림 미발송·발송 실패 (evaluateNotifyBanner)", () => {
  const g = (over: Partial<ReturnType<typeof groupNotifications>[number]>): ReturnType<typeof groupNotifications>[number] => ({
    key: "down:1", kind: "down", kindLabel: "🔴 장애 감지", targetKey: "onbid-home", createdAt: new Date(NOW.getTime() - 3 * HOUR_MS).toISOString(), attempts: 3, lastStatus: "failed", lastResponseCode: 500, lastErrorClass: "http_5xx", resultLabel: "발송 실패", problem: true, ...over,
  });

  it("최근 24시간 안의 문제 알림이 있으면 켜진다", () => {
    expect(evaluateNotifyBanner([g({})], NOW)).toMatchObject({ id: "notify", level: "warning" });
    expect(evaluateNotifyBanner([g({})], NOW)?.detail).toContain("1건");
  });

  it("24시간이 지난 문제 알림이나 문제가 아닌 알림만 있으면 꺼진다", () => {
    expect(evaluateNotifyBanner([g({ createdAt: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString() })], NOW)).toBeNull();
    expect(evaluateNotifyBanner([g({ problem: false, lastStatus: "sent", resultLabel: "발송됨" })], NOW)).toBeNull();
    expect(evaluateNotifyBanner([], NOW)).toBeNull();
  });

  it("이후 sent가 생기면(재발송 성공) 꺼진다", () => {
    const rows: WebNotificationRow[] = [0, 1, 2, 3].map((a) => ({ key: "down:1", kind: "down", targetKey: "onbid-home", attempt: a, status: a === 0 ? "queued" : "failed", responseCode: null, errorClass: a ? "timeout" : null, createdAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString() }));
    expect(evaluateNotifyBanner(groupNotifications(rows, NOW), NOW)).not.toBeNull();
    const fixed = [...rows, { key: "down:1", kind: "down", targetKey: "onbid-home", attempt: 4, status: "sent" as const, responseCode: 200, errorClass: null, createdAt: new Date(NOW.getTime() - 60_000).toISOString() }];
    expect(evaluateNotifyBanner(groupNotifications(fixed, NOW), NOW)).toBeNull();
  });
});

describe("띠 목록 만들기 (bannersFrom)", () => {
  const ok = <T,>(data: T) => ({ ok: true as const, data });
  const inputs = (over: Record<string, unknown> = {}) => ({
    settings: ok({ enabled: true, enabledSince: null, staleMin: 130 }),
    lastGoodFinishedAt: ok<string | null>(new Date(NOW.getTime() - 10 * 60_000).toISOString()),
    notifications: ok<WebNotificationRow[]>([]),
    ...over,
  });

  it("정상이면 띠가 없다", () => {
    expect(bannersFrom(inputs(), NOW, true)).toEqual([]);
  });

  it("점검이 꺼져 있으면 /web에서만 '꺼짐' 안내를 보이고 정지 띠는 없다 (대시보드에서는 아무것도 없음)", () => {
    const off = inputs({ settings: ok({ enabled: false, enabledSince: null, staleMin: 130 }), lastGoodFinishedAt: ok(new Date(NOW.getTime() - 99999 * 60_000).toISOString()) });
    expect(bannersFrom(off, NOW, true)).toEqual([offBanner()]);
    expect(bannersFrom(off, NOW, false)).toEqual([]);
  });

  it("설정을 읽지 못하면 띠를 만들지 않는다 (오류로 화면을 깨지 않는다)", () => {
    expect(bannersFrom(inputs({ settings: { ok: false } }), NOW, true)).toEqual([]);
  });

  it("정지와 알림 문제가 함께 켜질 수 있고, 한쪽 조회가 실패해도 다른 쪽은 보인다", () => {
    const both = inputs({
      lastGoodFinishedAt: ok(new Date(NOW.getTime() - 300 * 60_000).toISOString()),
      notifications: ok<WebNotificationRow[]>([{ key: "down:1", kind: "down", targetKey: "onbid-home", attempt: 0, status: "queued", responseCode: null, errorClass: null, createdAt: new Date(NOW.getTime() - 40 * 60_000).toISOString() }]),
    });
    expect(bannersFrom(both, NOW, false).map((b) => b.id)).toEqual(["stale", "notify"]);
    expect(bannersFrom({ ...both, notifications: { ok: false } }, NOW, false).map((b) => b.id)).toEqual(["stale"]);
  });
});

describe("현재 상태 카드 (buildStatusCard)", () => {
  it("상태 줄이 있으면 상태 줄의 확정 판정과 지속 시간을 보인다. 인증서·응답 시간은 최근 점검에서", () => {
    const card = buildStatusCard({
      now: NOW, state: { currentVerdict: "PASS_DATA", since: new Date(NOW.getTime() - (3 * 24 + 4) * HOUR_MS).toISOString(), incidentNo: 0, incidentOpen: false, openAnomalyId: null },
      runs: [at(0, { probes: [probe("L1_CONNECT", "PASS_DATA", { certDaysLeft: 38 }), probe("L2_HTTP", "PASS_DATA", { durationMs: 1120 }), probe("L3_CONTENT")] })], lastGoodFinishedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), staleBanner: null, enabled: true,
    });
    expect(card).toMatchObject({ verdictLabel: "정상", tone: "green", spanText: "3일 4시간", lastResponseMs: 1120, certDaysLeft: 38, source: "state", incident: null });
    expect(card.monitorText).toContain("정상 작동");
  });

  it("열린 사건이 있으면 이상징후 링크 정보를 담는다", () => {
    const card = buildStatusCard({ now: NOW, state: { currentVerdict: "FAIL", since: new Date(NOW.getTime() - HOUR_MS).toISOString(), incidentNo: 2, incidentOpen: true, openAnomalyId: 123 }, runs: [], lastGoodFinishedAt: null, staleBanner: null, enabled: true });
    expect(card).toMatchObject({ verdictLabel: "실패", tone: "red", incident: { no: 2, anomalyId: 123 } });
  });

  it("상태 줄이 아직 없으면 최근 정시·재확인 점검의 판정을 쓰고(수동 점검은 제외), 기록이 전혀 없으면 '기록 없음'", () => {
    const card = buildStatusCard({ now: NOW, state: null, runs: [run({ trigger: "manual", slotAt: null, overall: "FAIL", confirmed: null }), at(1, { overall: "PASS_DATA", confirmed: "PASS_DATA" })], lastGoodFinishedAt: null, staleBanner: null, enabled: true });
    expect(card).toMatchObject({ verdictLabel: "정상", source: "latest-run" });
    expect(buildStatusCard({ now: NOW, state: null, runs: [], lastGoodFinishedAt: null, staleBanner: null, enabled: true })).toMatchObject({ verdictLabel: "기록 없음", source: "none", lastCheckAt: null });
  });

  it("모니터 문구: 꺼짐 / 정지 의심 / 정상 작동", () => {
    const base = { now: NOW, state: null, runs: [], lastGoodFinishedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() };
    expect(buildStatusCard({ ...base, staleBanner: null, enabled: false }).monitorText).toContain("꺼져");
    expect(buildStatusCard({ ...base, staleBanner: { id: "stale", level: "warning", title: "", detail: "" }, enabled: true }).monitorText).toContain("정지 의심");
  });

  it("지속 시간 표기: 분 / 시간 / 일", () => {
    expect(formatSpan(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe("5분");
    expect(formatSpan(new Date(NOW.getTime() - 125 * 60_000).toISOString(), NOW)).toBe("2시간 5분");
    expect(formatSpan(new Date(NOW.getTime() - 28 * HOUR_MS).toISOString(), NOW)).toBe("1일 4시간");
  });
});

describe("DB 줄 변환·목 데이터", () => {
  it("DB 줄(snake_case)을 화면 모델로 바꾼다", () => {
    const row: RunRow = { id: 7, target_key: "onbid-home", trigger: "retry", status: "succeeded", slot_at: null, started_at: "2026-11-05T05:09:00Z", finished_at: "2026-11-05T05:09:02Z", origin_run_id: 6, request_count: 5, overall_verdict: "PASS_DATA", confirmed_verdict: null, flap: false, planned_maintenance: false };
    expect(toRunView(row, [])).toMatchObject({ id: 7, trigger: "retry", originRunId: 6, overall: "PASS_DATA", confirmed: null, probes: [] });
  });

  it("이상징후 evidence의 사건 번호로 사건 → 이상징후 표를 만든다 (같은 사건은 가장 최근 것)", () => {
    expect(mapAnomaliesByIncident([{ id: 10, evidence: { incident_no: 1 } }, { id: 12, evidence: { incident_no: 1 } }, { id: 11, evidence: { incident_no: 2 } }, { id: 13, evidence: null }, { id: 14, evidence: { reason: "x" } }])).toEqual({ 1: 12, 2: 11 });
  });

  it("목 데이터는 시나리오(확인 중·일시 실패·계획 점검·미등록 점검·저하)와 문제 알림을 담는다", () => {
    const now = new Date(Date.UTC(2026, 10, 5, 8, 30));
    const d = buildMockData(now, "onbid-home");
    const kinds = buildStrip(d.runs, now).map((c) => c.kind);
    for (const k of ["checking", "planned", "unplanned", "DEGRADED", "PASS_DATA"]) expect(kinds).toContain(k);
    expect(buildStrip(d.runs, now).some((c) => c.flap)).toBe(true);
    const groups = groupNotifications(d.notifications, now);
    expect(groups.some((x) => x.problem)).toBe(true);
    expect(groups.some((x) => x.lastStatus === "sent")).toBe(true);
    expect(d.runs.some((r) => r.trigger === "manual")).toBe(true);
    expect(d.runs.some((r) => r.status === "blocked")).toBe(true);
  });
});

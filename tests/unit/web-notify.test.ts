// 알림 메시지·채널·발송 흐름 시험 (W12) — 목 텔레그램(가짜 fetch)과 가짜 저장소만 쓴다. 실제로 어디에도 보내지 않는다.
import { describe, expect, it, vi } from "vitest";
import { base, out, type ProbeResult, type WebVerdict } from "@/lib/web-monitor/classify";
import { runScheduledWebCheck, type WebCronDeps } from "@/lib/web-monitor/cron-web-check";
import { runWebRetries, type WebRetryCronDeps } from "@/lib/web-monitor/cron-web-retry";
import { findWebTarget } from "@/lib/web-monitor/registry";
import { runWebCheck, type WebRunInput } from "@/lib/web-monitor/runner";
import { DEFAULT_WEB_SETTINGS } from "@/lib/web-monitor/settings";
import { createMemoryWebStore } from "@/lib/web-monitor/store-memory";
import type { TargetProbeOutcome } from "@/lib/web-monitor/probes/target";
import type { WebTransport } from "@/lib/web-monitor/probes/types";
import { deliverNotifications, MAX_ATTEMPTS_PER_NOTIFICATION, MAX_TRIES_PER_RUN, RECOVERY_AFTER_MINUTES } from "@/lib/web-monitor/notify/deliver";
import { createNotifierFromEnv } from "@/lib/web-monitor/notify";
import { buildMessage, escapeHtml, formatMinutes } from "@/lib/web-monitor/notify/messages";
import { createTelegramNotifier } from "@/lib/web-monitor/notify/telegram";
import { createLogNotifier } from "@/lib/web-monitor/notify/log";
import type { Notifier, SendResult, UnsentNotification } from "@/lib/web-monitor/notify/types";

const T0 = Date.UTC(2026, 10, 5, 5, 7, 0); // 2026-11-05 14:07 KST
const MIN = 60_000;
const TOKEN = "123456:SECRET-BOT-TOKEN";
const item = (over: Partial<UnsentNotification> = {}): UnsentNotification => ({ key: "down:1", kind: "down", targetKey: "onbid-home", incidentNo: 1, payload: { verdict: "FAIL", reason: "HTTP_5XX" }, attempts: 0, createdAt: new Date(T0), ...over });

describe("메시지 (PRD §8)", () => {
  const ctx = { targetLabel: "온비드 홈페이지", appBaseUrl: "https://onbid-ops-radar.vercel.app", anomalyId: 123 };

  it("장애 감지: 제목·KST 시각·판정과 사유·상세 링크", () => {
    const text = buildMessage(item(), ctx);
    expect(text.split("\n")).toEqual([
      "🔴 [온비드 홈페이지] 장애 감지",
      "시각: 2026-11-05 14:07 KST",
      "판정: 실패 — 서버 오류(5xx)",
      "상세: https://onbid-ops-radar.vercel.app/anomalies/123",
    ]);
  });

  it("복구: 지속 시간에 관측 간격 오차를 표기한다", () => {
    const text = buildMessage(item({ key: "recovered:1", kind: "recovered", payload: { minutes: 118 } }), ctx);
    expect(text).toContain("🟢 [온비드 홈페이지] 복구");
    expect(text).toContain("약 1시간 58분");
    expect(text).toContain("오차 있음");
    expect(text).toContain("/anomalies/123");
  });

  it("종류별 제목: 저하·지속·인증서·점검 불가·미등록 점검·보조 이상·억제", () => {
    const head = (kind: string, payload: Record<string, unknown> = {}) => buildMessage(item({ kind, key: `${kind}:x`, payload }), ctx).split("\n")[0];
    expect(head("degraded", { verdict: "DEGRADED" })).toBe("🟠 [온비드 홈페이지] 성능 저하");
    expect(head("ongoing", { minutes: 240, n: 1 })).toBe("⏳ [온비드 홈페이지] 장애 지속");
    expect(head("cert", { days_left: 9 })).toBe("🟡 [온비드 홈페이지] 인증서 만료 임박");
    expect(head("unverifiable", { count: 3 })).toBe("⚪ [온비드 홈페이지] 점검 불가 지속");
    expect(head("unplanned")).toBe("🔧 [온비드 홈페이지] 미등록 점검 감지");
    expect(head("aux", { probe: "aux-stub", count: 3 })).toBe("🟡 [온비드 홈페이지] 보조 점검 이상");
    expect(head("suppressed", { cap: 12 })).toBe("🔕 [온비드 홈페이지] 알림 억제");
  });

  it("사건이 아닌 알림(인증서·보조·점검 불가 등)에는 상세 링크를 넣지 않는다", () => {
    expect(buildMessage(item({ kind: "cert", key: "cert:a:b", payload: { days_left: 9 } }), ctx)).not.toContain("/anomalies/");
  });

  it("이상징후 번호나 https 앱 주소가 없으면 링크를 넣지 않는다", () => {
    expect(buildMessage(item(), { ...ctx, anomalyId: null })).not.toContain("상세");
    expect(buildMessage(item(), { ...ctx, appBaseUrl: undefined })).not.toContain("상세");
    expect(buildMessage(item(), { ...ctx, appBaseUrl: "http://evil.example" })).not.toContain("상세");
    expect(buildMessage(item(), { ...ctx, appBaseUrl: "https://a.example/path?x=1" })).not.toContain("상세");
  });

  it("모든 동적 값을 HTML 이스케이프한다 (parse_mode=HTML)", () => {
    const text = buildMessage(item({ payload: { verdict: "<b>FAIL</b>", reason: "<script>alert(1)</script>" } }), { ...ctx, targetLabel: 'A & "B" <i>' });
    expect(text).not.toMatch(/<(b|i|script)>/);
    expect(text).toContain("A &amp; &quot;B&quot; &lt;i&gt;");
    expect(text).toContain("&lt;b&gt;FAIL&lt;/b&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml("a&b<c>d\"e")).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });

  it("비밀값·내부 헤더·OpenAPI 문구가 들어가지 않는다", () => {
    const all = ["down", "degraded", "recovered", "ongoing", "cert", "unverifiable", "unplanned", "aux", "suppressed"].map((k) => buildMessage(item({ kind: k, key: `${k}:x`, payload: { verdict: "FAIL", reason: "TIMEOUT", minutes: 10, n: 1, days_left: 3, count: 3, cap: 12, probe: "aux-queue" } }), ctx)).join("\n");
    expect(all).not.toMatch(/Authorization|Bearer|serviceKey|token|secret|OpenAPI/i);
  });

  it("지속 시간 표기: 59분 / 1시간 0분 / 음수·비정상 값은 알 수 없음", () => {
    expect(formatMinutes(59)).toBe("59분");
    expect(formatMinutes(60)).toBe("1시간 0분");
    expect(formatMinutes(-1)).toBe("알 수 없음");
    expect(formatMinutes(Number.NaN)).toBe("알 수 없음");
  });
});

describe("텔레그램 채널 (목 서버)", () => {
  const mk = (handler: (url: string, init: RequestInit) => Promise<Response> | Response) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return handler(url, init);
    }) as unknown as typeof fetch;
    return { notifier: createTelegramNotifier({ token: TOKEN, chatId: "-100999", timeoutMs: 5000, fetchImpl }), calls };
  };

  it("200이면 성공이고, sendMessage에 HTML 모드로 한 번 요청한다", async () => {
    const { notifier, calls } = mk(() => new Response("{}", { status: 200 }));
    expect(await notifier.send("안녕")).toEqual({ ok: true, channel: "telegram", responseCode: 200, errorClass: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0].body).toMatchObject({ chat_id: "-100999", text: "안녕", parse_mode: "HTML", disable_web_page_preview: true });
  });

  it("429·5xx·4xx·네트워크 오류·시간 초과를 분류 이름으로만 돌려준다", async () => {
    const results: SendResult[] = [];
    for (const status of [429, 500, 503, 400]) results.push(await mk(() => new Response("{}", { status })).notifier.send("x"));
    results.push(await mk(() => { throw new TypeError("fetch failed https://api.telegram.org/bot" + TOKEN); }).notifier.send("x"));
    results.push(await mk(() => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }).notifier.send("x"));
    expect(results.map((r) => [r.ok, r.responseCode, r.errorClass])).toEqual([
      [false, 429, "rate_limited"], [false, 500, "http_5xx"], [false, 503, "http_5xx"], [false, 400, "http_4xx"], [false, null, "network_error"], [false, null, "timeout"],
    ]);
    for (const r of results) expect(r.errorClass).toMatch(/^[a-z0-9_]{1,40}$/); // DB 제약과 같은 모양: 내부 문구 불가
    expect(JSON.stringify(results)).not.toContain("SECRET");
  });

  it("너무 긴 메시지는 잘라서 보낸다 (텔레그램 4096자 제한)", async () => {
    const { notifier, calls } = mk(() => new Response("{}", { status: 200 }));
    await notifier.send("가".repeat(5000));
    expect(String(calls[0].body.text).length).toBeLessThanOrEqual(4000);
  });
});

describe("채널 선택 (WEB_NOTIFY_MODE)", () => {
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  const env = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-100999" };

  it("모드가 없거나 telegram이 아니면 텔레그램 값이 있어도 log 채널이다 (실제로 보내지 않음)", async () => {
    const lines: string[] = [];
    for (const mode of [undefined, "", "log", "TELEGRAM", "production"]) {
      const n = createNotifierFromEnv({ ...env, WEB_NOTIFY_MODE: mode }, { timeoutMs: 5000, fetchImpl: fetchSpy as unknown as typeof fetch, logSink: (l) => lines.push(l) });
      expect(n.channel, String(mode)).toBe("log");
      expect(await n.send("a\nb")).toMatchObject({ ok: true, channel: "log" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lines[0]).toBe("[web-notify:log] a | b");
    expect(lines.join("")).not.toContain("SECRET");
  });

  it("telegram 모드 + 비밀값이 있으면 텔레그램 채널", async () => {
    const n = createNotifierFromEnv({ ...env, WEB_NOTIFY_MODE: "telegram" }, { timeoutMs: 5000, fetchImpl: fetchSpy as unknown as typeof fetch });
    expect(n.channel).toBe("telegram");
    await n.send("x");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("telegram 모드인데 비밀값이 없으면 보내지 않고 not_configured 실패로 남긴다 (log로 바꿔 발송된 것처럼 보이지 않게)", async () => {
    const spy = vi.fn();
    for (const partial of [{}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_CHAT_ID: "-1" }]) {
      const n = createNotifierFromEnv({ ...partial, WEB_NOTIFY_MODE: "telegram" }, { timeoutMs: 5000, fetchImpl: spy as unknown as typeof fetch });
      expect(await n.send("x")).toEqual({ ok: false, channel: "telegram", responseCode: null, errorClass: "not_configured" });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("log 채널은 로그 한 줄만 남기고 성공으로 돌려준다", async () => {
    const lines: string[] = [];
    expect(await createLogNotifier((l) => lines.push(l)).send("hello")).toEqual({ ok: true, channel: "log", responseCode: null, errorClass: null });
    expect(lines).toEqual(["[web-notify:log] hello"]);
  });
});

// 발송 시험용: 결과를 순서대로 돌려주는 채널
function scripted(results: SendResult[]): Notifier & { sent: string[] } {
  const sent: string[] = [];
  let i = 0;
  return { channel: "telegram", sent, async send(text) { sent.push(text); return results[Math.min(i++, results.length - 1)]; } };
}
const OK: SendResult = { ok: true, channel: "telegram", responseCode: 200, errorClass: null };
const fail = (code: number | null, cls: string): SendResult => ({ ok: false, channel: "telegram", responseCode: code, errorClass: cls });

describe("발송 흐름 (deliver)", () => {
  const clock = (t = { v: T0 }) => ({ now: () => t.v, sleep: async (ms: number) => void (t.v += ms) });

  // 실제 흐름처럼 상태 전환을 거쳐 알림 키가 선점된 저장소를 만든다
  async function seeded() {
    const t = { v: T0 };
    const store = createMemoryWebStore({ now: () => t.v });
    const started = await store.startRun({ targetKey: "onbid-home", trigger: "scheduled", slotAt: new Date(T0) });
    await store.finishRun({ runId: started.runId, status: "succeeded", overallVerdict: "FAIL", requestCount: 5 });
    await store.recordTransition({
      runId: started.runId,
      targetKey: "onbid-home",
      expectedVersion: null,
      decision: {
        state: { current_verdict: "FAIL", since: new Date(T0).toISOString(), first_failure_at: new Date(T0).toISOString(), incident_no: 1, incident_open: true, incident_last_alert_at: new Date(T0).toISOString(), ongoing_count: 0, consecutive_degraded: 0, degraded_start_run_id: null, consecutive_unverifiable: 0, unverifiable_start_run_id: null, aux_state: {}, unplanned_since_run_id: null, unplanned_since: null, alerts_today: 1, alerts_today_date: "2026-11-05", version: 0 },
        detection: { evidence: {}, value_hash: "h" },
        recovery: null,
        notifications: [{ key: "down:1", kind: "down", incident_no: 1, payload: { verdict: "FAIL", reason: "HTTP_5XX" } }],
        confirm: { origin_run_id: started.runId, confirmed_verdict: "FAIL", flap: false },
      },
    });
    return { store, t };
  }

  it("첫 시도에 성공하면 한 번만 보내고 시도 1줄(sent)을 남긴다. 메시지에 현재 이상징후 링크가 들어간다", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([OK]);
    const s = await deliverNotifications({ store, notifier, clock: clock(t), appBaseUrl: "https://onbid-ops-radar.vercel.app", keys: ["down:1"] });
    expect(s).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toContain("🔴 [온비드 홈페이지] 장애 감지");
    expect(notifier.sent[0]).toContain("https://onbid-ops-radar.vercel.app/anomalies/1");
    expect(store.attempts).toEqual([{ key: "down:1", attempt: 1, channel: "telegram", status: "sent", responseCode: 200, errorClass: null }]);
  });

  it("실패하면 같은 실행 안에서 최대 3번 시도하고 시도마다 한 줄씩 남긴다", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([fail(429, "rate_limited"), fail(500, "http_5xx"), fail(null, "timeout")]);
    const c = clock(t);
    const sleeps: number[] = [];
    const s = await deliverNotifications({ store, notifier, clock: { now: c.now, sleep: async (ms) => { sleeps.push(ms); await c.sleep(ms); } }, keys: ["down:1"] });
    expect(s).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(notifier.sent).toHaveLength(MAX_TRIES_PER_RUN);
    expect(store.attempts.map((a) => [a.attempt, a.status, a.responseCode, a.errorClass])).toEqual([[1, "failed", 429, "rate_limited"], [2, "failed", 500, "http_5xx"], [3, "failed", null, "timeout"]]);
    expect(sleeps).toHaveLength(2); // 시도 사이에만 기다린다
  });

  it("2번째 시도에서 성공하면 거기서 멈춘다 (실패 1줄 + 성공 1줄)", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([fail(500, "http_5xx"), OK]);
    await deliverNotifications({ store, notifier, clock: clock(t), keys: ["down:1"] });
    expect(store.attempts.map((a) => a.status)).toEqual(["failed", "sent"]);
    expect(notifier.sent).toHaveLength(2);
  });

  it("회수: 15분 넘게 미발송이면 남은 시도 횟수(2번)만큼만 다시 보낸다 — 한 알림의 전체 시도는 5번", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([fail(500, "http_5xx")]);
    await deliverNotifications({ store, notifier, clock: clock(t), keys: ["down:1"] }); // 1~3번째 실패
    t.v += 20 * MIN;
    const s = await deliverNotifications({ store, notifier, clock: clock(t), olderThanMinutes: RECOVERY_AFTER_MINUTES });
    expect(s.failed).toBe(1);
    expect(store.attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4, 5]);
    t.v += 20 * MIN;
    expect(await deliverNotifications({ store, notifier, clock: clock(t), olderThanMinutes: RECOVERY_AFTER_MINUTES })).toEqual({ sent: 0, failed: 0, skipped: 0 }); // 5번을 다 썼으면 더 시도하지 않는다
    expect(notifier.sent).toHaveLength(MAX_ATTEMPTS_PER_NOTIFICATION);
  });

  it("회수는 15분이 안 된 알림을 건드리지 않는다", async () => {
    const { store, t } = await seeded();
    t.v += 14 * MIN;
    const notifier = scripted([OK]);
    expect(await deliverNotifications({ store, notifier, clock: clock(t), olderThanMinutes: RECOVERY_AFTER_MINUTES })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    t.v += 2 * MIN;
    expect((await deliverNotifications({ store, notifier, clock: clock(t), olderThanMinutes: RECOVERY_AFTER_MINUTES })).sent).toBe(1);
  });

  it("동시에 두 실행이 같은 알림을 보내려 해도 한 번만 발송한다 (임대)", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([OK]);
    const [a, b] = await Promise.all([
      deliverNotifications({ store, notifier, clock: clock(t), keys: ["down:1"] }),
      deliverNotifications({ store, notifier, clock: clock(t), keys: ["down:1"] }),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it("이미 발송된 알림은 다시 보내지 않는다", async () => {
    const { store, t } = await seeded();
    const notifier = scripted([OK]);
    await deliverNotifications({ store, notifier, clock: clock(t), keys: ["down:1"] });
    t.v += 30 * MIN;
    expect(await deliverNotifications({ store, notifier, clock: clock(t), olderThanMinutes: 15 })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(notifier.sent).toHaveLength(1);
  });

  it("log 채널로는 실제로 보내지 않고 시도(channel=log, sent)만 기록한다", async () => {
    const { store, t } = await seeded();
    const lines: string[] = [];
    await deliverNotifications({ store, notifier: createLogNotifier((l) => lines.push(l)), clock: clock(t), keys: ["down:1"] });
    expect(store.attempts[0]).toMatchObject({ channel: "log", status: "sent" });
    expect(lines).toHaveLength(1);
  });

  it("저장소 오류가 나도 다음 알림 발송을 막지 않는다", async () => {
    const { store, t } = await seeded();
    const broken = { ...store, listUnsent: store.listUnsent, lease: async (k: string) => { if (k === "down:1") throw new Error("DB"); return store.lease(k, 60); }, recordAttempt: store.recordAttempt, latestAnomalyId: store.latestAnomalyId };
    const s = await deliverNotifications({ store: broken, notifier: scripted([OK]), clock: clock(t), keys: ["down:1"] });
    expect(s).toEqual({ sent: 0, failed: 1, skipped: 0 });
  });

});

// ---------- 입구 경로에 연결된 발송 ----------
const AUTH = "Bearer s3cret-value";
function world() {
  let t = T0;
  const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
  const store = createMemoryWebStore({ now: () => t });
  const verdicts: WebVerdict[] = [];
  const probe = async (): Promise<TargetProbeOutcome> => {
    const overall = verdicts.shift() ?? "PASS_DATA";
    const probes: ProbeResult[] = [base("L1_CONNECT", true), overall === "FAIL" ? out(base("L2_HTTP", true), "FAIL", "HTTP_5XX", { httpStatus: 503 }) : base("L2_HTTP", true), base("L3_CONTENT", true)];
    return { verdict: { overall, probes, certExpiring: false, certDaysLeft: null, maintenanceDetected: false }, aux: [], requestCount: 5 };
  };
  const run = (input: WebRunInput) => runWebCheck({ ...input, probe });
  const transport: WebTransport = { lookup: async () => {}, tls: async () => ({ notAfterMs: 0, hostnameMatches: true }), get: async () => { throw new Error("실제 요청 없음"); } };
  const notifier = scripted([OK]);
  const notify = { deliver: (o: { keys?: readonly string[]; olderThanMinutes?: number }) => deliverNotifications({ store, notifier, clock, appBaseUrl: "https://onbid-ops-radar.vercel.app", ...o }) };
  const checkDeps: WebCronDeps = { secret: () => "s3cret-value", prepare: async () => ({ settings: DEFAULT_WEB_SETTINGS, store, transitionStore: store, notify }), targets: () => [findWebTarget("onbid-home")!], transport, clock, runWebCheck: run };
  const retryDeps: WebRetryCronDeps = { secret: () => "s3cret-value", prepare: async () => ({ settings: DEFAULT_WEB_SETTINGS, store, transitionStore: store, retryStore: store, notify }), findTarget: (k) => findWebTarget(k), transport, clock, runWebCheck: run };
  return { store, notifier, verdicts, checkDeps, retryDeps, advance: (ms: number) => void (t += ms), setNotifier: (n: Notifier) => void (notify.deliver = (o) => deliverNotifications({ store, notifier: n, clock, ...o })) };
}

describe("입구 경로에서의 발송", () => {
  it("정시 실패 → 재확인 실패 → 장애 감지 알림이 바로 발송된다 (이상징후 링크 포함)", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL");
    await runScheduledWebCheck(AUTH, w.checkDeps);
    expect(w.notifier.sent).toHaveLength(0); // 정시 실패만으로는 알림 없음
    w.advance(90_000);
    const res = await runWebRetries(AUTH, w.retryDeps);
    expect(res.body).toMatchObject({ processed: 1, notified: 1 });
    expect(w.notifier.sent).toHaveLength(1);
    expect(w.notifier.sent[0]).toContain("장애 감지");
    expect(w.notifier.sent[0]).toContain("/anomalies/1");
    expect(w.store.attempts).toMatchObject([{ key: "down:1", attempt: 1, status: "sent" }]);
  });

  it("재확인이 정상이면 알림이 한 건도 발송되지 않는다", async () => {
    const w = world();
    w.verdicts.push("FAIL", "PASS_DATA");
    await runScheduledWebCheck(AUTH, w.checkDeps);
    w.advance(90_000);
    await runWebRetries(AUTH, w.retryDeps);
    expect(w.notifier.sent).toHaveLength(0);
    expect(w.store.attempts).toHaveLength(0);
  });

  it("사건이 열린 뒤 정시 점검에서 복구되면 복구 알림이 바로 발송된다", async () => {
    const w = world();
    w.verdicts.push("FAIL", "FAIL", "PASS_DATA");
    await runScheduledWebCheck(AUTH, w.checkDeps);
    w.advance(90_000);
    await runWebRetries(AUTH, w.retryDeps);
    w.advance(58 * 60_000); // 다음 정시
    await runScheduledWebCheck(AUTH, w.checkDeps);
    expect(w.notifier.sent.map((t) => t.split("\n")[0])).toEqual(["🔴 [온비드 홈페이지] 장애 감지", "🟢 [온비드 홈페이지] 복구"]);
  });

  it("발송이 실패해도 점검 응답은 정상이고, 15분 뒤 회수 경로(web-retry)가 다시 보낸다", async () => {
    const w = world();
    w.setNotifier(scripted([fail(500, "http_5xx")]));
    w.verdicts.push("FAIL", "FAIL");
    await runScheduledWebCheck(AUTH, w.checkDeps);
    w.advance(90_000);
    const first = await runWebRetries(AUTH, w.retryDeps);
    expect(first.httpStatus).toBe(200);
    expect(w.store.attempts.map((a) => a.status)).toEqual(["failed", "failed", "failed"]);
    w.advance(16 * MIN);
    w.setNotifier(scripted([OK]));
    const second = await runWebRetries(AUTH, w.retryDeps);
    expect(second.body).toMatchObject({ processed: 0, notified: 1 }); // 대기 줄이 없어도 미발송 알림은 회수한다
    expect(w.store.attempts.map((a) => a.status)).toEqual(["failed", "failed", "failed", "sent"]);
  });

  it("점검이 꺼져 있으면 발송 회수도 하지 않는다", async () => {
    const w = world();
    const res = await runWebRetries(AUTH, { ...w.retryDeps, prepare: async () => ({ ...(await w.retryDeps.prepare()), settings: { ...DEFAULT_WEB_SETTINGS, monitorEnabled: false } }) });
    expect(res.body).toMatchObject({ skipped: "disabled" });
    expect(w.notifier.sent).toHaveLength(0);
  });
});

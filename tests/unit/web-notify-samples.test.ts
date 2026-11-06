// 유형별 시험 알림 문구 시험 (네트워크·DB 없음) — 모든 알림 종류가 시험 문구를 가지고, 텔레그램에 그대로 보내도 안전한지 본다
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNotifySamples } from "@/lib/web-monitor/notify/samples";
import { NOTIFY_KIND_LABEL } from "@/lib/web-monitor/view";

const NOW = new Date("2026-11-06T03:07:00Z"); // KST 12:07
const samples = buildNotifySamples(NOW);

describe("buildNotifySamples", () => {
  it("알림 종류 11가지가 모두 시험 문구를 가진다 (종류가 늘면 여기서 알려 준다)", () => {
    const kinds = new Set(samples.map((s) => s.kind));
    for (const kind of Object.keys(NOTIFY_KIND_LABEL)) expect(kinds.has(kind), kind).toBe(true);
  });

  it("장애 감지는 사유별로 여러 유형을 보낸다", () => {
    const down = samples.filter((s) => s.kind === "down").map((s) => s.title);
    expect(down.length).toBeGreaterThanOrEqual(6);
    expect(new Set(down).size).toBe(down.length);
  });

  it("모든 문구는 시험 표시로 시작하고 순번이 맞다", () => {
    samples.forEach((s, i) => {
      expect(s.text.startsWith(`🧪 <b>[시험 ${i + 1}/${samples.length}]`), s.id).toBe(true);
      expect(s.text).toContain("실제 장애가 아닙니다");
    });
  });

  it("id가 겹치지 않고, 텔레그램 한도(4000자) 안이며, 허용한 태그(<b>)만 쓴다", () => {
    expect(new Set(samples.map((s) => s.id)).size).toBe(samples.length);
    for (const s of samples) {
      expect(s.text.length, s.id).toBeLessThan(4000);
      const stray = s.text.replace(/<\/?b>/g, "").match(/[<>]/g);
      expect(stray, `${s.id}: 태그가 아닌 < > 가 있다`).toBeNull();
    }
  });

  it("이상징후·앱 주소 링크와 비밀값 모양이 들어 있지 않다", () => {
    for (const s of samples) {
      expect(s.text, s.id).not.toMatch(/https?:\/\//);
      expect(s.text, s.id).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/); // 봇 토큰 모양
    }
  });

  it("시각은 KST로 보인다 (UTC 03:07 → 12:07)", () => {
    const down = samples.find((s) => s.id === "down-5xx")!;
    expect(down.text).toContain("2026-11-06 12:07 KST");
  });

  it("정지·재개 문구가 DB 함수(마이그레이션 SQL)의 문구와 같은 말을 쓴다", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261105160000_create_web_monitor_heartbeat.sql"), "utf8");
    const stale = samples.find((s) => s.id === "stale")!.text;
    const resumed = samples.find((s) => s.id === "resumed")!.text;
    for (const phrase of ["⚫ <b>홈페이지 점검 정지</b>", "마지막 정상 점검: ", "Supabase 스케줄러와 배포 상태를 확인해 주세요."]) {
      expect(sql, phrase).toContain(phrase);
      expect(stale, phrase).toContain(phrase);
    }
    for (const phrase of ["🟢 <b>홈페이지 점검 재개</b>", "에 점검이 다시 정상 종료되었습니다."]) {
      expect(sql, phrase).toContain(phrase);
      expect(resumed, phrase).toContain(phrase);
    }
  });
});

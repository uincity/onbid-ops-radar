// PUBLIC 조회기를 "진짜 온비드 OpenAPI"에 연결해 확인하는 시험 (PLAN 작업 33)
// 보통의 `npm run test:unit`에서는 건너뛴다. `npm run test:public-live`로만 실행한다 (.env의 DATA_GO_KR_SERVICE_KEY 필요).
// 호출은 딱 2번이다: 부동산 물건목록 1번 + 물건상세 1번. (읽기 전용 GET. DB에는 아무것도 쓰지 않는다)
// 서비스키는 어디에도 출력하지 않는다. 응답은 공개된 공매 정보라서 필드 이름과 값의 모양만 요약해서 보여 준다.
import { describe, expect, it } from "vitest";
import { createPublicFetcher, PUBLIC_STORED_FIELDS } from "@/lib/checks/public-fetcher";
import { detectItem } from "@/lib/rules/detect-item";
import { PUBLIC_PROFILE } from "@/lib/rules/field-profile";
import { DEFAULT_SETTING_VALUES } from "@/lib/settings/schema";

const live = process.env.LIVE_PUBLIC === "1" && !!process.env.DATA_GO_KR_SERVICE_KEY;

describe.skipIf(!live)("PUBLIC 조회기 + 실제 온비드 OpenAPI (호출 2번)", () => {
  it("목록 1번 + 상세 1번: 응답 모양이 부록 A와 맞고, 규칙을 적용할 수 있다", async () => {
    const timeoutSeconds = DEFAULT_SETTING_VALUES.api_timeout_seconds;
    const fetcher = createPublicFetcher({ serviceKey: process.env.DATA_GO_KR_SERVICE_KEY!, timeoutSeconds });

    // 남은 호출 2회: 목록은 1건만 가져오고(2 − 1), 상세는 1번만 부른다
    const list = await fetcher("public-list", { remainingCalls: 2, remainingMs: 60_000 });
    console.log(`[목록] 결과=${list.outcome} HTTP=${list.httpStatus} ${list.durationMs}ms 건수=${list.recordCount}`);
    expect(list.outcome, "목록 호출 결과").toBe("success");
    expect(list.records.length).toBeGreaterThan(0);

    const listed = list.records[0];
    console.log(`[목록 필드] ${Object.keys(listed.fields).join(", ")}`);
    console.log(`[목록 값 모양] 물건관리번호=${String(listed.fields.cltrMngNo).replace(/\d/g, "9")} 시작=${listed.fields.cltrBidBgngDt} 종료=${listed.fields.cltrBidEndDt}`);
    for (const key of Object.keys(listed.fields)) expect(PUBLIC_STORED_FIELDS as readonly string[]).toContain(key);

    const detail = await fetcher("public-detail", { remainingCalls: 1, remainingMs: 60_000 });
    console.log(`[상세] 결과=${detail.outcome} 호출=${detail.httpCalls}번 건수=${detail.recordCount} ${detail.durationMs}ms`);
    expect(detail.httpCalls).toBe(1);
    expect(["success", "empty_result"]).toContain(detail.outcome);

    // 응답이 규칙에 들어맞는지 (실제 값으로 규칙을 한 번 돌려 본다)
    const detailRecord = detail.records[0] ?? null;
    const windowSeconds = DEFAULT_SETTING_VALUES.compare_window_minutes * 60;
    const result = detectItem(
      { list: { fields: listed.fields, collectedAtMs: listed.collectedAtMs }, detail: detailRecord ? { fields: detailRecord.fields, collectedAtMs: detailRecord.collectedAtMs } : null },
      windowSeconds,
      PUBLIC_PROFILE,
    );
    console.log(`[규칙 결과] 탐지=${JSON.stringify(result.rules)} 목록·상세 비교=${result.listDetail.outcome === "compared" ? "비교함" : `제외(${result.listDetail.reason})`}`);

    // 날짜는 부록 A대로 yyyyMMddHHmm 12자리여야 한다
    expect(PUBLIC_PROFILE.parseDate(listed.fields.cltrBidBgngDt), "입찰시작일시 형식").not.toBeNull();
    expect(PUBLIC_PROFILE.parseDate(listed.fields.cltrBidEndDt), "입찰종료일시 형식").not.toBeNull();

    // 기록에 서비스키가 섞여 있지 않다
    expect(JSON.stringify([list, detail])).not.toContain(process.env.DATA_GO_KR_SERVICE_KEY!.slice(0, 20));
  }, 60_000);
});

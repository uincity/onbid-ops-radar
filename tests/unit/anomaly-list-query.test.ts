// 이상징후 목록 쿼리 읽기·조건 만들기 시험 (PLAN 25번)
import { describe, expect, it } from "vitest";
import {
  MAX_PAGE,
  PAGE_SIZE,
  activeQuickFilter,
  buildFilterPlan,
  buildListHref,
  pageRange,
  parseListQuery,
  quickFilterHref,
  totalPages,
} from "@/lib/anomalies/list-query";

describe("parseListQuery", () => {
  it("아무것도 없으면 조건 없이 1쪽", () => {
    expect(parseListQuery({})).toEqual({ page: 1 });
  });

  it("올바른 값은 그대로 읽는다", () => {
    expect(parseListQuery({ status: "active", rule: "DATE_ORDER", source: "DEMO", assignee: "me", page: "3" })).toEqual({
      status: "active",
      rule: "DATE_ORDER",
      source: "DEMO",
      assignee: "me",
      page: 3,
    });
  });

  it("알 수 없는 값은 무시한다 (나머지 조건은 살린다)", () => {
    expect(parseListQuery({ status: "hacked", rule: "x'; drop table anomalies;--", source: "demo", assignee: "everyone", page: "2" })).toEqual({ page: 2 });
    expect(parseListQuery({ status: "open", rule: "nope" })).toEqual({ status: "open", page: 1 });
  });

  it("같은 이름이 여러 번 오면 첫 값만 쓴다", () => {
    expect(parseListQuery({ status: ["resolved", "open"] }).status).toBe("resolved");
    expect(parseListQuery({ status: [] }).status).toBeUndefined();
  });

  it("page: 0·음수·소수·글자는 1쪽", () => {
    for (const p of ["0", "-1", "-5", "1.5", "abc", "", " 2", "2 ", "1e3", "+3"]) {
      expect(parseListQuery({ page: p }).page).toBe(1);
    }
  });

  it("page: 매우 큰 값은 상한으로 줄인다", () => {
    expect(parseListQuery({ page: String(MAX_PAGE) }).page).toBe(MAX_PAGE);
    expect(parseListQuery({ page: String(MAX_PAGE + 1) }).page).toBe(MAX_PAGE);
    expect(parseListQuery({ page: "999999999" }).page).toBe(MAX_PAGE);
    expect(parseListQuery({ page: "99999999999999999999" }).page).toBe(1); // 너무 길면 무효
  });
});

describe("buildFilterPlan", () => {
  const me = "11111111-1111-1111-1111-111111111111";

  it("조건이 없으면 비어 있다", () => {
    expect(buildFilterPlan({ page: 1 }, me)).toEqual({ eq: [], in: [], isNull: [] });
  });

  it("active = 미확인 + 검토 중, closed = 조치 완료 + 정상 판정", () => {
    expect(buildFilterPlan({ page: 1, status: "active" }, me).in).toEqual([["status", ["open", "investigating"]]]);
    expect(buildFilterPlan({ page: 1, status: "closed" }, me).in).toEqual([["status", ["resolved", "dismissed"]]]);
  });

  it("단일 상태·규칙·출처는 같다(eq) 조건", () => {
    expect(buildFilterPlan({ page: 1, status: "open", rule: "EMPTY_RESULT", source: "PUBLIC" }, me).eq).toEqual([
      ["status", "open"],
      ["rule_id", "EMPTY_RESULT"],
      ["source", "PUBLIC"],
    ]);
  });

  it("assignee: me는 내 id, unassigned는 비어 있음", () => {
    expect(buildFilterPlan({ page: 1, assignee: "me" }, me).eq).toEqual([["assignee_id", me]]);
    expect(buildFilterPlan({ page: 1, assignee: "unassigned" }, me).isNull).toEqual(["assignee_id"]);
  });
});

describe("쪽 계산", () => {
  it("pageRange 경계", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
    expect(pageRange(2)).toEqual({ from: PAGE_SIZE, to: 2 * PAGE_SIZE - 1 });
    expect(pageRange(0)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
    expect(pageRange(-3)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
  });

  it("totalPages: 0건도 1쪽, 정확히 20건은 1쪽, 21건은 2쪽", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(PAGE_SIZE)).toBe(1);
    expect(totalPages(PAGE_SIZE + 1)).toBe(2);
  });
});

describe("주소 만들기와 빠른 필터", () => {
  it("조건이 없으면 /anomalies", () => {
    expect(buildListHref({ page: 1 })).toBe("/anomalies");
  });

  it("조건을 바꾸면 1쪽으로 돌아가고, null은 조건을 지운다", () => {
    expect(buildListHref({ page: 4, status: "open", rule: "DATE_ORDER" }, { rule: null })).toBe("/anomalies?status=open");
    expect(buildListHref({ page: 1 }, { page: 3, status: "active" })).toBe("/anomalies?status=active&page=3");
  });

  it("빠른 필터는 규칙·출처를 유지하고 상태·담당자만 바꾼다", () => {
    const q = parseListQuery({ status: "open", rule: "DATE_ORDER", source: "DEMO", page: "5" });
    expect(quickFilterHref(q, "mine")).toBe("/anomalies?rule=DATE_ORDER&source=DEMO&assignee=me");
    expect(quickFilterHref(q, "all")).toBe("/anomalies?rule=DATE_ORDER&source=DEMO");
    expect(quickFilterHref({ page: 1 }, "unassigned")).toBe("/anomalies?status=active&assignee=unassigned");
  });

  it("activeQuickFilter: 지금 조건에 맞는 버튼을 찾는다", () => {
    expect(activeQuickFilter({ page: 1 })).toBe("all");
    expect(activeQuickFilter({ page: 1, status: "open" })).toBe("open");
    expect(activeQuickFilter({ page: 2, assignee: "me" })).toBe("mine");
    expect(activeQuickFilter({ page: 1, status: "active", assignee: "unassigned" })).toBe("unassigned");
    expect(activeQuickFilter({ page: 1, status: "resolved" })).toBeNull();
  });
});

// DEMO 시나리오 160건을 만드는 생성기 (PLAN 작업 17)
// Design Ref: DESIGN §10(테스트용 데이터: 정상 100·이상 30(규칙별 10)·경계 30), PRD 3-1·5-2·부록 B(DEMO 가상 스키마)
//
// 무작위 없이 번호(i)로만 값을 정하므로 언제 돌려도 똑같은 결과가 나온다. (tests/unit/demo-scenarios.test.ts가 JSON 파일과 같은지 확인)
// 모든 값은 가상이다. 사람 이름·연락처 같은 개인정보는 없다. (PRD 7-2)
//
// 한 건(시나리오) = 물건 하나의 "목록 조회 결과(list)"와 "상세 조회 결과(detail)", 그리고 "기대하는 결과(expected)"
//   expected.rules      : 이 물건에서 탐지되어야 하는 규칙 ID 목록 (정상이면 빈 목록)
//   expected.listDetail : 목록·상세 비교를 했는가 — "compared"(비교함) / "skipped:WINDOW_EXCEEDED"(수집 시각 차이가 10분 초과라 제외)
//                         / "skipped:NO_COUNTERPART"(목록 또는 상세가 없어 비교할 수 없음)

export const COMPARE_WINDOW_SECONDS = 600; // 목록·상세 수집 시각 차이 허용 10분 (PRD 5-2 규칙 3, 설정값 compare_window_minutes)

// ----- 시각 만들기 도우미 -----
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const BASE_START_MS = Date.UTC(2026, 10, 1, 1, 0, 0); // 2026-11-01 10:00 KST

// 순간(ms)을 "YYYY-MM-DDTHH:mm:ss+09:00" 또는 "...Z" 모양의 글자로 만든다
function iso(ms, zone = "+09:00") {
  if (zone === "Z") return `${new Date(ms).toISOString().slice(0, 19)}Z`;
  const sign = zone[0] === "-" ? -1 : 1;
  const offsetMs = sign * (Number(zone.slice(1, 3)) * HOUR + Number(zone.slice(4, 6)) * 60_000);
  return `${new Date(ms + offsetMs).toISOString().slice(0, 19)}${zone}`;
}

// 필드를 정해진 순서로 만든다. undefined인 값은 "필드 자체가 없음"으로 뺀다. (null은 "값이 비어 있음")
function fields({ id, name, org, start, end, status }) {
  const out = { demo_item_id: id };
  if (name !== undefined) out.item_name = name;
  if (org !== undefined) out.org_name = org;
  if (start !== undefined) out.bid_start_at = start;
  if (end !== undefined) out.bid_end_at = end;
  if (status !== undefined) out.item_status = status;
  return out;
}

const idOf = (n) => `DEMO-${String(n).padStart(4, "0")}`;

function scenario({ n, group, category, title, rules = [], listDetail = "compared", detailOffsetSeconds = 120, list, detail }) {
  return {
    id: idOf(n),
    group,
    category,
    title,
    expected: { rules, listDetail },
    // 상세를 수집한 시각 − 목록을 수집한 시각 (초). 음수면 상세를 먼저 수집한 것. 둘 중 하나가 없으면 의미가 없어 0이다
    detailOffsetSeconds: list === null || detail === null ? 0 : detailOffsetSeconds,
    list: list === null ? null : fields({ id: idOf(n), ...list }),
    detail: detail === null ? null : fields({ id: idOf(n), ...detail }),
  };
}

// 목록·상세가 같은 내용인 기본 물건
const NAME_KINDS = ["가상 토지", "가상 아파트", "가상 상가", "가상 임야", "가상 차량", "가상 선박", "가상 기계", "가상 공장", "가상 창고", "가상 오피스텔"];
const ORGS = ["가상자산관리본부", "가상공매운영처", "가상부동산팀", "가상동산팀", "가상지역본부 A", "가상지역본부 B", "가상정보시스템처", "가상재산관리센터"];
const okName = (n) => `${NAME_KINDS[n % 10]} ${String(n).padStart(3, "0")}호`;
const okOrg = (n) => ORGS[n % 8];
const BASE = { name: "가상 토지 경계-기준", org: "가상자산관리본부", start: "2026-11-20T10:00:00+09:00", end: "2026-11-25T10:00:00+09:00" };

export function buildScenarioFile() {
  const scenarios = [];

  // ===================== 정상 100건 (오탐이 없어야 한다) =====================
  const LENGTH_HOURS = [24, 48, 72, 36, 120, 6, 168, 12, 96, 60];
  for (let n = 1; n <= 100; n += 1) {
    const zone = n % 13 === 0 ? "Z" : "+09:00"; // 일부는 UTC(Z) 표기. 목록·상세에서 같은 표기를 쓴다
    const startMs = BASE_START_MS + (n - 1) * 6 * HOUR;
    const common = { name: okName(n), org: okOrg(n), start: iso(startMs, zone), end: iso(startMs + LENGTH_HOURS[n % 10] * HOUR, zone) };
    // 진행상태는 정상적으로 바뀔 수 있다: 같음 / 없음 / 목록과 상세가 다름
    const statusPairs = [
      ["ready", "bidding"],
      ["bidding", "bidding"],
      [undefined, undefined],
      ["bidding", "closed"],
    ];
    const [listStatus, detailStatus] = statusPairs[n % 4];
    scenarios.push(
      scenario({
        n,
        group: "normal",
        category: "NORMAL",
        title:
          listStatus === detailStatus
            ? "정상: 목록·상세가 일치하고 날짜·필수값이 모두 올바름"
            : `정상: 목록·상세가 일치함 (진행상태는 ${listStatus ?? "없음"} → ${detailStatus ?? "없음"}로 바뀌어도 정상)`,
        detailOffsetSeconds: (n % 10) * 54, // 0~486초: 10분 이내
        list: { ...common, status: listStatus },
        detail: { ...common, status: detailStatus },
      }),
    );
  }

  // ===================== 이상 30건 (규칙마다 10건, 한 건에는 규칙 하나만) =====================
  // 날짜 정합성 10건: 종료일시가 시작일시보다 빠름. 목록·상세는 같은 값이다(목록·상세 불일치가 함께 생기지 않도록).
  const EARLIER_SECONDS = [86400, 3600, 60, 2592000, 604800, 172800, 7200, 43200, 300, 31536000];
  const EARLIER_LABEL = ["1일", "1시간", "1분", "30일", "7일", "2일", "2시간", "12시간", "5분", "365일"];
  for (let k = 0; k < 10; k += 1) {
    const n = 101 + k;
    const zone = k % 3 === 2 ? "Z" : "+09:00";
    const startMs = BASE_START_MS + (n - 1) * 6 * HOUR;
    const common = { name: okName(n), org: okOrg(n), start: iso(startMs, zone), end: iso(startMs - EARLIER_SECONDS[k] * 1000, zone), status: "bidding" };
    scenarios.push(
      scenario({
        n,
        group: "anomaly",
        category: "DATE_ORDER",
        title: `이상(날짜 정합성): 입찰종료일시가 입찰시작일시보다 ${EARLIER_LABEL[k]} 빠름`,
        rules: ["DATE_ORDER"],
        detailOffsetSeconds: 60 + k * 30,
        list: common,
        detail: common,
      }),
    );
  }

  // 필수정보 10건: 필수값이 없거나 형식이 틀림. 목록·상세에 같은 결함을 넣는다. (결함 때문에 목록·상세 불일치가 함께 생기지 않도록)
  const requiredCases = [
    ["item_name 필드가 없음", { name: undefined }],
    ["item_name이 null", { name: null }],
    ["item_name이 빈 글자(\"\")", { name: "" }],
    ["org_name이 공백뿐", { org: "   " }],
    ["org_name 필드가 없음", { org: undefined }],
    ["bid_start_at 필드가 없음", { start: undefined }],
    ["bid_end_at이 null", { end: null }],
    ["bid_start_at 형식이 틀림(2026/11/05 10:00)", { start: "2026/11/05 10:00" }],
    ["bid_end_at이 실제로 없는 날짜(2026-02-30)", { end: "2026-02-30T10:00:00+09:00" }],
    ["bid_start_at에 시간대(+09:00)가 없음", { start: "2026-11-05T10:00:00" }],
  ];
  requiredCases.forEach(([label, defect], k) => {
    const n = 111 + k;
    const startMs = BASE_START_MS + (n - 1) * 6 * HOUR;
    const common = { name: okName(n), org: okOrg(n), start: iso(startMs), end: iso(startMs + 3 * DAY), status: "bidding", ...defect };
    scenarios.push(
      scenario({
        n,
        group: "anomaly",
        category: "REQUIRED_FIELD",
        title: `이상(필수정보): ${label}`,
        rules: ["REQUIRED_FIELD"],
        detailOffsetSeconds: 60 + k * 30,
        list: common,
        detail: common,
      }),
    );
  });

  // 목록·상세 정합성 10건: 수집 시각 차이는 10분 이내이고, 비교 대상 필드 하나(또는 둘)만 다름. 날짜는 둘 다 올바른 순서다.
  const mismatchCases = [
    ["item_name이 다름(정정 표시가 붙음)", (c) => ({ ...c, name: `${c.name} (정정)` })],
    ["item_name이 완전히 다름", () => ({ name: "전혀 다른 가상 물건 이름" })],
    ["item_name이 한 글자만 다름", (c) => ({ name: `${c.name.slice(0, -1)}X` })],
    ["org_name이 다름", () => ({ org: "가상다른기관" })],
    ["org_name이 다른 기관으로 바뀜", (c) => ({ org: c.org === ORGS[0] ? ORGS[1] : ORGS[0] })],
    ["bid_start_at이 하루 다름", (c, ms) => ({ start: iso(ms - DAY) })],
    ["bid_start_at이 1시간 다름", (c, ms) => ({ start: iso(ms - HOUR) })],
    ["bid_end_at이 하루 다름", (c, ms) => ({ end: iso(ms + 3 * DAY + DAY) })],
    ["bid_end_at이 12시간 다름", (c, ms) => ({ end: iso(ms + 3 * DAY + 12 * HOUR) })],
    ["item_name과 org_name이 모두 다름", () => ({ name: "다른 가상 물건", org: "가상다른기관" })],
  ];
  mismatchCases.forEach(([label, change], k) => {
    const n = 121 + k;
    const startMs = BASE_START_MS + (n - 1) * 6 * HOUR;
    const common = { name: okName(n), org: okOrg(n), start: iso(startMs), end: iso(startMs + 3 * DAY), status: "bidding" };
    scenarios.push(
      scenario({
        n,
        group: "anomaly",
        category: "LIST_DETAIL_MISMATCH",
        title: `이상(목록·상세 정합성): ${label}`,
        rules: ["LIST_DETAIL_MISMATCH"],
        detailOffsetSeconds: 60 + k * 50, // 60~510초: 10분 이내
        list: common,
        detail: { ...common, ...change(common, startMs) },
      }),
    );
  });

  // ===================== 경계 30건 (기대 결과가 정확히 맞아야 한다) =====================
  const same = (extra = {}) => ({ ...BASE, status: "bidding", ...extra });
  const bothSame = (extra) => ({ list: same(extra), detail: same(extra) });
  let n = 131;
  const b = (spec) => scenarios.push(scenario({ n: n++, group: "boundary", ...spec }));

  // 날짜 경계 8건 (목록·상세는 같은 값)
  b({ category: "DATE_ORDER", title: "경계(날짜): 종료일시가 시작일시와 정확히 같음 → 정상 (더 빠를 때만 이상)", ...bothSame({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T10:00:00+09:00" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 종료일시가 시작일시보다 1초 빠름 → 이상", rules: ["DATE_ORDER"], ...bothSame({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T09:59:59+09:00" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 종료일시가 시작일시보다 1초 늦음 → 정상", ...bothSame({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T10:00:01+09:00" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 표기(+09:00/Z)가 달라도 같은 순간이면 같다 → 정상", ...bothSame({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T01:00:00Z" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 글자로는 종료(09:30)가 빨라 보여도 실제로는 더 늦은 순간 → 정상", ...bothSame({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T09:30:00Z" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 글자로는 종료(17:00)가 늦어 보여도 실제로는 1시간 빠른 순간 → 이상", rules: ["DATE_ORDER"], ...bothSame({ start: "2026-11-20T09:00:00Z", end: "2026-11-20T17:00:00+09:00" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 해가 바뀌는 순간(23:59:59 → 다음 해 00:00:00) → 정상", ...bothSame({ start: "2026-12-31T23:59:59+09:00", end: "2027-01-01T00:00:00+09:00" }) });
  b({ category: "DATE_ORDER", title: "경계(날짜): 윤년 2월 29일에 종료가 1초 빠름 → 이상", rules: ["DATE_ORDER"], ...bothSame({ start: "2028-02-29T10:00:00+09:00", end: "2028-02-29T09:59:59+09:00" }) });

  // 필수정보 경계 8건 (목록·상세는 같은 값)
  b({ category: "REQUIRED_FIELD", title: "경계(필수): 선택 필드(item_status)가 없음 → 정상", ...bothSame({ status: undefined }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): item_status가 허용된 값(closed) → 정상", ...bothSame({ status: "closed" }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): item_status가 대문자(CLOSED)라 허용 값(ready/bidding/closed)이 아님 → 이상", rules: ["REQUIRED_FIELD"], ...bothSame({ status: "CLOSED" }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): item_name이 공백 3칸뿐 → 이상", rules: ["REQUIRED_FIELD"], ...bothSame({ name: "   " }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): item_name이 한 글자 → 정상 (길이 제한 없음)", ...bothSame({ name: "가" }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): item_name이 200자 → 정상", ...bothSame({ name: "가".repeat(200) }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): 날짜에 소수점 초(.500)가 있어도 올바른 형식 → 정상", ...bothSame({ start: "2026-11-20T10:00:00.500+09:00", end: "2026-11-25T10:00:00.250+09:00" }) });
  b({ category: "REQUIRED_FIELD", title: "경계(필수): bid_end_at이 24시(T24:00:00)라 올바른 시각이 아님 → 이상", rules: ["REQUIRED_FIELD"], ...bothSame({ end: "2026-11-25T24:00:00+09:00" }) });

  // 목록·상세 정합성 경계 14건
  const nameDiff = { name: `${BASE.name} (상세에서 정정)` };
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 수집 시각 차이가 정확히 10분(600초)이고 이름이 다름 → 비교함 → 이상", rules: ["LIST_DETAIL_MISMATCH"], detailOffsetSeconds: 600, list: same(), detail: same(nameDiff) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 수집 시각 차이 9분 59초(599초)이고 이름이 다름 → 비교함 → 이상", rules: ["LIST_DETAIL_MISMATCH"], detailOffsetSeconds: 599, list: same(), detail: same(nameDiff) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 수집 시각 차이 10분 1초(601초)이고 이름이 다름 → 비교 제외(시간차 초과) → 정상", listDetail: "skipped:WINDOW_EXCEEDED", detailOffsetSeconds: 601, list: same(), detail: same(nameDiff) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 수집 시각 차이 601초이고 내용이 같음 → 비교 제외 → 정상", listDetail: "skipped:WINDOW_EXCEEDED", detailOffsetSeconds: 601, list: same(), detail: same() });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 수집 시각 차이 0초이고 내용이 같음 → 비교함 → 정상", detailOffsetSeconds: 0, list: same(), detail: same() });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 상세를 10분(600초) 먼저 수집했고 이름이 다름 → 시간차는 절댓값 → 비교함 → 이상", rules: ["LIST_DETAIL_MISMATCH"], detailOffsetSeconds: -600, list: same(), detail: same(nameDiff) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 상세를 601초 먼저 수집했고 이름이 다름 → 비교 제외 → 정상", listDetail: "skipped:WINDOW_EXCEEDED", detailOffsetSeconds: -601, list: same(), detail: same(nameDiff) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 진행상태만 다름(bidding → closed) → 비교 제외 필드라 정상", list: same({ status: "bidding" }), detail: same({ status: "closed" }) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 목록에는 진행상태가 없고 상세에만 있음 → 정상", list: same({ status: undefined }), detail: same({ status: "ready" }) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 시작·종료 표기(+09:00 ↔ Z)만 다르고 같은 순간 → 정상", list: same({ start: "2026-11-20T10:00:00+09:00", end: "2026-11-25T10:00:00+09:00" }), detail: same({ start: "2026-11-20T01:00:00Z", end: "2026-11-25T01:00:00Z" }) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): bid_start_at이 1초 다름(순서는 올바름) → 이상", rules: ["LIST_DETAIL_MISMATCH"], list: same(), detail: same({ start: "2026-11-20T10:00:01+09:00" }) });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 상세 조회 결과가 없음 → 비교할 수 없음(제외) → 정상", listDetail: "skipped:NO_COUNTERPART", list: same(), detail: null });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): 목록 조회 결과가 없음 → 비교할 수 없음(제외) → 정상", listDetail: "skipped:NO_COUNTERPART", detailOffsetSeconds: 0, list: null, detail: same() });
  b({ category: "LIST_DETAIL_MISMATCH", title: "경계(목록·상세): bid_end_at이 1초 다름(순서는 올바름) → 이상", rules: ["LIST_DETAIL_MISMATCH"], list: same(), detail: same({ end: "2026-11-25T10:00:01+09:00" }) });

  return {
    version: 1,
    description:
      "DEMO 시나리오 160건: 정상 100(DEMO-0001~0100), 이상 30(0101~0130, 규칙별 10), 경계 30(0131~0160). 값은 모두 가상이다. 생성: npm run generate:demo",
    source: "DEMO",
    compareWindowSeconds: COMPARE_WINDOW_SECONDS,
    scenarios,
  };
}

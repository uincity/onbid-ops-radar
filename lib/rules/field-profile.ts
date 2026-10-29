// Design Ref: PRD 부록 A(PUBLIC 필드) · 부록 B(DEMO 가상 스키마), DESIGN §11.2 — 출처별 "필드 프로필"
// 탐지 규칙 3개는 어떤 필드를 읽을지(물건 식별값·물건명·기관명·입찰 시작/종료·필수 필드·비교 필드)와
// 날짜를 어떻게 읽을지를 이 프로필로 전달받는다. 규칙 코드에는 필드 이름이 직접 박혀 있지 않다.
// 필드 목록은 설정값(PRD 5-5 required_fields · compare_fields · excluded_fields)의 기본값과 같아야 하고,
// tests/unit/field-profile.test.ts가 그것을 지켜본다.
import { parseIsoInstant, parseOnbidDateTime } from "./iso-datetime";

export type ProfileSource = "DEMO" | "PUBLIC";

export type FieldProfile = {
  source: ProfileSource;
  idField: string; // 물건 식별값
  idPattern: RegExp | null; // null이면 형식은 검사하지 않고 값이 있는지만 본다 (명세에 형식이 확정되지 않은 경우)
  requiredFields: readonly string[];
  startField: string; // 입찰 시작일시
  endField: string; // 입찰 종료일시
  compareFields: readonly string[]; // 목록·상세가 같아야 하는 필드
  excludedFields: readonly string[]; // 정상적으로 바뀔 수 있어 비교하지 않는 필드
  // 있어도 되고 없어도 되지만, 있으면 허용된 값이어야 하는 선택 필드 (DEMO의 item_status)
  optionalEnum: { field: string; allowed: readonly string[] } | null;
  // 날짜·시각 값을 "순간(ms)"으로 읽는다. 올바른 형식이 아니면 null
  parseDate: (value: unknown) => number | null;
};

// PRD 부록 B — DEMO 가상 스키마 (ISO 8601 + 시간대)
export const DEMO_PROFILE: FieldProfile = {
  source: "DEMO",
  idField: "demo_item_id",
  idPattern: /^DEMO-\d{4}$/,
  requiredFields: ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"],
  startField: "bid_start_at",
  endField: "bid_end_at",
  compareFields: ["item_name", "org_name", "bid_start_at", "bid_end_at"],
  excludedFields: ["item_status"],
  optionalEnum: { field: "item_status", allowed: ["ready", "bidding", "closed"] },
  parseDate: parseIsoInstant,
};

// PRD 부록 A — 온비드 부동산 물건목록(getRlstCltrList2) · 물건상세(getRlstDtlInf2)
// 날짜는 yyyyMMddHHmm 12자리(KST). 물건관리번호의 형식은 명세에 확정되어 있지 않아 값이 있는지만 본다.
export const PUBLIC_PROFILE: FieldProfile = {
  source: "PUBLIC",
  idField: "cltrMngNo",
  idPattern: null,
  requiredFields: ["cltrMngNo", "pbctCdtnNo", "onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"],
  startField: "cltrBidBgngDt",
  endField: "cltrBidEndDt",
  compareFields: ["onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt"],
  excludedFields: ["pbctStatCd"],
  optionalEnum: null,
  parseDate: parseOnbidDateTime,
};

export const profileOf = (source: ProfileSource): FieldProfile => (source === "PUBLIC" ? PUBLIC_PROFILE : DEMO_PROFILE);

// Design Ref: PRD 5-2-1(API 등록부), 부록 A-2·E-3(R01) — 온비드 OpenAPI 서비스 등록부의 모양과 검증 규칙
// 등록부(data/registry/api-registry.json)는 scripts/build-api-registry.py가 명세서에서 만든다. 손으로 고치지 않는다.
// 이 스키마는 "읽을 때마다" 등록부가 약속한 모양과 불변 규칙을 지키는지 확인해, 잘못된 등록부로 점검을 돌리는 일을 막는다.
// 명세서로 알 수 없는 항목(승인 상태·유효 샘플·무데이터 정책·호출 예산)은 "미정" 값으로 두고, 확인되면 그때 값을 채운다.
import { z } from "zod";

// 실제 호출로 응답 형식을 확인했는지. 나머지는 명세서만 확인한 상태이며 점검 결과가 나오기 전까지 UNVERIFIED로 취급한다.
export const VERIFICATION_STATES = ["LIVE_VERIFIED", "SPEC_ONLY"] as const;

// 점검 입력 값 안에 쓸 수 있는 {…} 자리표시자. 점검할 때 lib/checks/generic-probe.ts가 KST 기준으로 풀어 쓴다
export const PROBE_INPUT_TOKENS = ["PREV_YEAR"] as const;

export const APPROVAL_STATES = ["UNCONFIRMED", "CONFIRMED_BY_USER_2026_10_29", "APPROVED", "NOT_APPROVED"] as const;

const requestParam = z.object({
  name: z.string().min(1),
  kr: z.string(),
  type: z.string(),
  sample: z.string(), // 명세서에 적힌 예시 값. 유효한 입력값이라는 뜻은 아니다
});

const responseField = z.object({
  name: z.string().min(1),
  kr: z.string(),
  type: z.string(),
  required: z.boolean(),
  multiplicity: z.string(), // 명세서의 항목구분 원문: 1 · 0 · 1..n · 0..n
});

export const operationSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z][A-Za-z0-9]+$/),
  nameKr: z.string().min(1),
  method: z.literal("GET"), // 읽기 전용 (CLAUDE.md 보안 규칙)
  path: z.string().regex(/^[A-Za-z][A-Za-z0-9]+$/),
  url: z.string().startsWith("https://"),
  tpsLimit: z.number().int().positive().nullable(),
  avgResponseMs: z.number().int().positive().nullable(),
  requiredParams: z.array(requestParam), // 공통 항목(serviceKey·pageNo·numOfRows·resultType)을 뺀 업무 필수 파라미터
  optionalParamCount: z.number().int().nonnegative(),
  responseFields: z.array(responseField), // 최상위 응답 항목
  responseFieldCount: z.number().int().positive(), // 중첩 항목까지 센 수
  inputSourceCandidates: z.array(z.string()), // 식별 파라미터를 얻을 수 있는 목록형 오퍼레이션 후보 ("SVC-API-001/getRlstCltrList")
  dependencyNote: z.string().nullable(),
  verification: z.object({
    state: z.enum(VERIFICATION_STATES),
    evidence: z.string().min(1),
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  approval: z.enum(APPROVAL_STATES),
  // 점검 방식과 입력값: 확정 전에는 비어 있다. 임의로 만들지 않는다 (PRD 5-2-1)
  probe: z.object({
    mode: z.enum(["positive", "structural", "negative"]).nullable(),
    // 요청에 넣을 업무 파라미터. null이면 아직 정하지 않은 것, {}이면 업무 파라미터 없이 부른다. 서비스키·pageNo 등 공통 항목은 넣지 않는다
    input: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/), z.string().regex(/^[A-Za-z0-9가-힣,{}_-]{1,60}$/)).nullable(),
    inputSource: z.string().nullable(),
  }),
  noDataPolicy: z.enum(["UNDEFINED", "ALLOWED", "NOT_ALLOWED"]),
  quota: z.object({ dailyLimit: z.number().int().positive(), source: z.string().min(1) }).nullable(),
  // 첫 점검 결과가 나오기 전의 상태. 실호출 확인이 끝난 오퍼레이션은 null
  availabilityBeforeProbe: z.string().regex(/^UNVERIFIED:[A-Z_]+$/).nullable(),
});

export const serviceSchema = z.object({
  no: z.number().int().min(1).max(26), // 명세서 파일 번호
  serviceId: z.string().regex(/^SVC-API-\d{3}$/),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  baseUrl: z.string().startsWith("https://"),
  version: z.string().nullable(),
  deployedAt: z.string().nullable(),
  specFile: z.string().endsWith(".docx"),
  operations: z.array(operationSchema).min(1),
});

export const registrySchema = z
  .object({
    registryVersion: z.literal(1),
    generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().min(1),
    targetServices: z.number().int().positive(),
    confirmedServices: z.number().int().nonnegative(),
    unconfirmedServices: z.number().int().nonnegative(),
    unresolved: z.array(z.object({ slot: z.string(), state: z.literal("UNCONFIRMED"), note: z.string().min(1) })),
    common: z.object({
      allowedHosts: z.array(z.string().min(1)).min(1),
      method: z.literal("GET"),
      responseTypes: z.array(z.string()),
      commonRequestParams: z.array(z.string()),
      resultCodes: z.array(z.object({ code: z.string().regex(/^\d{2}$/), message: z.string(), description: z.string() })).min(1),
      resultCodesDifferInDocs: z.array(z.string()),
    }),
    services: z.array(serviceSchema).min(1),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });

    // 숫자가 서로 맞아야 한다: 목표 = 확정 + 미확정, 미확정 슬롯 수 = 미확정 수
    if (r.confirmedServices !== r.services.length) issue(`확정 서비스 수(${r.confirmedServices})와 등록된 서비스 수(${r.services.length})가 다릅니다.`);
    if (r.targetServices !== r.confirmedServices + r.unconfirmedServices) issue("목표 수가 확정 수와 미확정 수의 합과 다릅니다.");
    if (r.unresolved.length !== r.unconfirmedServices) issue("미확정 서비스 수와 미확정 슬롯 설명 수가 다릅니다.");

    // 식별값은 겹치면 안 된다
    const serviceIds = r.services.map((s) => s.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) issue("서비스ID가 중복되었습니다.");
    const fileNos = r.services.map((s) => s.no);
    if (new Set(fileNos).size !== fileNos.length) issue("명세서 번호가 중복되었습니다.");
    const operationKeys = r.services.flatMap((s) => s.operations.map((o) => `${s.serviceId}/${o.operationId}`));
    if (new Set(operationKeys).size !== operationKeys.length) issue("오퍼레이션이 중복되었습니다.");

    for (const s of r.services) {
      const host = new URL(s.baseUrl).hostname;
      if (!r.common.allowedHosts.includes(host)) issue(`${s.serviceId}: 허용되지 않은 호스트입니다 (${host}).`);
      for (const o of s.operations) {
        const where = `${s.serviceId}/${o.operationId}`;
        if (o.url !== `${s.baseUrl}/${o.path}`) issue(`${where}: 호출 주소가 서비스 주소와 경로의 합과 다릅니다.`);
        if (o.verification.state === "LIVE_VERIFIED" && !o.verification.verifiedAt) issue(`${where}: 실호출 확인인데 확인 날짜가 없습니다.`);
        // 명세만 확인한 오퍼레이션: 확인 날짜가 없고, 점검 입력이 없으면 점검 전 상태(UNVERIFIED)가 있어야 한다. 점검 입력이 있으면 점검 전 상태는 비어 있어도 된다(점검 대기)
        if (o.verification.state === "SPEC_ONLY" && (o.verification.verifiedAt !== null || (o.availabilityBeforeProbe === null && o.probe.input === null))) {
          issue(`${where}: 명세만 확인한 오퍼레이션은 확인 날짜가 없고, 점검 입력이 없으면 점검 전 상태가 UNVERIFIED여야 합니다.`);
        }
        // 점검 입력에 쓴 {…} 자리표시자는 알려진 것만 허용한다
        for (const [name, value] of Object.entries(o.probe.input ?? {})) {
          for (const token of value.matchAll(/\{([^}]*)\}/g)) {
            if (!(PROBE_INPUT_TOKENS as readonly string[]).includes(token[1])) issue(`${where}: 점검 입력 ${name}에 알 수 없는 자리표시자 {${token[1]}}가 있습니다.`);
          }
        }
        // 점검 입력이 있으면 근거(어디서 확인된 값인가)가 있어야 한다. 지어낸 값을 막는다
        if (o.probe.input !== null && (o.probe.inputSource === null || o.probe.mode === null)) issue(`${where}: 점검 입력에는 점검 방식과 근거(inputSource)가 있어야 합니다.`);
        if (o.verification.state === "LIVE_VERIFIED" && o.availabilityBeforeProbe !== null) issue(`${where}: 실호출 확인이 끝난 오퍼레이션에는 점검 전 상태를 두지 않습니다.`);
        // 확정되지 않은 값을 채워 두면 안 된다: 승인 확인·Probe 입력·쿼터는 근거가 있을 때만
        if (o.approval === "UNCONFIRMED" && (o.probe.mode !== null || o.quota !== null)) issue(`${where}: 승인이 확인되지 않았는데 점검 방식이나 쿼터가 채워져 있습니다.`);
      }
    }

    // 입력값 출처 후보는 실제로 등록된 오퍼레이션이어야 하고 자기 자신일 수 없다
    const known = new Set(operationKeys);
    for (const s of r.services) {
      for (const o of s.operations) {
        for (const c of o.inputSourceCandidates) {
          if (!known.has(c)) issue(`${s.serviceId}/${o.operationId}: 입력값 출처 후보 ${c}가 등록부에 없습니다.`);
          if (c === `${s.serviceId}/${o.operationId}`) issue(`${c}: 자기 자신이 입력값 출처 후보입니다.`);
        }
      }
    }
  });

export type ApiRegistry = z.infer<typeof registrySchema>;
export type RegistryService = z.infer<typeof serviceSchema>;
export type RegistryOperation = z.infer<typeof operationSchema>;

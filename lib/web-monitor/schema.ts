// Design Ref: docs/design-homepage-monitoring.md §5.1(2단계)·§11 / Plan W01 — 웹 대상 등록부(data/registry/web-targets.json) 스키마
// 모든 주소는 https + 허용 호스트여야 한다(allowed-hosts.ts). 틀리면 기본값으로 대신하지 않고 멈춘다.
import { z } from "zod";
import { checkAllowedUrl } from "./allowed-hosts";

const allowedUrl = z.string().refine((v) => checkAllowedUrl(v).ok, { message: "https이고 허용 호스트(www.onbid.co.kr, wait.onbid.co.kr)의 주소여야 합니다" });
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "소문자·숫자·하이픈만 쓸 수 있습니다");
const phrase = z.string().min(1).max(200).refine((v) => v.trim() === v, { message: "앞뒤 공백이 없어야 합니다" });
const phrases = (min: number) => z.array(phrase).min(min).max(50).refine((a) => new Set(a).size === a.length, { message: "같은 문구가 두 번 들어 있습니다" });
const path = z.string().regex(/^\/[^\s?#]*$/, "/로 시작하는 경로여야 합니다(주소 전체·공백·물음표 없음)");

const auxSchema = z.strictObject({
  key: slug,
  kind: z.enum(["stub", "json"]),
  label: z.string().min(1).max(40),
  url: allowedUrl,
  expectedRedirectPath: path.optional(), // stub 전용: 이동 대상 경로
});

const targetSchema = z
  .strictObject({
    key: slug,
    label: z.string().min(1).max(40),
    cert: z.strictObject({ host: z.string().refine((h) => checkAllowedUrl(`https://${h}/`).ok, { message: "허용 호스트여야 합니다" }), port: z.literal(443) }),
    primary: z.strictObject({ url: allowedUrl }),
    content: z.strictObject({
      mustContain: phrases(1),
      mustNotContain: phrases(1), // 점검 안내 문구. 비어 있으면 점검 감지가 꺼지므로 최소 1개 필수
      blockedPhrases: phrases(1), // 차단 페이지 문구(걸리면 실패가 아니라 검증 불가)
      minBytes: z.number().int().min(1000).max(50_000_000),
      bundlePaths: z.array(path).max(5), // 같은 호스트의 JS 번들 경로(주소 뒤 version 값은 HTML에서 뽑는다)
    }),
    aux: z.array(auxSchema).max(5),
  })
  .superRefine((t, ctx) => {
    const keys = t.aux.map((a) => a.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["aux"], message: "보조 점검 키가 겹칩니다" });
    t.aux.forEach((a, i) => {
      if (a.kind === "stub" && !a.expectedRedirectPath) ctx.addIssue({ code: "custom", path: ["aux", i, "expectedRedirectPath"], message: "stub에는 이동 대상 경로가 필요합니다" });
      if (a.kind === "json" && a.expectedRedirectPath) ctx.addIssue({ code: "custom", path: ["aux", i, "expectedRedirectPath"], message: "json에는 이동 대상 경로를 쓰지 않습니다" });
    });
    // mustNotContain에 필수 표식이 들어 있으면 어떤 응답도 정상일 수 없다(설정 모순)
    const clash = t.content.mustContain.find((m) => t.content.mustNotContain.includes(m));
    if (clash) ctx.addIssue({ code: "custom", path: ["content"], message: `필수 문구와 금지 문구가 같습니다: ${clash}` });
  });

export const webTargetsSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string().optional(),
    targets: z.array(targetSchema).min(1).max(10),
  })
  .superRefine((r, ctx) => {
    const keys = r.targets.map((t) => t.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["targets"], message: "대상 키가 겹칩니다" });
  });

export type WebTargetsRegistry = z.infer<typeof webTargetsSchema>;
export type WebTarget = WebTargetsRegistry["targets"][number];
export type WebAuxTarget = WebTarget["aux"][number];

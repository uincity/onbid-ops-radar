// Design Ref: docs/design-homepage-monitoring.md §5.1(2단계) / Plan W01 — 웹 대상 등록부 읽기
// data/registry/web-targets.json을 읽을 때마다 스키마로 검증한다. 틀리면 기본값으로 대신하지 않고 멈춘다.
// 서버 쪽 코드(점검 실행기)와 시험에서만 불러온다.
import webTargetsJson from "@/data/registry/web-targets.json";
import { webTargetsSchema, type WebTarget, type WebTargetsRegistry } from "./schema";

export type { WebTarget, WebAuxTarget, WebTargetsRegistry } from "./schema";

// 어디가 틀렸는지 알 수 있게 항목 이름과 이유를 모아 알린다 (등록부에는 비밀 값이 없다)
export function parseWebTargets(json: unknown): WebTargetsRegistry {
  const parsed = webTargetsSchema.safeParse(json);
  if (!parsed.success) {
    const reasons = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`);
    throw new Error(`웹 대상 등록부(data/registry/web-targets.json)가 올바르지 않습니다. ${reasons.join(" / ")}`);
  }
  return parsed.data;
}

export const WEB_TARGETS: WebTargetsRegistry = parseWebTargets(webTargetsJson);

export const allWebTargets = (registry: WebTargetsRegistry = WEB_TARGETS): WebTarget[] => registry.targets;

export const findWebTarget = (key: string, registry: WebTargetsRegistry = WEB_TARGETS): WebTarget | undefined => registry.targets.find((t) => t.key === key);

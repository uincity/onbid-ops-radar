// Design Ref: DESIGN §10 — DEMO 시나리오 160건을 코드에서 쓰기 편하게 꺼내는 곳
// 데이터 파일(data/demo/scenarios.json)은 scripts/generate-demo-data.mjs가 만든다. 직접 고치지 않는다.
import file from "@/data/demo/scenarios.json";
import type { DemoScenario, DemoScenarioFile } from "./types";

export const DEMO_SCENARIO_FILE = file as unknown as DemoScenarioFile;
export const DEMO_SCENARIOS: readonly DemoScenario[] = DEMO_SCENARIO_FILE.scenarios;

export const scenariosOf = (group: DemoScenario["group"]): DemoScenario[] => DEMO_SCENARIOS.filter((s) => s.group === group);

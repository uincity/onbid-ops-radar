// DEMO 시나리오 160건을 data/demo/scenarios.json 파일로 만든다 (PLAN 작업 17)
// 실행: npm run generate:demo
// 생성기(scripts/lib/demo-scenarios.mjs)를 고쳤을 때만 다시 돌리면 된다. 결과는 항상 같다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./lib/supabase-cli.mjs";
import { buildScenarioFile } from "./lib/demo-scenarios.mjs";

const file = buildScenarioFile();
const outDir = path.join(rootDir, "data", "demo");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "scenarios.json"), `${JSON.stringify(file, null, 2)}\n`);

const count = (group) => file.scenarios.filter((s) => s.group === group).length;
console.log(`data/demo/scenarios.json 생성: 모두 ${file.scenarios.length}건 (정상 ${count("normal")} · 이상 ${count("anomaly")} · 경계 ${count("boundary")})`);

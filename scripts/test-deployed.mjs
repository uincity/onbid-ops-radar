// 배포한 사이트의 보안 재검증 (R08, PRD 7-7 "Vercel 배포 후 주요 보안 테스트를 다시 실행", PLAN 37)
// 실행: npm run test:deployed -- --url https://onbid-ops-radar.vercel.app
// 로그인 없이 할 수 있는 것만 확인한다. 읽기(GET)와 "거부되어야 하는" 요청뿐이라 배포 데이터는 바뀌지 않는다.
//   SEC-01 비로그인 접근 거부 · SEC-09 비밀값 없는 예약 점검 호출 거부 · SEC-06 브라우저로 내려가는 파일의 비밀값 노출 0건 · HTTPS
// 로그인이 필요한 시험(SEC-02·03·08 등 화면 동작)은 같은 e2e를 배포 주소로 돌린다:  E2E_BASE_URL=https://... npm run test:e2e
// ⚠ 발견한 비밀값은 출력하지 않는다.
const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const base = urlIndex >= 0 ? args[urlIndex + 1] : undefined;
if (!base || !/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base)) {
  console.error("실패: --url https://도메인 형식(경로 없이)으로 배포 주소를 알려 주세요.");
  process.exit(1);
}
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);

let failed = 0;
const report = (ok, label, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
};
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });

// 비밀값(.env): 있으면 배포 파일 안에 그대로 들어 있는지 찾는다. 없으면 모양 검사만 한다.
const NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "DATA_GO_KR_SERVICE_KEY", "CRON_SECRET", "VERCEL_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "DEMO_ADMIN_PASSWORD", "DEMO_OPERATOR_PASSWORD"];
const secrets = NAMES.map((name) => ({ name, value: (process.env[name] ?? "").trim() })).filter((s) => s.value.length >= 8);
const SHAPES = [
  ["Supabase 비밀 키", /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ["Supabase 개인 액세스 토큰", /\bsbp_[A-Fa-f0-9]{20,}/],
  ["GitHub 토큰", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["OpenAI 키", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["개인키 블록", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

console.log(`배포 주소 검사: ${base}\n`);

// HTTPS
report(isLocal || base.startsWith("https://"), "HTTPS로 제공됨", isLocal ? "로컬 주소라 예외" : "");

// SEC-01: 로그인하지 않으면 보호된 화면은 로그인 화면으로, API는 401로
for (const path of ["/", "/anomalies", "/runs", "/reports"]) {
  const res = await get(path);
  const to = res.headers.get("location") ?? "";
  report(res.status >= 300 && res.status < 400 && /\/login/.test(to), `SEC-01 로그인 없이 ${path} → 로그인 화면으로 이동`, `응답 ${res.status}`);
}
const api = await get("/api/anything");
report(api.status === 401, "SEC-01 로그인 없는 API 요청은 401", `응답 ${api.status}`);
const report1 = await get("/reports/1/download");
report(report1.status !== 200, "SEC-01 로그인 없이 보고서 다운로드는 거부", `응답 ${report1.status}`);

// SEC-09: 비밀값 없이는 예약 점검이 시작되지 않는다
const noAuth = await get("/api/cron/daily-check", { method: "POST" });
report([401, 503].includes(noAuth.status), "SEC-09 비밀값 없는 예약 점검 호출 거부", `응답 ${noAuth.status}`);
const wrong = await get("/api/cron/daily-check", { method: "POST", headers: { Authorization: "Bearer definitely-wrong-value" } });
report([401, 503].includes(wrong.status), "SEC-09 틀린 비밀값 예약 점검 호출 거부", `응답 ${wrong.status}`);
const getCron = await get("/api/cron/daily-check");
report(getCron.status === 405, "SEC-09 예약 점검 입구는 POST만 허용 (GET 405)", `응답 ${getCron.status}`);
const body = await noAuth.text();
report(!/secret|password|stack|at \w+\.\w+ \(/i.test(body), "SEC-11 거부 응답에 내부 정보가 없음");

// SEC-06: 브라우저로 내려가는 파일(로그인 화면 HTML과 거기서 불러오는 스크립트·스타일)에 비밀값이 없다
const loginRes = await get("/login");
const html = await loginRes.text();
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
report(assets.length > 0, "로그인 화면이 불러오는 브라우저 파일을 찾음", `${assets.length}개`);
const texts = [html];
for (const asset of assets) {
  const res = await get(asset);
  if (res.ok) texts.push(await res.text());
}
const hits = [];
for (const text of texts) {
  for (const { name, value } of secrets) if (text.includes(value)) hits.push(name);
  for (const [kind, re] of SHAPES) if (re.test(text)) hits.push(kind);
}
report(hits.length === 0, "SEC-06 브라우저로 내려가는 파일에 비밀값·비밀 키 모양이 없음 (0건)", hits.length ? `발견 종류: ${[...new Set(hits)].join(", ")}` : `.env 비밀값 ${secrets.length}개 + 형태 검사`);

console.log(failed === 0 ? "\n배포 보안 재검증 통과 (비로그인 범위)" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

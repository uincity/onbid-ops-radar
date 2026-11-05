# 문서 반영 제안 (W09) — CLAUDE.md · DESIGN.md

W09는 `CLAUDE.md`·`DESIGN.md`를 고치는 작업이지만, 이번 요청의 규칙("CLAUDE.md·PRD.md·PLAN.md·DESIGN.md는 고치지 않는다") 때문에 **직접 고치지 않고 아래 제안만 적어 둡니다.** 필요하면 "제안대로 반영해 줘"라고 말씀해 주세요. 그때 한 번에 적용합니다.

## A. CLAUDE.md

이미 반영되어 있어 **고칠 필요 없는 것**: 텔레그램 승인(88행), 범위 예외(97행), 웹 대상은 DEMO 출처 없음(108행).

**제안 1 — 명령어 표에 줄 추가** (웹 점검 시험과 스케줄 등록):

| 목적 | 명령 |
|---|---|
| 홈페이지 점검 입구·실행기·판정 단위 시험 | `npx vitest run tests/unit/web-*.test.ts tests/unit/cron-jobs.test.ts` |
| 홈페이지 점검 실행기를 실제 DB에 돌려 보는 시험 (`tests/unit/web-runner-live.test.ts`, 시험용 대상 키만 쓰고 끝나면 지움, 서버 관리용 키 필요) | `LIVE_DB=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-runner-live.test.ts` |
| 홈페이지 점검 조회기를 실제 온비드에 붙여 보는 시험 (읽기 전용 GET 몇 번) | `WEB_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-probes-live.test.ts` |
| 홈페이지 점검 스케줄 등록 (`--web`을 붙여야 등록, `--remove-web`은 웹만 해제, `--remove`는 전부 해제) | `npm run setup:cron -- --app-url https://주소 --web [--apply]` |

**제안 2 — 도메인 규칙에 한 줄 추가** (홈페이지 모니터링):
- **홈페이지 점검 설정:** 웹 점검 설정은 기존 `settings`가 아니라 `web_settings` 테이블에 있고 `lib/web-monitor/settings-load.ts`의 `loadWebSettings()`로 읽습니다. 읽지 못하면 기본값으로 대신하지 않고 점검하지 않습니다. 설정 규칙(DB와 코드)을 바꾸면 두 곳을 함께 고치고 `tests/unit/web-settings-drift.test.ts`가 통과해야 합니다.
- **웹 점검 기록:** `web_probe_results`의 사유는 닫힌 목록(22개)이며, 새 사유는 코드 목록·DB 제약·`tests/unit/web-db-drift.test.ts`를 함께 고칩니다. 응답 본문·예외 원문은 저장하지 않습니다.

## B. DESIGN.md (`docs/design-homepage-monitoring.md`)

**제안 3 — §3.2 도구 표**: 새 라이브러리 없음이 구현 결과로 확인되었습니다(Node 내장 `dns`·`tls`·`fetch` 사용, 새 패키지 없음). 표는 그대로 두고, 3장 첫 문단 끝에 "(구현 확인: W01~W08에서 새 패키지를 설치하지 않았다)"를 덧붙이는 정도면 충분합니다.

**제안 4 — §11.1 폴더 구조**를 실제 코드에 맞춥니다:

| 지금 적힌 것 | 실제 |
|---|---|
| `probes/aux.ts` | `probes/aux-probe.ts` (Windows 예약 이름 `aux`는 git에서 문제가 되어 바꿈) |
| `settings.ts`가 두 번 적힘 (558, 567행) | `settings.ts`(순수: 검증·기본값) + `settings-load.ts`(서버 전용: DB 읽기) 두 파일 |
| 없음 | `classify-aux.ts`(보조 확인 판정), `cron-web-check.ts`(입구의 핵심 흐름), `slot.ts`(정시 칸), `registry.ts`, `store-memory.ts`(가짜 저장소), `probes/types.ts`·`http.ts`·`primary.ts`·`target.ts`·`node-transport.ts` |
| `scripts/setup-cron.mjs`만 적힘 | `scripts/lib/cron-jobs.mjs`(작업 목록·SQL·가림) 추가 |
| (적혀 있음) `app/api/cron/web-check/route.ts` | 구현 완료. 임시 리전 진단 경로는 `trash-can/web-region-probe-w00-1/`로 옮김 |

**제안 5 — §12.2 작업 묶음**: S3(W06, W07, W08)의 "연속 24회 실행 기록" 확인은 배포·`--web --apply` 등록 뒤에 하는 운영 확인으로 남아 있음을 표시합니다.

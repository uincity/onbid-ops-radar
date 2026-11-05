# 홈페이지 가용성 모니터링 사용 안내 (W09)

이 문서는 홈페이지 점검 기능(M1: 점검 → 기록까지)을 **쓰고 고치는 방법**을 모아 둔 안내서입니다. 무엇을 만들지는 [prd-homepage-monitoring.md](prd-homepage-monitoring.md), 구조는 [design-homepage-monitoring.md](design-homepage-monitoring.md), 일정은 [plan-homepage-monitoring.md](plan-homepage-monitoring.md)가 정합니다.

> 이 서비스는 서버 내부 감시가 아니라 **외부 이용자 관점의 합성 점검**입니다. 결과는 "우리 점검 요청에 관측된 결과"일 뿐이며, 전체 이용자가 겪는 상태를 뜻하지 않습니다.

## 1. 한눈에 보기

```
pg_cron (매시 :07)  →  POST /api/cron/web-check  →  runWebCheck
                         (CRON_SECRET 인증)            대상마다: 시작 → L1~L3·보조 확인 → 저장 → 종료
```

| 구성 | 위치 |
|---|---|
| 점검 대상 등록부 | `data/registry/web-targets.json` (검증: `lib/web-monitor/schema.ts`) |
| 웹 전용 설정 | DB 테이블 `web_settings` (기존 `settings`와 분리) |
| 판정 규칙(순수) | `lib/web-monitor/classify.ts`, `classify-aux.ts` |
| 프로브(접속·요청) | `lib/web-monitor/probes/` |
| 실행기 | `lib/web-monitor/runner.ts` |
| 입구 | `app/api/cron/web-check/route.ts` → `lib/web-monitor/cron-web-check.ts` |
| 스케줄 등록 | `scripts/setup-cron.mjs`, 작업 목록은 `scripts/lib/cron-jobs.mjs` |
| 기록 테이블 | `web_check_runs`, `web_probe_results`, `web_target_state`, `web_retry_queue` |

## 2. 점검 층 설명

한 번의 점검(실행)은 대상마다 아래 층을 **순서대로** 봅니다. 앞 층이 막히면 뒤 층은 "점검 못 함"(`UPSTREAM_FAILED`)으로 남습니다.

| 층 | 무엇을 보나 | 대표 판정에 포함 |
|---|---|---|
| `L1_CONNECT` | 주소 찾기(DNS)·접속(TCP)·보안연결(TLS), 인증서 만료·호스트명 | 예 |
| `L2_HTTP` | 대표 주소에 GET, 응답 코드·응답 시간·리다이렉트(최대 10회)·허용 호스트 | 예 |
| `L3_CONTENT` | 본문의 필수 문구·점검 문구·차단 문구·최소 크기·JS 번들 응답 | 예 |
| `AUX_STUB` | 진입 스텁(`/`)이 기대한 경로로 넘기는지 | **아니오**(참고용) |
| `AUX_QUEUE` | 대기열 설정 파일(JSON)이 정상인지 | **아니오**(참고용) |
| `L4_FILES` | 파일 확인 (M3에서 구현, 지금은 사용 안 함) | — |

### 판정 6종

`PASS_DATA`(정상) · `PASS_NO_DATA`(정상, 데이터 없음) · `DEGRADED`(느림·인증서 임박 등 저하) · `FAIL`(실패) · `UNVERIFIED`(검증 불가) · `NOT_RUN`(미점검).
`UNVERIFIED`와 `NOT_RUN`은 정상으로도 실패로도 세지 않습니다. 인증서 임박(`CERT_EXPIRING`) 신호와 보조 확인은 대표 판정에 영향을 주지 않습니다.

### 사유(닫힌 목록 22개)

사유는 `lib/web-monitor/classify.ts`의 `WEB_REASONS`에 정해진 것만 쓰고, DB 제약(`web_probe_results`)도 같은 목록입니다. 예외 원문·응답 본문·질의 문자열은 어디에도 저장하지 않습니다.
새 사유를 더하려면 **코드 목록·DB 제약(새 마이그레이션)·`tests/unit/web-db-drift.test.ts`를 함께** 고쳐야 합니다.

## 3. 등록부 사용법 (`data/registry/web-targets.json`)

대상 1개의 칸:

| 칸 | 뜻 |
|---|---|
| `key` | 대상 이름(영문 소문자·숫자·하이픈). DB의 `target_key`로 쓰이므로 **바꾸면 이력이 끊깁니다.** |
| `label` | 화면에 보일 이름 |
| `cert.host` / `cert.port` | 인증서를 확인할 호스트(허용 호스트만, 포트 443) |
| `primary.url` | 대표 점검 주소(`https`, 허용 호스트만) |
| `content.mustContain` | 본문에 **있어야 하는** 문구(없으면 L3 실패) |
| `content.mustNotContain` | 본문에 **없어야 하는** 점검 문구(있으면 점검 중으로 판정) |
| `content.blockedPhrases` | 우리 요청이 차단된 것으로 보이는 문구(있으면 검증 불가) |
| `content.minBytes` | 본문 최소 크기(미만이면 L3 실패) |
| `content.bundlePaths` | 함께 받아 볼 JS 번들 경로 |
| `aux[]` | 보조 확인. `kind`는 `stub`(리다이렉트 확인, `expectedRedirectPath` 필요) 또는 `json`(JSON 응답 확인) |

고치는 순서:
1. 파일을 고칩니다. 칸 이름이 틀리거나 허용 호스트(`www.onbid.co.kr`, `wait.onbid.co.kr`) 밖이면 **불러오는 순간 오류**가 납니다.
2. `npx vitest run tests/unit/web-registry.test.ts tests/unit/web-allowed-hosts.test.ts`로 검증합니다.
3. 실제 사이트와 맞는지 확인하려면(읽기 전용 GET 몇 번): `WEB_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-probes-live.test.ts`
4. 문구는 실제 홈페이지가 바뀌면 어긋납니다(`MARKER_MISSING`). 첫 주 관찰 뒤 조정합니다.

**허용 호스트를 늘리는 것은 보안 변경**이므로 `lib/web-monitor/allowed-hosts.ts`와 시험을 함께 고치고 사용자 승인을 받습니다. 요청은 GET만 보냅니다.

## 4. 웹 전용 설정

`web_settings` 테이블의 20개 항목(예: 타임아웃 `web_http_timeout_ms`, 느림 기준 `web_http_slow_ms`, 실행 시간 제한 `web_run_time_limit_seconds`, 켜고 끄는 `web_monitor_enabled`)입니다. 코드는 숫자를 직접 쓰지 않고 `loadWebSettings()`로 읽습니다. 읽지 못하거나 규칙에 어긋나면 기본값으로 대신하지 않고 점검하지 않습니다(입구가 503으로 답함).
값을 바꾸는 방법은 SQL(서버 관리)뿐이며 화면은 없습니다. 항목 규칙을 바꾸면 DB와 코드(`lib/web-monitor/settings.ts`)를 함께 고치고 `tests/unit/web-settings-drift.test.ts`가 통과해야 합니다.

## 5. 켜고 끄기

| 하고 싶은 것 | 방법 |
|---|---|
| 점검을 잠시 멈춤 | `web_settings`의 `web_monitor_enabled`를 `false`로 (입구가 200 `skipped: disabled`로 답하고 요청·기록을 하지 않음) |
| 스케줄 등록 미리 보기 | `npm run setup:cron -- --app-url https://배포주소 --web` |
| 스케줄 등록 | 위 명령에 `--apply` 추가 (OpenAPI 작업 2개 + 웹 작업 3개: `onbid-web-check`, `onbid-web-retry`, `onbid-web-heartbeat`) |
| 웹 스케줄만 해제 | `npm run setup:cron -- --remove-web --apply` |
| 모든 Cron 해제 | `npm run setup:cron -- --remove --apply` |

등록 순서: ① 배포해서 `/api/cron/web-check`이 올라가 있는지 → ② `--web` 미리 보기 → ③ `--apply`. 배포주소는 경로 없이 `https://도메인` 형식의 **고정 주소**를 씁니다.

## 6. 확인하는 방법

| 목적 | 명령 |
|---|---|
| 웹 점검 단위 시험 전체 | `npx vitest run tests/unit/web-*.test.ts tests/unit/cron-jobs.test.ts` |
| 입구 인증·꺼짐 시험 | `npx vitest run tests/unit/web-cron-check.test.ts` |
| 실행기 + 실제 DB (시험용 대상 키만 쓰고 지움) | `LIVE_DB=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-runner-live.test.ts` |
| 실제 홈페이지에 GET (읽기 전용) | `WEB_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/unit/web-probes-live.test.ts` |
| DB 테이블·보안 | `npm run check:db`, `npm run test:db` (Docker 필요) |
| 점검 기록 보기(Supabase SQL) | `select id, status, overall_verdict, slot_at from web_check_runs order by id desc limit 24;` |

연속 24회 실행 기록이 쌓이는지는 위 SQL로 확인합니다(정시 칸 `slot_at`이 매시 정각, 같은 칸 중복 없음).

## 7. 알아 둘 규칙

- **DEMO 출처가 없습니다.** 웹 대상은 실제 홈페이지만 보며, 시험은 가짜 전송 계층·가짜 저장소(`store-memory.ts`)로 합니다.
- **정시 칸**은 호출 시각의 UTC 정각입니다(`:07`이든 `:59`든 같은 칸). 같은 칸 중복은 DB가 막습니다.
- **웹 점검의 `running`은 OpenAPI 점검과 별개**입니다. 서로 막지 않습니다.
- **점검은 시간 예산**(`web_run_time_limit_seconds`)을 대상들이 나눠 씁니다. 모자라면 남은 층이 `BUDGET_SKIP`(미점검)이 되고 실행 상태는 `partial`입니다.
- 알림·사건·상태 전환·`/web` 화면·계획 점검 창·수동 점검·자체 감시는 M2에서 더해졌습니다. 운영(봇 만들기, 비밀값 두 곳 등록, 토큰 교체, 롤백, 정지 알림 대응)은 [web-monitor-ops.md](web-monitor-ops.md)를 봅니다.

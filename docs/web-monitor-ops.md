# 홈페이지 모니터링 운영 안내 (W18)

이 문서는 홈페이지 가용성 모니터링과 텔레그램 알림을 **운영하는 사람**을 위한 안내서입니다. 구조·점검 층·등록부 사용법은 [web-monitor-guide.md](web-monitor-guide.md), 설계는 [design-homepage-monitoring.md](design-homepage-monitoring.md), 계획은 [plan-homepage-monitoring.md](plan-homepage-monitoring.md)를 봅니다.

> 이 서비스는 서버 내부 감시가 아니라 **외부 이용자 관점의 합성 점검**입니다. 알림은 "우리 점검 요청에 관측된 결과"를 알려 주는 것이며, 전체 이용자가 겪는 장애를 확정하지 않습니다.

## 1. 한눈에 보기

```
Supabase Cron ─ 매시 :07      → POST /api/cron/web-check   점검 → 상태 전환 → 알림 발송
              ─ 매분          → web_enqueue_due_retries()   재확인 예정·미발송 알림이 있을 때만 /api/cron/web-retry 호출
              ─ 10분마다      → web_monitor_heartbeat()     점검이 멈췄는지 감시 → 정지·재개 알림을 DB가 텔레그램으로 직접 발송 (앱 없이)
              ─ 매일 KST 03:30 → web_retention_cleanup()     90일 지난 점검 기록을 일별 요약으로 남기고 삭제 (cron 실행 기록은 14일 초과분 정리)
```

| 구성 | 어디에 있나 | 비밀값 |
|---|---|---|
| 점검·상태 전환·알림(앱) | Vercel 배포 (`/api/cron/web-check`, `/api/cron/web-retry`) | `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (Vercel 환경변수) |
| 자체 감시(DB) | Supabase 함수 `web_monitor_heartbeat()` | Vault: `onbid_telegram_token`, `onbid_telegram_chat_id` |
| 스케줄 | Supabase Cron 작업 4개 (`onbid-web-check`, `onbid-web-retry`, `onbid-web-heartbeat`, `onbid-web-retention`) | Vault: `onbid_cron_secret`, `onbid_app_url` |
| 계획 점검 창·수동 점검 | `/web` 화면 (팀장 전용) | — |

**텔레그램 비밀값은 두 곳(Supabase Vault + Vercel 환경변수)에만** 둡니다. 앱이 죽어도 정지 알림이 나가도록 DB도 직접 보내기 때문입니다. `NEXT_PUBLIC_`을 붙이지 않고, 화면·로그·커밋·채팅에 남기지 않습니다.

## 2. 텔레그램 봇 만들기 (처음 한 번)

1. 텔레그램에서 **@BotFather**와 대화를 시작하고 `/newbot`을 보냅니다. 봇 이름과 `…bot`으로 끝나는 사용자명을 정하면 **봇 토큰**을 줍니다. 이 토큰은 비밀번호와 같습니다. 채팅·문서에 붙이지 마세요.
2. 알림을 받을 **대화방**을 정합니다(내 개인 대화 또는 팀 그룹). 그룹이면 봇을 그룹에 초대합니다.
3. 그 대화방에서 봇에게 메시지를 한 번 보냅니다(그룹이면 아무 말이나).
4. **대화방 번호(chat id)** 를 확인합니다. 브라우저에서 `https://api.telegram.org/bot<봇토큰>/getUpdates` 를 열면 `chat":{"id": …}` 가 보입니다(그룹은 `-`로 시작하는 음수). 이 주소에는 토큰이 들어 있으니 공유 화면·기록에 남기지 마세요.
5. 프로젝트 `.env`에 두 값을 넣습니다(파일은 커밋되지 않습니다).
   ```
   TELEGRAM_BOT_TOKEN=(봇 토큰)
   TELEGRAM_CHAT_ID=(대화방 번호)
   ```

## 3. 비밀값 등록 (두 곳)

`.env`의 값을 읽어 **Supabase Vault와 Vercel 환경변수 두 곳에 함께** 등록하는 스크립트가 있습니다. 출력은 모두 가려지고, 토큰은 명령 줄에 쓰지 않습니다.

| 순서 | 하는 일 | 명령 |
|---|---|---|
| 1 | 토큰이 맞는지 확인(토큰은 출력 안 함) | `npm run setup:telegram -- --check` |
| 2 | 미리 보기(어디에 무엇을 등록할지만 보임) | `npm run setup:telegram -- --app-url https://onbid-ops-radar.vercel.app` |
| 3 | 대화방에 **시험 메시지 1건** 보내기 | `npm run setup:telegram -- --send-test` |
| 4 | 등록 | `npm run setup:telegram -- --app-url https://onbid-ops-radar.vercel.app --apply` |
| 5 | **Vercel 다시 배포** (등록한 환경변수는 다음 배포부터 읽힘) | 배포 절차대로 |

등록되는 것: Vault `onbid_telegram_token`·`onbid_telegram_chat_id`, Vercel Production의 `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`(민감값), `APP_BASE_URL`, `WEB_NOTIFY_MODE=telegram`.
**`WEB_NOTIFY_MODE=telegram`은 운영 배포에만** 있습니다. 개발·시험에서는 값이 없어서(`log`) `.env`에 토큰이 있어도 실제로 보내지 않습니다.

### 알림 시험 수신 기록

처음 등록하거나 토큰을 바꾼 뒤에는 `--send-test`로 시험 메시지 1건을 보내고 **실제로 도착했는지** 아래에 적습니다(날짜·확인한 사람·결과).

| 날짜 | 한 일 | 확인한 사람 | 결과 |
|---|---|---|---|
| 2026-11-05 | 시험 메시지 발송과 두 곳 등록 | 사용자 | 시험 메시지 정상 수신 (2026-11-06 사용자 확인) |
| | | | |

### 유형별 시험 알림 (실제 장애 없이 문구 확인)

실제 장애를 일으키지 않고도 알림 종류별 문구를 텔레그램에서 볼 수 있습니다. **DB·상태·알림 기록·알림 키를 건드리지 않고**, 모든 문구에 `🧪 [시험 n/17]` 표시가 붙으며 이상징후 링크는 넣지 않습니다.

```bash
npm run test:notify-samples
```

- 17건: 장애 감지 6가지 사유(서버 오류·시간 초과·주소 조회 실패·보안 연결 실패·필수 문구 없음·인증서 오류), 성능 저하, 장애 지속, 복구, 인증서 임박, 점검 불가, 미등록 점검, 보조 점검 이상 2가지, 알림 억제, 모니터 정지, 모니터 재개.
- 일부만 보내려면 id를 쉼표로 적습니다: `NOTIFY_SAMPLES_ONLY=down-5xx,cert npm run test:notify-samples` (id 목록은 `lib/web-monitor/notify/samples.ts`).
- 지금 `.env`의 대화방(운영 대화방과 같다면 그곳)으로 가므로 한꺼번에 도착합니다. 모니터 정지·재개 문구는 DB 함수가 SQL로 만드는 것과 같은 말이며, 단위 시험이 둘이 어긋나지 않는지 확인합니다.
- 실제로 장애를 일으키는 시험은 운영 기록(이상징후는 삭제 불가)과 관찰 데이터를 오염시키므로 권하지 않습니다.

## 4. 토큰 교체 (두 곳을 함께)

토큰이 노출됐거나 담당자가 바뀌면 교체합니다. **한 곳만 바꾸면 앱과 DB 감시가 서로 다른 봇을 쓰게 되므로 반드시 두 곳을 함께** 바꿉니다.

1. @BotFather에서 `/revoke`(또는 `/token`)로 새 토큰을 받습니다. 이전 토큰은 즉시 못 쓰게 됩니다.
2. `.env`의 `TELEGRAM_BOT_TOKEN`을 새 값으로 고칩니다(대화방을 바꾸면 `TELEGRAM_CHAT_ID`도).
3. `npm run setup:telegram -- --check` → `--send-test`로 새 토큰으로 1건이 도착하는지 확인합니다.
4. `npm run setup:telegram -- --app-url https://onbid-ops-radar.vercel.app --apply` 로 **두 곳을 다시 등록**합니다.
5. Vercel을 **다시 배포**합니다.
6. 위 "알림 시험 수신 기록"에 한 줄 적습니다.

### 토큰·비밀값 점검 일정

| 대상 | 만료 | 권장 점검 |
|---|---|---|
| 텔레그램 봇 토큰 | **자동 만료 없음**(직접 폐기·재발급하기 전까지 유효) | 담당자 교체·노출 의심 때 즉시 교체. 정기 점검은 **6개월마다** 교체 여부를 검토(권장 주기이며 시스템이 강제하지 않음) |
| `CRON_SECRET` | 자동 만료 없음 | 교체하면 `setup:cron --apply`로 Vault와 Vercel을 함께 갱신 |
| Supabase·Vercel 접근 토큰(`.env`) | 발급 때 정한 기간(예: 30일·1주) | CLAUDE.md의 확인 명령 `npm run check:cli`가 실패하면 새로 발급 |

## 5. 켜기·끄기와 롤백

가벼운 단계부터 순서대로 씁니다. 앞 단계로 충분하면 뒤 단계는 하지 않습니다.

| 단계 | 상황 | 하는 일 | 효과 |
|---|---|---|---|
| 1 | 알림이 너무 많음·오탐이 의심됨 | 계획 점검 창을 등록(`/web`, 팀장) | 창 안의 점검은 알림·가용률·이상징후에서 제외. 점검은 계속 기록 |
| 2 | 텔레그램만 멈추고 싶음 | Vercel의 `WEB_NOTIFY_MODE`를 지우고(또는 `log`) 다시 배포 | 앱이 알림을 보내지 않고 기록만(`log`). **DB 자체 감시의 정지 알림은 계속 나감** — 그것도 멈추려면 3단계 |
| 3 | **점검 전체를 멈춤** | `web_settings`의 `web_monitor_enabled`를 `false`로 | 정시 점검·재확인·자체 감시가 모두 아무것도 하지 않음(요청도 기록도 없음). 입구는 200 `skipped: disabled`로 답해 스케줄러가 실패로 보지 않음 |
| 4 | 스케줄 자체를 내림 | `npm run setup:cron -- --remove-web --apply` | 웹 작업 4개 해제(OpenAPI 작업은 그대로). `--remove`는 OpenAPI 작업까지 전부 해제 |
| 5 | 코드를 이전 배포로 되돌림 | Vercel에서 이전 배포로 되돌리기(Instant Rollback) | 앱만 되돌아감. **DB 객체와 쌓인 기록은 그대로** |

켜기: 3단계는 `web_monitor_enabled`를 `true`로 되돌립니다. **다시 켠 시각이 자체 감시의 기준이 되므로**, 켠 직후 첫 정시 점검 전에는 정지 알림이 울리지 않습니다(130분 기준). 4단계는 `setup:cron --web --apply`로 다시 등록합니다.

`web_monitor_enabled`를 바꾸는 SQL(Supabase SQL 편집기, 서버 관리자만):

```sql
update public.web_settings set value = 'false'::jsonb where key = 'web_monitor_enabled';  -- 끄기
update public.web_settings set value = 'true'::jsonb  where key = 'web_monitor_enabled';  -- 켜기
```

**되돌릴 수 없는 것(알아 둘 것):**
- 알림 키·알림 기록·이상징후 이력은 **추가 전용**이라 지우거나 고칠 수 없습니다(감사 목적).
- 홈페이지 장애가 한 번이라도 이상징후(`WEB`)로 만들어졌다면 이상징후 출처 `WEB` 허용을 DB에서 되돌릴 수 없습니다. 롤백은 "기능을 멈추는 것"이지 "기록을 지우는 것"이 아닙니다.
- 새 DB 객체는 **마이그레이션 파일로만** 만들고, 대시보드에서 직접 고치지 않습니다.

## 6. 평소 운영

### 계획 점검 창 (팀장)
- 위치: `/web` 맨 아래 "계획 점검 창". 시간은 **KST**로 입력합니다.
- 규칙: 같은 시간대에 겹쳐 등록할 수 없고(이어 붙이는 것은 가능), 한 창은 최대 `web_window_max_hours`(기본 168시간)입니다. 사유는 1~200자.
- 취소: 시작 전 창은 취소 표시만 남고, 진행 중 창은 종료 시각이 지금으로 당겨지며, 끝난 창은 취소할 수 없습니다.
- 창 안의 점검은 "계획 점검"으로 표시되고 알림·가용률·이상징후에서 빠집니다. 점검 안내가 보이는데 **창이 없으면** "미등록 점검" 알림이 1회 나가고, 6시간(`web_unplanned_escalate_hours`)을 넘기면 일반 장애로 승격됩니다.

### 수동 점검 (팀장)
- 위치: `/web`의 "지금 점검". 결과는 점검 이력에 **"수동"으로만** 기록되고 현재 상태·사건·알림·재확인에 반영되지 않습니다. 점검이 꺼져 있으면 실행되지 않습니다.
- 오탐이 의심될 때 사무실 브라우저 결과와 맞대어 보는 용도로 씁니다. 수동 실행은 자체 감시의 "살아 있음" 기준에도 들어가지 않습니다.

## 7. 알림이 왔을 때 / 안 올 때

| 받은 알림 | 뜻 | 할 일 |
|---|---|---|
| 🔴 장애 감지 | 정시 점검이 실패하고 재확인에서도 실패(또는 열린 사건) | `/web`에서 어느 층·사유인지 보고, 링크의 이상징후에서 담당자 배정·처리 |
| 🟠 성능 저하 | 느림 등이 연속으로 이어짐 | 응답 시간 추이 확인 |
| ⏳ 장애 지속 | 사건이 이어지는 중(기본 3시간마다) | 처리 현황 확인 |
| 🟢 복구 | 정상 판정으로 돌아옴 | 이상징후는 **자동으로 닫히지 않음**. 담당자가 확인 후 종결 |
| 🟡 인증서 만료 임박 / 보조 점검 이상 | 대표 판정에는 영향 없는 참고 신호 | 인증서 갱신 일정 확인 |
| 🔧 미등록 점검 감지 | 점검 안내가 보이는데 등록된 창이 없음 | 사전 공지된 점검이면 창 등록, 아니면 확인 |
| ⚫ **모니터 정지** | 정시·재확인으로 정상 종료한 점검이 130분(기본) 넘게 없음. **점검 프로그램 자체가 멈췄다는 뜻**이며 홈페이지 장애가 아닐 수 있음 | 아래 "정지 알림 대응" |
| 🟢 모니터 재개 | 점검이 다시 정상 종료됨 | 조치 완료 확인 |

### 정지 알림 대응
1. `/web` 맨 위 경고 띠와 "마지막 정상 점검" 시각을 봅니다.
2. Supabase Cron 작업이 살아 있는지: `select jobname, schedule, active from cron.job where jobname like 'onbid-web-%';` (4개, `active = true`)
3. 최근 실행 결과: `select start_time, status, return_message from cron.job_run_details order by start_time desc limit 10;`
4. Vercel 배포가 정상인지, `CRON_SECRET`·`onbid_app_url`이 맞는지 확인합니다. 의심되면 `npm run setup:cron -- --app-url https://onbid-ops-radar.vercel.app --web --apply`로 다시 등록합니다.
5. 점검을 일부러 꺼 둔 것이면(`web_monitor_enabled=false`) 정지 알림은 나가지 않습니다.
6. 정지가 이어지면 24시간마다 다시 알립니다. 해결되어 점검이 정상 종료되면 "모니터 재개"가 1회 나갑니다.

### 알림이 안 올 때 확인
```sql
-- 최근 알림의 상태 (queued=대기, sent=발송됨, failed=실패)
select key, attempt, status, error_class, created_at from public.web_notifications order by id desc limit 20;
-- 감시 알림의 요청 번호와 응답 확인 상태
select key, attempt, settled, sent_at from public.web_heartbeat_sends order by sent_at desc limit 10;
-- 자체 감시 함수 한 번 직접 실행 (서버 관리자만)
select public.web_monitor_heartbeat();
```
- `failed` + `error_class`: `http_4xx`(봇 토큰·대화방 번호 틀림, 봇이 대화방에서 쫓겨남), `http_5xx`·`timeout`·`network_error`(텔레그램 쪽 일시 문제, 자동 재시도), `rate_limited`(너무 자주 보냄), `secret_missing`(Vault에 비밀값 없음 → 3단계 다시 등록).
- 앱 알림은 15분 넘게 `sent`가 없으면 회수 경로가 최대 5회까지 다시 보냅니다. 감시 알림은 10분 간격으로 최대 3회 다시 보냅니다.
- `/web`의 알림 기록에서 실패·미발송은 붉게 보이고, 대시보드·`/web` 맨 위에도 경고 띠가 켜집니다.

## 8. 정기 확인 목록

| 주기 | 확인 |
|---|---|
| 매일 | `/web` 24시간 띠에 빈 칸이 없는지, 알림 기록에 붉은 줄이 없는지 |
| 매주 | 계획 점검 창 등록 누락(점검 공지가 있었는데 "미등록 점검"이 울렸는지), 오탐·미탐 기록 |
| 토큰 교체·담당자 변경 때 | 4장의 교체 절차, 알림 시험 수신 기록 갱신 |
| 6개월(권장) | 봇 토큰 교체 검토, 비밀값 두 곳이 같은 봇인지 `--check`로 확인 |
| 운영 첫 1주 | 임계값(`web_http_slow_ms` 등) 조정, 야간·주말·입찰 마감 시간대 응답 시간 확인 → `docs/web-monitor-observation.md`에 기록 |

### 점검 기록 보존 (하루 1회)
- 정시 점검 기록은 `web_result_retention_days`(기본 **90일**) 동안 `web_check_runs`·`web_probe_results`에 남습니다. 그보다 오래된 **KST 하루 전체**는 `web_retention_cleanup()`이 일별 요약(`web_daily_summary`: 판정별 횟수, 계획·미등록 점검, 일시 실패, 확정 실패, 평균·최대 응답 시간)으로 남긴 뒤 삭제합니다. 요약은 지우지 않습니다.
- 알림 키·알림 시도 기록·이상징후 이력은 추가 전용이라 **삭제되지 않습니다.**
- 같은 작업이 `cron.job_run_details`의 14일 넘은 줄도 정리합니다(권한이 없으면 건너뜀).
- 보존 일수를 줄이면 다음 정리 때 그만큼 더 지워지고 **되돌릴 수 없습니다.** 줄이기 전에 요약이 기대한 값인지 `select * from public.web_summarize_day(date '2026-11-05');` 로 확인하세요.
- 가용률 = 정상 계열 ÷ (판정 횟수 − 검증 불가 − 미점검 − 계획 점검 − 미등록 점검). 저하는 정상 계열이 아닙니다. 확정 실패 시간(`down_seconds`)은 정시 간격 1시간 단위의 근사입니다.

## 9. 지켜야 할 규칙

- 점검은 **GET만** 보내며 허용 호스트(`www.onbid.co.kr`, `wait.onbid.co.kr`) 밖으로 나가지 않습니다. 호스트를 늘리는 것은 보안 변경이라 코드와 시험을 함께 고치고 승인을 받습니다.
- 응답 본문·예외 원문·토큰은 저장하지 않습니다. 오류는 분류 이름만 남습니다.
- 알림 문구에 OpenAPI 서비스 이야기를 섞지 않습니다(이 기능은 일반 인터넷망 서비스 점검 전용).
- 비밀값은 `.env`와 위 두 곳에만 둡니다. 채팅·문서·커밋에 쓰지 않습니다.

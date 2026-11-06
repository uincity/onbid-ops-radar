# 홈페이지 모니터링 1주 운영 관찰 기록

이 문서는 홈페이지 가용성 모니터링(M2까지 구현)을 **실제로 1주 돌려 보며** 오탐·미탐을 기록하고 임계값을 조정하는 **기록 양식**입니다. 계획서의 "1주 운영 관찰"(M2 뒤, M3 앞) 단계의 산출물이며, **이 기간에는 새 기능을 만들지 않습니다.** 운영 방법은 [web-monitor-ops.md](web-monitor-ops.md), 점검 층·사유는 [web-monitor-guide.md](web-monitor-guide.md)를 봅니다.

> 점검은 **외부 이용자 관점의 합성 점검**입니다. 여기서 말하는 오탐·미탐은 "우리 점검 요청에 관측된 결과가 실제 홈페이지 상태와 어긋난 것"이며, 온비드 서버 전체의 상태를 판단하는 것이 아닙니다.

## 0. 관찰 개요 (시작할 때 적기)

| 항목 | 내용 |
|---|---|
| 관찰 기간 | 2026-11-__ ~ 2026-11-__ (7일, 시작일은 직접 정하세요. 제안: 자체 감시·보존 삭제 크론까지 켠 직후) |
| 관찰 담당 | |
| 배포 버전(main 커밋) | |
| 켜 둔 기능 | 정시 점검(매시 :07) · 재확인 · 자체 감시(10분) · 보존 삭제(매일) · 텔레그램 알림 |
| 시작 때 임계값 | 3장 "시작 값" 표를 그대로 둡니다 |
| 이 기간 중 코드 변경 | 없음(있으면 5장 "관찰 중 일어난 일"에 적기) |

**관찰의 목적 4가지:** ① 오탐(실제로는 열리는데 알림이 나감)과 미탐(실제 문제인데 알림이 없음)을 찾는다 ② 임계값이 너무 민감하거나 무딘지 본다 ③ 사무실 브라우저 결과와 비교한다(해외 IP·방화벽(WAF) 영향) ④ 야간·주말·입찰 마감 시간대의 응답 시간 특성을 안다.

## 1. 매일 기록 (하루 한 줄)

하루가 끝나면 2장의 SQL로 숫자를 뽑아 적습니다. 값은 KST 하루 기준입니다.

| 날짜(KST) | 정시 칸 수 | 정상 | 저하 | 실패 | 확인 불가 | 미점검 | 계획 점검 | 미등록 점검 | 일시 실패 | 평균 ms | 최대 ms | 받은 알림 | 오탐 의심 | 메모 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | |

- 하루 정시 칸은 **24개**여야 합니다. 모자라면 빈 칸의 시각을 메모에 적고 원인(점검 정지·차단·배포 중)을 확인합니다.
- 가용률 = 정상 계열(정상 + 정상(데이터 없음)) ÷ (판정 횟수 − 확인 불가 − 미점검 − 계획 점검 − 미등록 점검). **저하는 정상 계열이 아닙니다.**

## 2. 숫자 뽑는 SQL (Supabase SQL 편집기, 읽기 전용)

**하루 요약** (같은 집계 함수를 보고서·보존 삭제도 씁니다. 최근 7일):

```sql
select s.*
  from generate_series((now() at time zone 'Asia/Seoul')::date - 6, (now() at time zone 'Asia/Seoul')::date, interval '1 day') as d,
       lateral public.web_summarize_day(d::date, 'onbid-home') as s
 order by s.summary_date;
```

**시간대별 응답 시간** (KST 시각별 L2 HTTP 응답, 정시 점검만. 야간·주말·마감 시간대 비교용):

```sql
select extract(hour from r.started_at at time zone 'Asia/Seoul')::int as hour_kst,
       count(*) as n,
       round(avg(p.duration_ms)) as avg_ms,
       percentile_cont(0.95) within group (order by p.duration_ms)::int as p95_ms,
       max(p.duration_ms) as max_ms
  from public.web_probe_results p join public.web_check_runs r on r.id = p.run_id
 where p.layer = 'L2_HTTP' and r.trigger = 'scheduled' and p.duration_ms is not null
   and r.started_at > now() - interval '7 days'
 group by 1 order by 1;
```

**느림 기준(`web_http_slow_ms`)을 넘긴 비율** (기준을 정하기 전에 분포를 봅니다):

```sql
select count(*) filter (where p.duration_ms > 3000) as over_3s,
       count(*) filter (where p.duration_ms > 5000) as over_5s,
       count(*) as total
  from public.web_probe_results p join public.web_check_runs r on r.id = p.run_id
 where p.layer = 'L2_HTTP' and r.trigger = 'scheduled' and r.started_at > now() - interval '7 days';
```

**실패·저하·확인 불가 목록** (사유 포함. 대표 판정에 들어가는 층만):

```sql
select r.id, r.started_at at time zone 'Asia/Seoul' as started_kst, r.overall_verdict, r.confirmed_verdict, r.flap, r.planned_maintenance,
       p.layer, p.verdict, p.reason, p.http_status, p.duration_ms
  from public.web_check_runs r join public.web_probe_results p on p.run_id = r.id
 where r.trigger = 'scheduled' and p.counts_toward_overall and p.verdict in ('FAIL', 'DEGRADED', 'UNVERIFIED')
   and r.started_at > now() - interval '7 days'
 order by r.started_at;
```

**사유 분포** (어떤 사유가 많은지):

```sql
select p.reason, p.verdict, count(*) as n
  from public.web_probe_results p join public.web_check_runs r on r.id = p.run_id
 where r.trigger in ('scheduled', 'retry') and p.counts_toward_overall and p.reason is not null and r.started_at > now() - interval '7 days'
 group by 1, 2 order by n desc;
```

**일시 실패(한 번 실패했다가 재확인에서 정상)**:

```sql
select r.id, r.started_at at time zone 'Asia/Seoul' as started_kst, r.overall_verdict, r.confirmed_verdict
  from public.web_check_runs r where r.flap and r.started_at > now() - interval '7 days' order by r.started_at;
```

**보낸 알림과 결과**:

```sql
select n.key, n.kind, n.status, n.attempt, n.error_class, n.created_at at time zone 'Asia/Seoul' as created_kst
  from public.web_notifications n where n.created_at > now() - interval '7 days' order by n.id;
```

**보조 확인(진입 스텁·대기열)과 인증서 남은 일수**:

```sql
select p.layer, p.verdict, count(*) as n, min(p.cert_days_left) as min_cert_days
  from public.web_probe_results p join public.web_check_runs r on r.id = p.run_id
 where r.trigger = 'scheduled' and r.started_at > now() - interval '7 days'
 group by 1, 2 order by 1, 2;
```

## 3. 임계값 (시작 값과 조정 기록)

기본값은 설계서에 정한 값이며, 코드는 숫자를 직접 쓰지 않고 `web_settings`를 읽습니다. 조정은 **한 번에 하나씩**, 바꾼 이유와 기대 효과를 적고 며칠 지켜봅니다. 범위를 벗어난 값은 DB가 거부합니다.

| 설정 키 | 시작 값 | 뜻 | 허용 범위 | 조정 후보를 볼 때 |
|---|---|---|---|---|
| `web_http_timeout_ms` | 10000 | 요청 타임아웃(ms) | 1000~30000 | 정상인데 `TIMEOUT`이 잦으면 |
| `web_http_slow_ms` | 3000 | 이보다 느리면 "성능 저하" | 1000~(타임아웃 미만) | 저하 알림이 시간대 때문에 잦으면 |
| `web_confirm_retry_delay_sec` | 90 | 실패 뒤 재확인까지 | — | 일시 실패 비율이 높으면 |
| `web_realert_after_hours` | 3 | 장애 지속 알림 간격 | — | 지속 알림이 과하거나 늦으면 |
| `web_degraded_alert_count` | 2 | 저하가 몇 번 이어지면 알림 | — | 저하 알림 피로 |
| `web_unverifiable_alert_count` | 3 | 확인 불가 연속 알림 기준 | — | 차단·제한 의심 빈도 |
| `web_aux_alert_count` | 3 | 보조 확인 이상 연속 알림 기준 | — | 스텁·대기열 이상 빈도 |
| `web_cert_warn_days` | 14 | 인증서 임박 알림 | — | 인증서 갱신 주기와 맞는지 |
| `web_heartbeat_stale_min` | 130 | 점검 정지로 보는 시간(분) | 90~1440 | 정지 알림이 오탐이면 |
| `web_alert_daily_cap` | 12 | 하루 알림 상한(대상별) | — | 상한에 닿은 날이 있는지 |
| `web_unplanned_escalate_hours` | 6 | 미등록 점검이 이어지면 장애로 승격 | — | 미등록 점검 빈도 |
| `web_run_time_limit_seconds` | 80(운영) | 점검 1회 시간 한도 | 10~85 | `partial`·`BUDGET_SKIP`이 있으면 |

**조정 기록** (바꿀 때마다 한 줄):

| 날짜 | 설정 키 | 이전 → 이후 | 이유(근거 숫자) | 결과(며칠 뒤 적기) |
|---|---|---|---|---|
| | | | | |
| | | | | |

바꾸는 SQL(서버 관리자만):

```sql
update public.web_settings set value = '4000'::jsonb where key = 'web_http_slow_ms';  -- 예시: 3000 → 4000
```

> 설정 규칙(DB 허용 범위와 코드)을 **바꾸는** 것은 이 단계의 조정이 아니라 코드 변경입니다. 값만 바꿉니다.

## 4. 오탐·미탐 기록

한 건당 한 줄. **오탐**은 알림·실패 판정이 났지만 사무실 브라우저로는 열린 경우, **미탐**은 실제로 문제가 있었는데 알림·판정이 없던 경우입니다.

| # | 날짜·시각(KST) | 구분(오탐/미탐) | 무슨 일이었나 | 점검 번호(`/web/runs/…`) | 원인 추정(사유 코드 포함) | 조치(임계값·문구 조정/무시) | 해결 여부 |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

원인 분류 예: 일시적 네트워크 문제 / 우리 서버 지역·IP 차단(WAF) / 점검 문구 오인 / 응답 느림 기준이 낮음 / 사이트 개편으로 필수 문구 변경(`MARKER_MISSING`) / 실제 장애.

## 5. 사무실 브라우저 대조 (해외 IP·WAF 확인)

우리 점검은 서버(서울 리전 서버리스)에서 요청하므로, 일반 이용자 브라우저와 결과가 다를 수 있습니다(방화벽·봇 차단·국가 제한). 실패·저하·확인 불가가 났을 때 **같은 시각에 사무실에서 직접** 열어 비교합니다.

| 날짜·시각(KST) | 우리 점검 결과(판정·사유) | 사무실 브라우저 결과(열림/느림/안 열림) | 일치 여부 | 비고(차단 화면, 대기열, 점검 안내 등) |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

- 판단 기준: 우리 점검만 실패하고 사무실은 정상이면 **우리 점검 경로의 문제(차단·지역)** 로 보고 `UNVERIFIED`로 다룰지 검토합니다(실패 알림 대신).
- 차단이 의심되면 응답 상태와 사유만 기록합니다. **응답 본문은 저장하지 않는 것이 규칙**이므로 화면 캡처 등은 개인 기록으로만 남깁니다.

## 6. 시간대별 특성

2장의 "시간대별 응답 시간" 결과를 옮겨 적고, 눈에 띄는 시간대를 표시합니다.

| 구간(KST) | 정시 점검 수 | 평균 ms | p95 ms | 최대 ms | 관찰 |
|---|---|---|---|---|---|
| 야간 00~06시 | | | | | |
| 오전 06~12시 | | | | | |
| 오후 12~18시 | | | | | |
| 저녁 18~24시 | | | | | |
| 주말 | | | | | |
| 입찰 마감 시간대 (마감 시각: ______ ) | | | | | 마감 직전 접속 몰림으로 느려지는지 |

입찰 마감 시각은 온비드 공고마다 다를 수 있으므로 **확인해서 적습니다.** 확인되지 않았으면 비워 두고 "미확인"이라 적습니다.

## 7. 관찰 중 일어난 일

| 날짜 | 일 | 영향 | 조치 |
|---|---|---|---|
| | 예: 배포, 점검 정지 알림, 계획 점검 창 등록, 토큰 교체, 사이트 개편 | | |

## 8. 관찰 끝에 판단할 것 (체크리스트)

| 질문 | 근거 | 결정 |
|---|---|---|
| 하루 정시 칸이 매일 24개였나, 빈 날의 원인은 | 1장 | |
| 오탐이 하루 몇 건이었고, 알림 피로가 있었나 | 4장, 받은 알림 수 | |
| 미탐이 있었나(사무실에서 안 열렸는데 알림 없음) | 4·5장 | |
| 느림 기준(`web_http_slow_ms`)이 시간대에 맞나 | 6장, 2장 비율 | |
| 확인 불가(`UNVERIFIED`)를 실패로 세지 않는 것이 맞았나 | 5장 | |
| 재확인(90초)으로 일시 실패가 충분히 걸러졌나 | 일시 실패 목록 | |
| 보조 확인(스텁·대기열)이 대표 판정에 들어가야 하나 | 사유·보조 확인 결과 | |
| 점검 주기를 1시간보다 줄일 필요가 있나(계획서 Q3: 관찰 뒤 10분 검토) | 장애 감지 지연이 문제였던 사례 | |
| 자체 감시(정지 알림)와 텔레그램 발송은 문제없었나 | 알림 기록, 실패·재발송 | |
| 계획 점검 창을 쓰면서 불편한 점이 있었나 | 7장 | |
| 점검 문구(`mustNotContain`)·필수 문구(`mustContain`)를 고쳐야 하나 | `MARKER_MISSING`·`MAINTENANCE_DETECTED` 사유 | |

## 9. 결론 (관찰 종료일에 적기)

- **관찰 기간 요약:** (정시 칸 합계, 가용률, 알림 수)
- **오탐·미탐 요약:**
- **조정한 값:** (3장 조정 기록 요약)
- **남은 문제와 다음 단계:** (M3 착수 전 해결할 것, 임계값 후속 확인, 문서 갱신)
- **M3 착수 판단:** 가능 / 보류(사유)

## 10. 알려진 한계 (관찰하며 계속 기억할 것)

- 단일 지점(서울 리전)·1시간 간격 관측이라 **짧은 장애는 놓칠 수 있고**, 우리 요청에 관측된 결과만 안다. 원천 서버 전체 상태·전체 이용자의 체감은 알 수 없다.
- 점검 안내 경로 예시(`maintenance_url_patterns`)는 온비드의 실제 예시를 받기 전까지 비어 있을 수 있다. 받으면 등록부에 반영한다(사용자 확인 필요).
- 응답 본문·예외 원문은 저장하지 않으므로 사후 분석은 상태·사유·시간만으로 한다.

# OnBid Ops Radar 설계서 (DESIGN)

> **기능 이름(PDCA):** onbid-ops-radar
> **기준 문서:** [PRD.md](PRD.md) → [PLAN.md](PLAN.md) → 이 문서
> **작성일:** 2026-10-29 · **단계:** Design · **상태:** 초안
> **선택한 설계 방식:** C. 실용 균형 (2장)

## Context Anchor

*PLAN.md에서 그대로 가져온 표. 설계·구현 중 "왜 만드는지"를 잊지 않기 위한 기준*

| 키 | 내용 |
|---|---|
| **WHY** | 반복 수작업 점검의 누락·지연과 흩어진 조치 이력 (PRD 1~2장) |
| **WHO** | 온비드 운영 담당자(operator), 팀장(admin), 예약 실행 주체(시스템) (PRD 4-1) |
| **RISK** | 온비드 OpenAPI 활용 승인과 명세 확정 지연, RLS·권한 설정 실수로 인한 데이터 노출 |
| **SUCCESS** | 이상 30건 전량 탐지, 정상 100건 오탐 0건, SEC-01~12 통과, 보고서 60초 이내, 배포 환경 전체 시연 |
| **SCOPE** | Must 1~3 + 공통 기반 (Nice·향후 확장·비범위 제외, PRD 5-1·6장) |

---

## 1. 설계 목표와 원칙

### 1.1 설계 목표
- DEMO 데이터만으로 "수집 → 탐지 → 확인·조치 → 일일 보고서" 전체 흐름이 동작한다.
- Next.js 하나로 화면과 서버 처리를 모두 맡고, 그대로 Vercel에 배포한다.
- 탐지 규칙은 화면·DB와 떨어진 순수한 함수로 만들어, 테스트 데이터로 바로 채점할 수 있게 한다.

### 1.2 설계 원칙
1. **권한은 두 번 검사한다:** 서버 코드에서 한 번, DB(RLS)에서 한 번. 화면에서 버튼을 숨기는 것은 편의일 뿐 보안이 아니다.
2. **업무 변경과 이력은 한 번에 저장한다:** 상태변경·배정·판정은 DB 함수 하나 안에서 이력과 함께 저장한다(같은 트랜잭션).
3. **비밀 값은 서버 밖으로 나가지 않는다:** 서버 전용 키는 서버 파일에서만 읽고, 로그·화면·오류 메시지에 남기지 않는다.
4. **공식 명세에 없는 필드는 만들지 않는다:** PUBLIC 데이터 필드는 PRD 부록 A가 확정된 뒤에만 정의한다.
5. **모든 시각은 KST로 보여 준다:** DB에는 표준시(UTC)로 저장하고, 집계·표시만 KST로 바꾼다.

---

## 2. 설계 방식 (아키텍처)

### 2.1 세 가지 안 비교

| 항목 | A. 최소 변경 | B. 깔끔한 계층 구조 | **C. 실용 균형 (선택)** |
|---|---|---|---|
| 한 줄 설명 | 화면 파일 안에 DB 처리까지 함께 씀 | 역할별로 4~5겹 층을 나눔 | 화면 · 업무 규칙 · DB 처리 세 칸으로 나눔 |
| 처음 만들기 | 가장 빠름 | 가장 느림 | 보통 |
| 고치기·테스트 | 기능이 늘수록 어려움 | 가장 쉬움 | 쉬움 (탐지 규칙은 따로 테스트) |
| 파일 수 | 적음 | 많음 | 적당함 |
| 이번 PoC 적합도 | 낮음 | 과함 | **적합** |

**C를 고른 이유:** 성공 기준의 핵심이 "탐지 규칙을 테스트 데이터로 채점"하는 것이라, 규칙만 따로 떼어 두면 충분하다. 그 이상 층을 나누는 것은 이번 규모에서 일만 늘린다.

### 2.2 구성도

```
 ┌─────────────── 브라우저 (운영 담당자 / 팀장) ───────────────┐
 │  로그인 · 대시보드 · 이상징후 · 점검 이력 · 보고서 화면      │
 └───────────────┬─────────────────────────────────────────────┘
                 │ 화면 요청 / 버튼 클릭(서버 액션)
 ┌───────────────▼──────────── Next.js (Vercel) ───────────────┐
 │ proxy.ts        : 로그인 안 된 요청을 /login으로 돌려보냄   │
 │ app/ (화면)      : 페이지와 서버 액션 (권한 1차 검사)        │
 │ lib/rules        : 탐지 규칙 3개 (순수 함수, DB·화면 모름)   │
 │ lib/checks       : 점검 실행 엔진, DEMO/PUBLIC 조회기        │
 │ lib/supabase     : DB 연결 (사용자용 / 서버 관리용 분리)     │
 │ app/api/cron/... : 예약 점검 입구 (CRON_SECRET으로 인증)    │
 └───────┬──────────────────────────────────┬─────────────────┘
         │ 조회·DB 함수 호출                 │ 읽기 전용 호출 (서버에서만)
 ┌───────▼──────── Supabase ────────┐  ┌────▼──── 공공데이터포털 ────┐
 │ Auth : 로그인                     │  │ 온비드 OpenAPI (PUBLIC)     │
 │ DB   : 테이블 + RLS (권한 2차 검사) │  └────────────────────────────┘
 │ DB 함수 : 배정·상태변경 + 이력 저장 │
 │ Cron : 매일 UTC 00:00 → 예약 점검 입구 호출 │
 └──────────────────────────────────┘
```

### 2.3 Next.js 16에서 주의할 점
- **`proxy.ts`:** 예전 `middleware`는 Next.js 16에서 `proxy`로 이름이 바뀌었다. 로그인 확인과 세션 갱신은 프로젝트 루트의 `proxy.ts`에서 한다.
- **Cache Components가 켜져 있다:** 로그인 정보(쿠키)를 읽거나 DB에서 최신 값을 가져오는 화면 조각은 `<Suspense>`로 감싸고, 사용자별 데이터에는 `"use cache"`를 쓰지 않는다.
- **서버 액션은 누구나 직접 호출할 수 있다:** 버튼을 숨겨도 요청은 보낼 수 있으므로, 서버 액션마다 로그인·역할을 다시 확인한다.
- **`connection()`으로 로그인 확인을 요청 뒤로 미룬다 (PLAN 14번에서 확인):** 로그인 확인(`getAuthState`)은 Supabase가 현재 시각(`Date.now`)을 읽기 때문에, 맨 앞에 `await connection()`을 두지 않으면 개발 서버가 "미리 만들기 중 시각을 읽었다"는 오류를 남긴다(Cache Components + `partialPrefetching`). 로그인 확인이 필요한 새 함수는 `getAuthState()`/`requireUser()`를 거쳐 쓴다.
- **proxy의 동작 (PLAN 14번에서 구현):** ① 로그인 쿠키를 `getClaims()`로 확인하고 새로 고친다(`getSession()`은 위조된 쿠키를 믿을 수 있어 쓰지 않는다). ② 로그인하지 않은 화면 요청은 `/login`으로 보내고, 첫 화면이 아니면 `?next=원래주소`를 붙인다. ③ 로그인하지 않은 `/api/…` 요청은 401(`UNAUTHENTICATED`). ④ `/api/cron/…`은 `CRON_SECRET`으로 자체 인증하므로(SEC-09, PLAN 31번) 로그인 검사에서 제외한다. ⑤ 이미 로그인한 사람이 `/login`을 열면 첫 화면으로 보낸다. ⑥ 정적 파일(`_next/static`, 이미지)은 matcher로 제외한다. proxy는 1차 확인일 뿐이며 화면과 서버 액션은 `requireUser()`로 다시 확인한다.
- **돌아갈 주소(`next`) 검사:** 우리 사이트 안의 주소(`/`로 시작, `//`·`\`·제어 문자 없음, `/login` 제외)만 허용하고 그 밖에는 첫 화면으로 보낸다(열린 리다이렉트 방지, `lib/auth/safe-next.ts`).

---

## 3. 기술 선택

Next.js를 기본으로 하고, 아래 도구를 그 위에 더한다. 굵게 표시한 도구는 이번 설계에서 새로 승인받은 것이다(2026-10-29).

| 도구 | 쉬운 설명 (한 줄) | 쓰는 곳 |
|---|---|---|
| Next.js 16 (App Router) | 화면과 서버 처리를 한 프로젝트에서 만들고 Vercel에 바로 올릴 수 있는 웹 개발 틀 | 전체 |
| TypeScript | 값의 종류(글자/숫자/날짜)를 미리 정해 두어 실수를 컴퓨터가 먼저 잡아 주는 언어 | 전체 |
| Tailwind CSS | 미리 만들어진 꾸밈 이름을 붙여 화면 모양을 빠르게 만드는 도구 | 화면 |
| Supabase Auth | 이메일·비밀번호 로그인을 대신 처리해 주는 서비스 | 로그인 |
| Supabase DB (PostgreSQL) + RLS | 데이터를 저장하는 창고와, 창고 안에서 "누가 어떤 줄을 볼 수 있는지" 정하는 출입 규칙 | 데이터 저장·권한 |
| Supabase Cron (pg_cron + pg_net) | 정해진 시각에 자동으로 우리 앱의 점검 주소를 불러 주는 알람 시계 | 매일 예약 점검 |
| **`@supabase/supabase-js`, `@supabase/ssr`** | Next.js에서 Supabase를 쓰고 로그인 상태를 유지하게 해 주는 공식 연결 도구 | DB·로그인 연결 |
| **Zod** | 화면에서 들어온 값(사유 10자 이상 등)이 규칙에 맞는지 서버에서 검사해 주는 입력값 검사 도구 | 서버 액션 |
| **Vitest** | 탐지 규칙이 맞게 동작하는지 자동으로 채점해 주는 테스트 도구 | 단위 테스트 |
| **Playwright** | 브라우저를 자동으로 열어 로그인 → 처리 → 보고서까지 눌러 보는 화면 자동 테스트 도구 | 화면·흐름 테스트 |
| pgTAP | DB 출입 규칙(RLS)이 제대로 막는지 DB 안에서 검사하는 테스트 도구 | 보안 테스트 |
| Supabase CLI · Vercel CLI | 명령어 한 줄로 DB 구조를 반영하고 배포하게 해 주는 작업 도구 (`.env` 토큰 사용) | 개발·배포 작업 |

> 위 목록 밖의 도구는 CLAUDE.md 규칙대로 사유·영향·대안을 설명하고 다시 승인받는다.

---

## 4. 화면 구성

### 4.1 화면 목록

| 주소 | 화면 | operator | admin |
|---|---|---|---|
| `/login` | 로그인 (로그인 없이 열 수 있는 유일한 화면) | 사용 | 사용 |
| `/no-access` | 사용 권한 없음 (로그인은 했지만 역할이 없는 계정이 가는 화면. 로그아웃만 가능) | — | — |
| `/` | 통합 운영 대시보드 | 보기 | 보기 |
| `/anomalies` | 이상징후 목록 | 보기 | 보기 |
| `/anomalies/[id]` | 이상징후 상세·처리 | 본인 담당 건 처리, 미배정 건 본인 배정 | 모든 건 배정·처리 |
| `/runs` | 점검 실행 이력 | 보기 | 보기 + **수동 점검 실행** |
| `/runs/[id]` | 점검 실행 상세 (API 응답 기록·실행 로그) | 보기 | 보기 |
| `/reports` | 일일 점검보고서 목록 | 보기 | 보기 + **보고서 생성** |
| `/reports/[id]` | 보고서 미리보기·Markdown 다운로드 | 보기 | 보기 |

회원가입, 비밀번호 찾기, 사용자 관리 화면은 만들지 않는다(PRD 6-3 7번).

### 4.2 공통 화면 틀 (로그인 후 모든 화면)

```
┌──────────────────────────────────────────────────────────────────┐
│ OnBid Ops Radar   대시보드 | 이상징후 | 점검 이력 | 보고서        │
│                                   [DEMO]  홍길동(팀장)  로그아웃  │
├──────────────────────────────────────────────────────────────────┤
│ ⚠ 예약 점검 누락: 오늘 09:00 점검 기록이 없습니다   (있을 때만)    │
├──────────────────────────────────────────────────────────────────┤
│                         각 화면 내용                               │
└──────────────────────────────────────────────────────────────────┘
```
- **위쪽 막대:** 앱 이름, 메뉴 4개, 데이터 출처 배지(DEMO/PUBLIC), 사용자 이름과 역할, 로그아웃
- **경고 띠:** 예약 점검 누락(PRD 5-2 규칙 11)이 있을 때만 보인다.
- **좁은 화면(모바일):** 메뉴가 접히고, 표는 카드 목록으로 바뀐다(데스크톱 우선 반응형).

**구현 내용 (PLAN 15번에서 만듦)**
- **파일:** `app/(app)/layout.tsx`(틀), `components/app-header.tsx`(위쪽 막대), `components/main-nav.tsx`(메뉴, 브라우저 쪽), `components/coming-soon.tsx`(아직 안 만든 화면의 임시 자리). `(app)`은 주소에 나타나지 않는 폴더 묶음이다. `/login`·`/no-access`는 이 틀 밖(`AuthShell`)에 있다.
- **메뉴:** 대시보드(`/`)·이상징후(`/anomalies`)·점검 이력(`/runs`)·보고서(`/reports`) 4개. 두 역할이 같은 메뉴를 본다(역할별 차이는 화면 안의 버튼 — 수동 점검, 보고서 생성, 배정 — 에서 생긴다). 지금 화면의 메뉴는 `aria-current="page"`로 강조되고, `/anomalies/12`처럼 아래 주소도 같은 메뉴로 본다.
- **출처 배지:** 설정값 `scheduled_source`(예약 점검이 조회하는 출처)를 읽어 `DEMO`(노란색)/`PUBLIC`(파란색)로 보여 준다. 읽지 못하거나 알 수 없는 값이면 `출처 확인 불가`(회색)로 보이고, DEMO로 짐작해서 보여 주지 않는다. 화면 안의 목록·보고서는 각자의 출처를 따로 표시한다(PRD 4-6).
- **모바일:** 가로 메뉴가 숨고 `[메뉴]` 버튼(`<details>`) 안에 메뉴 4개·사용자 이름·역할·로그아웃이 들어간다. 다른 화면으로 이동하면 메뉴가 저절로 닫힌다(`key`에 현재 주소). 출처 배지는 좁은 화면에서도 보인다. 가로 스크롤은 생기지 않는다.
- **접근성:** `Tab` 첫 번째 포커스는 "본문으로 건너뛰기" 링크이고, 메뉴는 `nav` 이름(`주 메뉴`)과 `aria-current`를 갖는다.
- **쪽 제목:** `<title>`은 `화면 이름 · OnBid Ops Radar` 형식이다(루트 레이아웃의 `title.template`).
- **임시 화면:** 이상징후(PLAN 25번)·점검 이력(24번)·보고서(30번)·대시보드(29번)는 만들기 전까지 `ComingSoonPage`가 "PLAN n번에서 만들어진다"고 알려 준다. 진짜 화면으로 바꿀 때 이 컴포넌트를 쓰는 줄만 바꾸면 된다. 임시 화면도 `requireUser()`로 로그인·역할을 직접 확인한다(레이아웃은 화면을 옮겨 다닐 때 다시 확인되지 않는다).
- **경고 띠 자리:** 레이아웃에 자리만 있고 내용은 PLAN 32번(예약 누락 감지)에서 채운다.
- **로그인 화면의 폼 (PLAN 15번 검증 중 고침):** `?next=…`를 읽을 때 폼 전체를 `<Suspense>`로 감싸면 처음 그린 폼이 다른 폼으로 통째로 교체되어 그 사이에 입력한 값이 사라진다. 그래서 폼은 항상 같은 폼으로 두고, 숨은 `next` 칸만 `<Suspense>`로 감싼다(`components/login-form.tsx`). 덕분에 `/login`은 완전히 미리 만들어지는 정적 화면이다.

### 4.3 대시보드 `/`

```
┌─ 오늘(KST) 점검 ───────────────┬─ 현재 처리 현황 (누적) ────────┐
│ [API 점검 성공 18] [실패 2]    │ [미배정 5] [미처리 12]          │
├─ 규칙별 신규 이상징후 ────────┬─ 최근 점검 실행 ───────────────┤
│ 날짜 정합성      3            │ 09:00 예약  완료   2분 전       │
│ 필수정보         1            │ 08:41 수동  부분완료 (상한 도달)│
│ 목록·상세 정합성 2            │ 어제 09:00 예약 완료             │
└───────────────────────────────┴─────────────────────────────────┘
  기준: 2026-10-29 00:00~24:00 KST · 출처: DEMO · 점검 기준 시각 09:00:12
```
- 숫자 카드를 누르면 해당 조건으로 걸러진 이상징후 목록으로 이동한다.
- 점검 성공·실패와 규칙별 신규 건수는 오늘(KST) 기준, 미배정·미처리는 날짜와 관계없는 현재 건수다. 미처리 = `open` + `investigating`, 미배정 = 미처리 중 담당자 없음 (PRD 5-6)
- 점검 기준 시각은 오늘 마지막으로 성공한 실행의 수집 시각이다.

### 4.4 이상징후 목록 `/anomalies`

```
[미확인] [내 담당] [전체]        상태: 전체 ▾   규칙: 전체 ▾
┌────┬──────────────┬─────────────┬──────┬────────┬──────┬──────────┐
│ ID │ 물건 식별값   │ 규칙        │ 상태 │ 판정   │ 담당 │ 최근 탐지 │
├────┼──────────────┼─────────────┼──────┼────────┼──────┼──────────┤
│ 41 │ DEMO-0012    │ 날짜 정합성 │ 미확인│ 미판정 │  -   │ 09:00 (3회)│
└────┴──────────────┴─────────────┴──────┴────────┴──────┴──────────┘
```
- 기본 탭: operator는 "미확인", admin은 "전체"
- operator도 남의 담당 건을 볼 수 있다(조회 허용). 남의 담당 건의 상태변경·판정·배정만 막는다(PRD SEC-08).
- 재발 건은 "재발" 표시와 함께 이전 건으로 가는 링크를 단다.

### 4.5 이상징후 상세 `/anomalies/[id]`

```
┌─ #41 날짜 정합성 · DEMO-0012 ─────────── 상태: 검토 중 · 판정: 미판정 ┐
│ 탐지 근거: 입찰종료일시(10-01 10:00)가 입찰시작일시(10-02 10:00)보다 빠름 │
│ 처음 탐지 10-28 09:00 · 최근 탐지 10-29 09:00 · 누적 2회                  │
├─ 원본 데이터 (저장 허용 필드만) ────────────────────────────────────────┤
│ { ... }                                                                  │
├─ 처리 ──────────────────────────────────────────────────────────────────┤
│ 담당자: 김담당  [나에게 배정] / [담당자 지정 ▾](팀장)                     │
│ 판정: (●미판정 ○실제 오류 ○정상·오탐)   [판정 저장]                       │
│ 다음 상태: [검토 시작] [조치 완료] [정상 판정] [검토 재개]  사유: [______] │
├─ 이벤트 이력 ───────────────────────────────────────────────────────────┤
│ 10-29 09:12 김담당  상태 open → investigating                           │
│ 10-29 09:10 김담당  담당자 (없음) → 김담당                               │
│ 10-28 09:00 시스템  이상징후 생성                                         │
└──────────────────────────────────────────────────────────────────────────┘
```
- 버튼은 지금 상태에서 허용된 전이만 보여 준다(PRD 5-3 규칙 1). 그래도 최종 판단은 서버와 DB가 한다.
  - [검토 시작]: `open`일 때, 담당자 본인 또는 admin
  - [조치 완료]·[정상 판정]: `investigating`일 때, 판정 짝과 사유 10자 이상 필요
  - [검토 재개]: `resolved`/`dismissed`일 때. 재개하면 판정이 `undetermined`로 돌아간다. 같은 건의 열린 재발 건이 있으면 "이미 열린 건(#번호)이 있습니다"라고 안내하고 그 건으로 가는 링크를 보여 준다.
- 배정은 상태를 바꾸지 않는다. 배정 후 [검토 시작]을 따로 누른다(PRD 4-2).
- 다른 사람이 먼저 바꿨으면 "다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요."를 띄운다.

### 4.6 점검 실행 이력 `/runs`, `/runs/[id]`
- **목록:** 실행 시각, 예약/수동, 출처, 결과(완료·부분완료·실패·중복 실행 차단), API 호출 수, 신규 이상징후 수
- **팀장만:** 맨 위에 출처 선택(DEMO/PUBLIC)과 [수동 점검 실행] 버튼. 실행 중이면 버튼이 잠기고 "이미 점검이 실행 중"을 보여 준다. PUBLIC은 U23 완료 후에만 고를 수 있다.
- **상세:** API 호출별 응답시간·HTTP 상태·결과 구분(성공/HTTP 오류/타임아웃/서비스키·한도 문제/빈 결과)·데이터 유효 여부, 비교 제외 사유와 실행 로그

### 4.7 보고서 `/reports`, `/reports/[id]`
- **목록:** 보고서 날짜, 출처, 생성 시각, 생성자. 같은 날 여러 번 만들면 모두 남는다.
- **팀장만:** 날짜 선택(기본 오늘)과 출처 선택(DEMO/PUBLIC), [보고서 생성] 버튼. 보고서는 출처별로 따로 만든다.
- **미리보기:** PRD 5-4 항목(점검 성공·실패, 검증 건수, 신규 이상징후·유형별 분포, 처리 현황, 주요 미처리 최대 10건), 데이터 출처, 점검 기준 시각(그날 마지막 성공 실행의 수집 시각), 보고서 생성 시각
- 오늘 보고서에는 "생성 시각까지 집계"라고 표시한다.
- [Markdown 다운로드] 버튼

---

## 5. 데이터 흐름 (입력 → 처리 → 출력)

### 5.1 흐름 ① 자동·수동 점검

| 단계 | 입력 | 처리 | 출력 |
|---|---|---|---|
| 1. 시작 | Supabase Cron(매일 UTC 00:00) 또는 팀장의 [수동 점검 실행] | 예약이면 `CRON_SECRET` 확인 후 설정값 `scheduled_source`(기본 DEMO)를, 수동이면 로그인·admin 확인 후 팀장이 고른 출처를 쓴다. 시작 후 120초가 지난 `running` 실행은 실패(시간 초과)로 먼저 마감한다. 실행 중인 점검이 있으면 시작하지 않음 | `check_runs` 1줄 (`running`) 또는 `blocked`(중복 실행 차단) 1줄 |
| 2. 조회 | 출처(DEMO/PUBLIC), 설정값(타임아웃 10초, 상한 20회) | 조회기가 `https://`로 허용된 호스트만 호출하고 응답시간·결과를 잰다. 서비스키·한도 오류는 따로 구분. PUBLIC이면 오늘(KST) `api_checks` 건수를 합산해 일일 예산을 넘으면 호출하지 않고 로그를 남긴다 | `api_checks` 기록 |
| 3. 정리 | API 응답 원본 | 허용된 필드만 골라 담고 개인정보 필드는 버림 | `collected_items` 기록 |
| 4. 탐지 | 정리된 목록·상세 데이터 | 규칙 3개 실행(순수 함수). 수집 시각 차이 10분 초과면 비교 제외 사유 기록 | 탐지 결과 목록 |
| 5. 등록 | 탐지 결과 (빈 결과를 허용하지 않는 API의 0건은 `EMPTY_RESULT`, 식별값은 API 이름) | ① 같은 출처·물건·규칙의 열린 건이 있으면 그 건의 횟수·최근 탐지시각만 갱신 ② 없고, 가장 최근 종결 건이 `dismissed`이며 `value_hash`가 같으면 그 건의 `detect_count`·`last_detected_at`만 갱신 ③ 그 밖(`resolved`, 값이 바뀐 `dismissed`, 처음 탐지)은 새 건 생성, 종결 건이 있으면 `previous_anomaly_id`로 연결 | `anomalies`, `anomaly_events` |
| 6. 마감 | 실행 결과 | 60초·호출 상한에 걸린 작업은 로그로 남기고 상태 확정 | `check_runs` 상태(`succeeded`/`partial`/`failed`), 대시보드 반영 |

> 서비스키·한도 문제가 생긴 실행에서는 4~5단계를 건너뛰어 데이터 이상징후를 만들지 않는다(PRD 5-2 규칙 6).

**예약 호출 방식**
- Supabase Cron은 pg_net으로 `POST /api/cron/daily-check`를 부르고, `CRON_SECRET`을 헤더에 담는다.
- `CRON_SECRET`은 Supabase Vault에 보관하고, Cron SQL은 Vault에서 읽는다. 마이그레이션 파일에는 값을 넣지 않는다.
- 예약 입구는 점검이 끝날 때까지(최대 60초) 처리한 뒤 응답한다. pg_net 요청 대기시간은 90초로 설정한다. 응답을 받지 못해도 결과는 `check_runs`에 남으므로 판단은 DB 기록으로 한다.

### 5.2 흐름 ② 담당자의 확인·조치

```
[화면] 버튼 클릭 + 사유 입력 + 화면이 본 버전 번호
   → [서버 액션] 로그인 확인 → Zod로 입력 검사(사유 공백 제외 10자 이상 등)
   → [DB 함수] RLS로 권한 확인 → 버전 비교 → 허용 전이·판정 짝 확인
              → anomalies 변경 + anomaly_events 1줄 추가 (같은 트랜잭션)
   → [화면] 성공이면 새 상태와 이력 표시 / 실패면 이유를 한국어로 표시
```

### 5.3 흐름 ③ 일일 점검보고서

```
[화면] 팀장이 날짜(기본 오늘)와 출처를 고르고 [보고서 생성] 클릭
   → [서버 액션] 로그인·admin 확인, Zod로 날짜·출처 검사
   → [집계] 고른 날짜의 KST 00:00~24:00(오늘이면 생성 시각까지), 고른 출처만 DB에서 직접 계산 (LLM 사용 안 함)
   → [작성] Markdown 문서 생성 (출처·점검 기준 시각·생성 시각 포함)
   → [저장] reports에 스냅샷 1줄 추가 (수정하지 않음)
   → [화면] 미리보기 → [Markdown 다운로드]
```
- 목표: 버튼을 누르고 60초 이내에 미리보기가 뜬다.

### 5.4 흐름 ④ 예약 누락 감지
- Supabase Cron에 UTC 00:30(KST 09:30) 작업을 하나 더 둔다. 이 작업이 DB 함수 `mark_schedule_missed()`를 불러, 오늘 날짜의 예약 실행 기록(`blocked` 포함)이 없으면 `run_logs`에 누락 기록 1줄을 추가한다. 날짜당 1건만 남도록 DB 제약을 건다.
- 대시보드와 공통 경고 띠는 이 기록을 **읽기만** 한다. 화면을 그리는 동안에는 아무것도 기록하지 않는다.

---

## 6. 데이터 구조 (DB)

### 6.1 테이블

| 테이블 | 담는 것 | 주요 칸 |
|---|---|---|
| `profiles` | 사용자 이름과 역할 | `id`(로그인 계정과 같음), `display_name`, `role`(`operator`/`admin`) |
| `settings` | PRD 5-5 설정값과 탐지 설정 (정해진 14개 항목, 기본값이 들어 있음) | `key`, `value`(JSON), `updated_at`. 키 14개: `compare_window_minutes`, `api_timeout_seconds`, `api_call_limit_default`, `api_call_limit_max`, `public_daily_budget`, `run_time_limit_seconds`, `reason_min_length`, `schedule_missed_grace_minutes`, `stale_running_seconds`, `scheduled_source`, `required_fields`, `compare_fields`, `excluded_fields`, `empty_allowed_by_endpoint` (DEMO 값은 PRD 부록 B) |
| `check_runs` | 점검 실행 1회 | `trigger`(`scheduled`/`manual`), `source`, `status`(`running`/`succeeded`/`partial`/`failed`/`blocked`), `started_at`, `finished_at`, `api_call_count`, `triggered_by` |
| `run_logs` | 실행 중 남길 메모 | `run_id`(비울 수 있음), `log_date`(KST 날짜), `level`, `code`(상한 도달, 시간 초과, 비교 제외, 일일 예산 초과, 예약 누락 등), `message` |
| `api_checks` | API 호출 1번의 결과 | `run_id`, `endpoint_name`(키 없는 이름), `http_status`, `duration_ms`, `outcome`(`success`/`http_error`/`timeout`/`auth_or_quota`/`empty_result`), `record_count`, `data_valid` |
| `collected_items` | 정리된 수집 데이터 | `run_id`, `source`, `item_key`, `kind`(`list`/`detail`), `fields`(허용 필드만), `collected_at` |
| `anomalies` | 이상징후 1건 | `source`, `item_key`, `rule_id`, `status`(기본 `open`), `verdict`(기본 `undetermined`), `assignee_id`, `version`, `evidence`, `value_hash`, `detect_count`, `first_detected_at`, `last_detected_at`, `previous_anomaly_id` |
| `anomaly_events` | 이상징후 이력 (추가만 가능) | `anomaly_id`, `actor_type`(`user`/`system`), `actor_id`, `actor_role`(행동 당시의 역할 `operator`/`admin`), `event_type`(`created`/`detected_again`/`assigned`/`status_changed`/`verdict_changed`), `from_value`, `to_value`, `note`, `created_at` |
| `reports` | 보고서 스냅샷 (추가만 가능) | `report_date`(고른 날짜), `source`(출처별 1개), `generated_by`, `generated_at`, `covers_until`(오늘 보고서면 생성 시각), `content_md`, `summary` |

- **설정값 검증:** `settings`는 14개 항목만 둘 수 있고, 항목마다 값의 모양과 범위를 DB가 검사한다(예: 호출 상한 1~100, 타임아웃 1~60초, 출처는 `DEMO`/`PUBLIC`). 항목 이름은 바꾸거나 지울 수 없다(값만 바꿀 수 있음). `public_daily_budget`은 승인 트래픽 확인 전까지 JSON `null`이다.
- **설정값 사이의 관계는 서버가 확인한다:** DB는 항목 하나씩만 검사하므로, "호출 기본 상한 ≤ 최대 상한", "멈춘 실행 정리 기준(`stale_running_seconds`) > 점검 실행시간 제한(`run_time_limit_seconds`)"은 `lib/settings.ts`(PLAN 16번)가 값을 읽을 때·바꿀 때 함께 확인한다.
- **사유 최소 글자 수:** `reason_min_length`는 10 이상으로만 올릴 수 있다. `anomaly_events`의 DB 제약이 공백 제외 10자 미만을 항상 거부하므로 10 아래로는 내릴 수 없다.
- **보고서 날짜·집계 시각:** `reports.report_date`는 KST 날짜이고 아직 오지 않은 날짜는 저장할 수 없다. `covers_until`은 그 날짜(KST 00:00~다음 날 00:00) 안에 있어야 하고 `generated_at`을 넘을 수 없다.
- **보고서는 서버가 팀장 확인 후 추가한다:** 로그인 사용자에게는 `reports`의 읽기만 주고, 서버 관리용 키(`service_role`)에게 읽기와 추가(INSERT)만 준다(수정·삭제·비우기 권한 없음). 서버 액션 `generateDailyReport`가 먼저 admin 역할을 확인하고, DB 트리거가 `generated_by`가 admin 역할인지 한 번 더 확인한다(SEC-03). 로그인 사용자가 API로 직접 보고서를 만들 수는 없다(보고서 내용을 위조할 수 없게 하려는 것이다).
- **보고서를 만든 사용자 보호:** 보고서를 만든 사용자는 지울 수 없다(연결). 이력을 남긴 사용자와 같은 방식이다.
- **중복 방지:** `anomalies`에 "출처 + 물건 + 규칙"이 같고 상태가 `open`/`investigating`인 건은 하나만 있도록 DB 제약을 건다.
- **상태·판정 짝:** `anomalies`는 `open`이면 반드시 `undetermined`, `resolved`이면 반드시 `confirmed_issue`, `dismissed`이면 반드시 `false_positive`여야 한다. `investigating`은 어느 판정이든 가능하다(판정만 따로 바꿀 수 있으므로). DB 제약이 강제한다(PRD 5-3 규칙 2·4).
- **재발 연결:** `previous_anomaly_id`는 같은 출처·물건·규칙의 이상징후만 가리킬 수 있다(복합 연결). 가리키는 건이 "종결(`resolved`/`dismissed`)된 건인지"는 `record_detection` 함수(PLAN 23번)가 확인한다.
- **식별 정보 보호:** 한번 저장된 `anomalies`의 `source`·`item_key`·`rule_id`·`first_detected_at`·`previous_anomaly_id`는 바꿀 수 없다(트리거). 같은 줄을 다른 물건의 이상징후로 바꿔치기하는 것을 막는다.
- **규칙 ID 제한:** `rule_id`는 `DATE_ORDER`·`REQUIRED_FIELD`·`LIST_DETAIL_MISMATCH`·`EMPTY_RESULT` 네 가지만 저장할 수 있다. 새 규칙은 마이그레이션으로만 추가한다(PRD 6-3 범위 밖 규칙 차단).
- **동시 실행 방지:** `check_runs`에서 `status = 'running'`인 줄은 동시에 하나만 있도록 DB 제약을 건다. 차단된 시도는 `blocked` 줄로 남는다.
- **예약 누락 기록:** `run_logs`에서 `code = 'SCHEDULE_MISSED'`인 줄은 `log_date`당 하나만 있도록 DB 제약을 건다.
- **`value_hash`:** 탐지 대상 값으로 만든 지문. `dismissed` 건과 같은 값인지 비교할 때 쓴다(PRD 5-2 규칙 9).
- **탐지 규칙 ID:** `DATE_ORDER`, `REQUIRED_FIELD`, `LIST_DETAIL_MISMATCH`, 그리고 API 상태 이상징후 `EMPTY_RESULT`(`item_key`는 API 이름).
- **DEMO 필드:** PRD 부록 B의 가상 스키마(`demo_item_id`, `item_name`, `org_name`, `bid_start_at`, `bid_end_at`, `item_status`)를 쓴다. `item_key` = `demo_item_id`.
- **출처 일치:** `collected_items.source`는 항상 연결된 점검 실행(`check_runs.source`)의 출처와 같다. DB가 복합 연결 `(run_id, source)`로 강제하므로 DEMO와 PUBLIC이 섞여 저장될 수 없다. (이를 위해 `check_runs`에 `(id, source)` 유일 제약을 둔다.)
- **허용 필드:** DEMO 수집 데이터는 부록 B의 6개 필드 이름만 저장할 수 있다. DB 제약이 그 밖의 이름을 거부한다(PRD 7-2). 값이 비었거나 형식이 틀린 원본 이상 데이터는 탐지 규칙이 찾아야 하므로 저장할 수 있다. PUBLIC의 허용 필드 목록은 부록 A 확정 후 별도 마이그레이션으로 추가한다.
- **PUBLIC 필드:** `item_key`와 `fields`에 들어갈 실제 필드명은 PRD 부록 A 확정 후 정하고, 부록 B와의 대응표를 만든다.
- **설정값 변경:** 화면은 없다. 마이그레이션이나 관리 스크립트로만 바꾸며, 서버가 범위(예: 호출 상한 1~100회)를 검증한다.

### 6.2 관계

```
profiles 1 ─── N anomalies(담당자)        check_runs 1 ─── N api_checks
profiles 1 ─── N anomaly_events(행위자)   check_runs 1 ─── N collected_items
anomalies 1 ─── N anomaly_events          check_runs 1 ─── N run_logs
anomalies 1 ─── 0..1 anomalies(이전 사례, 재발 연결)
```

### 6.3 DB 함수 (트랜잭션으로 묶어 처리)

| 함수 | 하는 일 | 호출자 | 만드는 PLAN 작업 |
|---|---|---|---|
| `start_check_run(trigger, source)` | 120초 지난 `running`을 실패로 마감한 뒤, 실행 중 건이 없으면 시작, 있으면 `blocked` 1줄 기록 | 시스템 | 22 |
| `record_detection(...)` | 5.1의 5단계 ①②③ 규칙으로 이상징후 생성 또는 횟수 갱신, 이력 추가 | 시스템(서버 관리용 연결) | 23 |
| `assign_anomaly(id, assignee, expected_version)` | 미배정일 때만 본인 배정(operator) / 지정·재배정(admin), 이력 추가. 상태는 바꾸지 않음 | 사용자 | 26 |
| `set_verdict(id, verdict, expected_version)` | `investigating`에서 판정만 변경, 이력 추가 | 사용자 | 27 |
| `change_anomaly_status(id, to_status, verdict, note, expected_version)` | 허용 전이·판정 짝·10자 규칙 확인 후 상태 변경, 이력 추가 | 사용자 | 27 |
| `mark_schedule_missed()` | 오늘 예약 실행 기록이 없으면 누락 기록 1줄 추가 | 시스템(Cron) | 32 |

**`change_anomaly_status` 세부 규칙**
- 판정이 함께 바뀌면 이력을 2줄(판정 변경 1줄, 상태 변경 1줄) 남긴다.
- 재개(`resolved`/`dismissed` → `investigating`)하면 판정을 `undetermined`로 되돌리고, 이전 판정 값은 이력에 남긴다.
- 재개할 때 같은 출처·물건·규칙의 열린 건이 이미 있으면 `ACTIVE_DUPLICATE_EXISTS`로 거부하고, 그 건의 ID를 돌려준다.

- 사용자 함수는 사용자 로그인 정보로 실행되어 RLS가 그대로 적용된다(PRD 7-3 규칙 10).
- `anomaly_events`, `reports`에는 수정·삭제 권한을 아무에게도 주지 않는다(SEC-05).
- `anomaly_events`는 서버 관리용 키(`service_role`)에게도 읽기만 준다. 이력 줄을 **추가**하는 DB 함수(`record_detection`·`assign_anomaly`·`set_verdict`·`change_anomaly_status`)는 소유자 권한(`SECURITY DEFINER`, `set search_path = ''`)으로 실행하되, 함수 안에서 `auth.uid()`와 역할을 직접 확인한다. 그 밖에 소유자 권한으로도 수정·삭제·비우기가 되지 않도록 트리거가 막는다.
- **이력 규칙의 DB 강제:** 이벤트 종류별로 "무엇에서 무엇으로"의 모양이 맞아야 하고(허용된 상태 전이만), 조치 완료·정상 판정·검토 재개 이력에는 공백 제외 10자 이상의 사유가 있어야 한다. 시스템은 `created`·`detected_again`만, 사용자는 `assigned`·`status_changed`·`verdict_changed`만 남길 수 있다. 이력이 있는 이상징후와 사용자는 삭제할 수 없다.

### 6.4 RLS (DB 출입 규칙) 요약

| 테이블 | 읽기 | 쓰기 |
|---|---|---|
| `profiles` | 로그인 사용자 | 본인 역할 변경 불가, 관리 절차로만 (SEC-07) |
| `check_runs`, `api_checks`, `run_logs`, `collected_items` | 로그인 사용자 | 시스템만 |
| `anomalies` | 로그인 사용자 | DB 함수로만 (직접 수정 차단) |
| `anomaly_events` | 로그인 사용자 | DB 함수로만 추가, 수정·삭제 불가 |
| `reports` | 로그인 사용자 | 서버가 admin 확인 후 추가만(관리용 키), 로그인 사용자의 직접 쓰기 불가, 수정·삭제 불가 |
| `settings` | 로그인 사용자 | 시스템만 (값만 변경, 항목 삭제·이름 변경 불가) |

---

## 7. 서버 입구 (API)

| 종류 | 이름 | 하는 일 | 권한 |
|---|---|---|---|
| 서버 액션 | `signIn` / `signOut` | 로그인·로그아웃 | 누구나 / 로그인 |
| 서버 액션 | `assignAnomaly` | 배정 | operator(미배정 건 본인) / admin |
| 서버 액션 | `setVerdict` | 판정 변경 | 담당 operator / admin |
| 서버 액션 | `changeAnomalyStatus` | 상태 변경 | 담당 operator / admin |
| 서버 액션 | `runManualCheck(source)` | 수동 점검 실행 | admin |
| 서버 액션 | `generateDailyReport(date, source)` | 보고서 생성 | admin |
| Route Handler | `POST /api/cron/daily-check` | 예약 점검 입구 | `CRON_SECRET` 헤더 (SEC-09) |
| Route Handler | `GET /api/reports/[id]/download` | Markdown 파일 내려받기 | 로그인 사용자 |

**서버 액션 응답 모양**
```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string } // message는 한국어 안내문
```

---

## 8. 오류 처리

| 코드 | 언제 | 사용자에게 보여 줄 말 |
|---|---|---|
| `UNAUTHENTICATED` | 로그인 안 됨 | 로그인 화면으로 이동 |
| `FORBIDDEN` | 역할·담당자가 아님 | "이 작업을 할 권한이 없습니다." |
| `VALIDATION_FAILED` | 입력값 규칙 위반 | "사유는 공백을 빼고 10자 이상 입력해 주세요." 등 |
| `INVALID_TRANSITION` | 허용되지 않은 상태 변경 | "지금 상태에서는 할 수 없는 변경입니다." |
| `VERSION_CONFLICT` | 그사이 다른 사람이 변경 | "다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요." |
| `ALREADY_ASSIGNED` | 이미 배정된 건에 자율 배정 | "이미 다른 담당자가 배정된 건입니다." |
| `ACTIVE_DUPLICATE_EXISTS` | 재개하려는데 같은 건의 열린 재발 건이 있음 | "이미 열린 건(#번호)이 있습니다. 그 건에서 처리해 주세요." |
| `RUN_IN_PROGRESS` | 점검 중복 실행 | "이미 점검이 실행 중입니다." |
| `NOT_FOUND` | 없는 건 | "해당 항목을 찾을 수 없습니다." |
| `INTERNAL` | 그 밖의 오류 | "처리 중 문제가 발생했습니다." (내부 정보·키는 절대 포함하지 않음, SEC-11) |

- 외부 API 요청 주소를 로그에 남길 때는 `serviceKey=****`로 가린다(PRD 7-3 규칙 6).

---

## 9. 보안 설계 요약

| 위협 | 막는 방법 | 확인 테스트 |
|---|---|---|
| 로그인 없이 접근 | `proxy.ts` 차단 + 서버 액션 재확인 + RLS | SEC-01 |
| 다른 사람 건 상태변경·판정·배정 (조회는 허용) | 서버 액션 확인 + DB 함수·RLS | SEC-02, SEC-08 |
| operator가 팀장 기능 사용 | 서버 액션 역할 확인 + RLS | SEC-03 |
| 화면을 거치지 않고 DB 직접 호출 | RLS, 직접 수정 차단 | SEC-04 |
| 이력 조작 | 이력 테이블 수정·삭제 권한 없음 | SEC-05 |
| 비밀키가 브라우저로 새어 나감 | 서버 관리용 연결은 서버 파일에서만, 빌드 결과물 검사 | SEC-06 |
| 본인 역할 올리기 | `profiles.role` 변경 차단 | SEC-07 |
| 공개 회원가입으로 누구나 계정을 만들어 데이터를 읽음 | Supabase Auth의 회원가입(Allow new users to sign up)을 꺼 둔다(대시보드 설정, 사용자가 직접). 계정은 `npm run setup:accounts`(서버 관리 절차)로만 만든다. `check:accounts`가 설정과 계정 개수를 확인한다. 추가 방어로 읽기 정책을 "프로필이 있는 사용자"로 좁히는 안은 별도 작업으로 검토한다 | `check:accounts`, SEC-01 |
| 예약 점검 입구 무단 호출 | `CRON_SECRET` 확인 | SEC-09 |
| 로그·보고서에 키·개인정보 | 마스킹, 허용 필드만 저장 | SEC-10 |
| 오류에 내부 정보 노출 | `INTERNAL` 공통 문구 | SEC-11 |
| 변경과 이력 중 하나만 저장 | DB 함수 트랜잭션 | SEC-12 |
| 허용되지 않은 곳으로 요청 | 조회기는 `https://`와 허용 호스트 목록만 호출 (PRD 7-6) | 단위 테스트 |
| Cron 비밀값이 저장소에 노출 | `CRON_SECRET`은 Supabase Vault에 보관, 마이그레이션에 값 금지 | 저장소 전체 키 검사 |
| 수동 점검에서 서버 관리용 키 사용 | 서버 액션에서 사용자 권한으로 admin 확인 후에만 관리용 연결 사용 (PRD 7-3 규칙 9) | SEC-03 |

---

## 10. 테스트 계획

| 수준 | 도구 | 무엇을 | 성공 기준 연결 |
|---|---|---|---|
| 단위 | Vitest | 탐지 규칙 3개를 DEMO 시나리오(이상 30·정상 100·경계 30)로 채점, 설정값·KST 계산 | PLAN 기준 3, 4 |
| 점검 엔진 | Vitest | 타임아웃 10초, 호출 상한 20/100회, 60초 제한, 서비스키·한도 오류 시 탐지 생략, 0건 처리(`EMPTY_RESULT`), 일일 예산, 허용 호스트·HTTPS | PLAN 기준 11 / PRD 5-2 규칙 4~7 |
| DB | pgTAP | RLS, 이력 수정·삭제 차단, 역할 변경 차단, DB 함수의 전이·버전·트랜잭션, `record_detection`의 중복·재발·억제, `start_check_run`의 동시 실행·멈춘 실행 정리, `mark_schedule_missed` 날짜당 1건 | SEC-04, 05, 07, 12 / 기준 5 / PRD 5-2 규칙 8~11 |
| 서버 입구 | Vitest | 예약 점검 입구의 `CRON_SECRET` 확인, 오류 응답에 내부 정보 없음 | SEC-09, 11 |
| 화면 동작 | Playwright | 로그인·로그아웃, 배정, 상태변경 20건 시나리오, 권한 없는 버튼·주소 차단 (로그인·비로그인 차단 16개는 `tests/e2e/login.spec.ts`로 구현, PLAN 14번) | SEC-01~03, 08 / 기준 5 |
| 전체 흐름 | Playwright | 수동 점검 → 탐지 확인 → 배정 → 조치 완료 → 보고서 생성(10회, 60초 이내) → 다운로드 | 기준 6, 10 |
| 산출물 | 스크립트 | 빌드 결과물과 Git 추적 파일 전체에서 비밀키 패턴 검색, 로그·보고서의 키·개인정보 검색, DEMO 데이터의 개인정보 패턴 검색 | SEC-06, 10 / PRD 7-7 |

**화면 테스트(Playwright) 실행 방법 (PLAN 14번에서 정함)**
- **명령:** `npm run test:e2e` (설정 `playwright.config.ts`, 시험 파일 `tests/e2e/*.spec.ts`). 개발 서버를 테스트 전용 포트 **3100**으로 자동으로 띄운다(이미 떠 있으면 그것을 쓴다). 다른 프로그램이 흔히 쓰는 3000번을 피하기 위해서다.
- **브라우저:** 컴퓨터에 설치된 Microsoft Edge(`channel: "msedge"`)를 쓴다. Playwright 전용 브라우저를 따로 내려받지 않는다.
- **로그인 정보:** 시연 계정의 이메일·비밀번호를 `.env`의 `DEMO_*`에서 읽어 입력창에만 넣고 출력하지 않는다. 임시 계정이 필요한 시험은 시험 안에서 만들고 끝나면 반드시 지운다(`try/finally`).
- **현재 시험(27개):** `login.spec.ts`(로그인·비로그인 차단 16개), `frame.spec.ts`(공통 화면 틀 11개: 메뉴·강조·출처 배지·모바일 메뉴·키보드·가로 넘침·로그인 뒤 원래 화면으로 돌아오기). 공용 도우미는 `tests/e2e/helpers.ts`.
- **로그인 횟수 주의:** 한 번 돌릴 때 로그인을 약 20번 한다. Supabase의 기본 제한(같은 IP에서 로그인·가입 5분에 약 30회)이 있으니, 5분 안에 연달아 두 번 돌리면 실패할 수 있다. 실패하면 5분쯤 기다렸다 다시 돌린다.
- **프로덕션 방식 확인:** 배포와 같은 방식으로도 확인하려면 `npm run build` 후 `npx next start -p 3100`을 먼저 띄워 두고 `npm run test:e2e`를 돌린다(이미 떠 있는 서버를 그대로 쓴다).

**DB 테스트(pgTAP) 실행 방법과 범위 (PLAN 12번에서 정함)**
- **위치·명령:** `supabase/tests/database/*.test.sql`, 실행은 `npm run test:db` (내부에서 `supabase test db --linked`). 연결된 Supabase 프로젝트(원격 DB)에 대해 돌고, 테스트 실행기(pg_prove)가 Docker로 돌기 때문에 Docker Desktop이 켜져 있어야 한다. 로컬 DB를 따로 띄우지 않는다.
- **DB에 아무것도 남기지 않는다:** 파일마다 `begin … rollback` 안에서 pgTAP 확장과 시험용 계정을 만들고 전부 되돌린다. 시험 후 pgTAP도 DB에 설치된 채로 남지 않는다.
- **역할을 바꿔 가며 시험한다:** 도우미 함수가 `anon`·`authenticated`(JWT 사용자 ID 포함)·`service_role`·소유자 권한으로 바꿔 SQL을 실행해 보고 성공 여부나 오류 코드(`42501` 권한 없음, `23000` 변경 금지 장치)를 돌려준다.
- **현재 파일(129개 시험):** `00_rls_guard`(모든 테이블에 RLS, anon·authenticated의 권한, 쓰기 정책 없음 — 새 테이블에도 계속 적용), `01_sec07_role_protection`(역할 변경 불가, SEC-07), `02_sec05_append_only`(이력·보고서 수정·삭제·비우기 불가, SEC-05), `03_sec04_direct_access`(public의 모든 테이블에 대해 직접 접근 차단, SEC-04 — 테이블이 늘어나면 자동으로 시험 대상에 포함된다).
- **테스트가 정말 잡는지 확인했다:** 일부러 보안 구멍 7가지(RLS 없는 테이블, 쓰기 정책 추가, anon의 함수 실행 권한, 사용자의 역할 수정 권한, 이력 보호 트리거 삭제, 서버 키의 보고서 수정 권한, 사용자의 이상징후 쓰기 권한)를 만든 복사본으로 돌려 모두 실패하는 것을 확인했다.
- **남은 범위:** SEC-12(변경과 이력의 트랜잭션)와 DB 함수의 전이·버전·중복·재발·동시 실행 시험은 해당 DB 함수를 만드는 PLAN 22·23·26·27번에서 이 폴더에 파일을 추가한다.
- **`npm run check:db`와의 관계:** `check:db`는 칸·제약·기본값처럼 테이블 구조를 세부적으로 확인하고, pgTAP은 "누가 무엇을 할 수 있는가(권한·RLS)"를 확인한다. 둘 다 유지한다.

**테스트용 데이터 (PLAN 17번)**
- DEMO 시나리오 160건: 정상 100, 이상 30(규칙별 10), 경계 30
- 테스트 계정 2개: 팀장 1, 운영 담당자 1 (가상 이메일·이름)
  - 만들기: `npm run setup:accounts` (PLAN 13번). Supabase Auth 관리 기능(서버 전용 키)으로 계정을 만들고 `profiles`에 역할을 넣는 것이 PRD 4-4의 "서버의 승인된 관리 절차"이다. 여러 번 실행해도 안전하다.
  - 이름: 팀장 `admin-demo@example.com`(이름 "시연 팀장", 역할 admin), 운영 담당자 `operator-demo@example.com`(이름 "시연 담당자", 역할 operator). 이메일은 예약 도메인 `@example.com`만 허용해 실제 사람의 계정을 건드리지 않는다.
  - 비밀번호: 무작위 24자를 `.env`의 `DEMO_ADMIN_PASSWORD`·`DEMO_OPERATOR_PASSWORD`에만 저장한다. 소스코드·로그·채팅에 출력하지 않고, Vercel에도 등록하지 않는다. 화면 시연과 Playwright 로그인은 `.env`에서 읽어 쓴다.
  - 확인: `npm run check:accounts`가 두 계정으로 실제 로그인해 받은 JWT로 DB를 직접 호출하며 SEC-03·04·05·07을 실제 계정으로 확인한다.
- 테스트마다 DB를 같은 상태로 되돌릴 수 있게 주입 스크립트를 다시 실행할 수 있어야 한다.

---

## 11. 폴더 구조와 코드 규칙

### 11.1 폴더 구조

```
onbid_rader/
├─ proxy.ts                     로그인 확인·세션 갱신
├─ app/
│  ├─ login/page.tsx            로그인
│  ├─ (app)/                    로그인 후 화면 묶음 (공통 틀 layout.tsx)
│  │  ├─ page.tsx               대시보드
│  │  ├─ anomalies/             목록, [id] 상세
│  │  ├─ runs/                  목록, [id] 상세
│  │  └─ reports/               목록, [id] 미리보기
│  └─ api/
│     ├─ cron/daily-check/route.ts
│     └─ reports/[id]/download/route.ts
├─ components/                  화면 조각 (표, 배지, 카드, 처리 폼)
├─ lib/
│  ├─ rules/                    탐지 규칙 3개 (순수 함수)
│  ├─ checks/                   점검 실행 엔진, 조회기(demo/public), 필드 정리
│  ├─ anomalies/                서버 액션, 조회
│  ├─ reports/                  보고서 집계·Markdown 작성, 서버 액션
│  ├─ auth/                     로그인 사용자·역할 확인
│  ├─ supabase/                 server.ts(사용자용), client.ts(브라우저용), admin.ts(서버 관리용)
│  ├─ validation/               Zod 입력 규칙
│  ├─ settings.ts               설정값 읽기·검증
│  └─ time.ts                   KST 변환
├─ supabase/
│  ├─ migrations/               테이블·RLS·DB 함수
│  └─ tests/                    pgTAP 테스트
├─ data/demo/                   DEMO 시나리오 데이터
├─ scripts/                     테스트 계정 생성, DEMO 데이터 주입
└─ tests/
   ├─ unit/                     Vitest
   └─ e2e/                      Playwright
```

### 11.2 의존 규칙
- `lib/rules`는 Next.js·Supabase를 전혀 모른다. 데이터만 받아 결과만 돌려준다.
- `lib/supabase/admin.ts`(서버 관리용 키 사용)는 예약 점검·수동 점검·관리 스크립트에서만 쓴다. 화면 컴포넌트나 `"use client"` 파일에서는 절대 불러오지 않는다.
  - 수동 점검은 서버 액션이 사용자 권한으로 admin 역할을 확인한 뒤에만 관리용 연결로 엔진을 실행한다(PRD 7-3 규칙 9).
- 화면(`app/`)은 `lib/`를 불러 쓰고, `lib/`는 `app/`을 불러오지 않는다.

### 11.3 코드 규칙
- 파일 이름은 영문 소문자와 하이픈(`date-order.ts`), 컴포넌트는 대문자 시작(`AnomalyTable`)
- 코드 주석은 한국어, 화면 문구도 한국어
- 탐지 규칙 ID: `DATE_ORDER`, `REQUIRED_FIELD`, `LIST_DETAIL_MISMATCH`, API 상태 이상징후 `EMPTY_RESULT`
- 환경변수 이름은 PRD 7-3을 그대로 쓴다.

---

## 12. 구현 안내

### 12.1 구현 순서
PLAN.md의 작업 1~39번 순서를 그대로 따른다. 이 설계에서 정한 파일 위치는 위 11.1을 따른다.

### 12.2 작업 묶음 (세션 안내)

*한 번에 한 묶음씩, 각각 `feature/...` 브랜치에서 진행*

| 묶음 | PLAN 작업 | 결과물 | 브랜치 예시 |
|---|---|---|---|
| module-1 준비 | 1~5 | CLI 인증, Supabase 연결, 환경변수, 테스트 도구 설치 | `feature/setup` |
| module-2 DB | 6~12 | 테이블 마이그레이션, RLS, pgTAP (DB 함수는 6.3 표의 작업 번호에서 만듦) | `feature/database` |
| module-3 로그인 | 13~15 | 테스트 계정, 로그인, 공통 화면 틀 | `feature/auth` |
| module-4 규칙 | 16~20 | 설정값, DEMO 데이터, 탐지 규칙 3개 + 테스트 | `feature/detection-rules` |
| module-5 점검 | 21~24 | 조회기, 점검 엔진, 이상징후 등록, 수동 점검 | `feature/check-engine` |
| module-6 처리 | 25~28 | 목록·상세, 배정, 상태변경, 이력 화면 | `feature/anomaly-handling` |
| module-7 보고 | 29~30 | 대시보드, 일일 보고서 | `feature/dashboard-report` |
| module-8 자동화 | 31~33 | 예약 점검, 누락 감지, PUBLIC 조회기 | `feature/scheduling` |
| module-9 검증·배포 | 34~37 | 보안·성공 기준 테스트, Vercel 배포, 시연 | `feature/release` |

## 버전 기록

| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1 | 2026-10-29 | 첫 초안 (설계 방식 C, 추가 기술 `@supabase/supabase-js`·`@supabase/ssr`·Zod·Vitest·Playwright 승인) |
| 0.2 | 2026-10-29 | 문서 정합성 검토 24건 반영: 조회 범위, 재발·재개 규칙, `EMPTY_RESULT`, DEMO 스키마(부록 B), 예약 누락 Cron, 검토 시작 버튼, `blocked`·멈춘 실행 정리, 출처별·날짜 선택 보고서, Vault, 테스트 보강 |

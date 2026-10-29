# 온비드 OpenAPI 서비스 등록부 (R01 초안)

> **상태: 초안(미확정).** 로컬 활용가이드(명세서) 25개를 자동으로 읽어 정리했다. API는 한 번도 호출하지 않았다.
> PRD v2.0 부록 A-2의 필수 등록 항목 중 **명세서에서 확인되는 것만** 채웠고, 나머지(승인 상태·유효 샘플·무데이터 정책·점검 주기·호출 예산·Probe 방식)는 **미정**으로 둔다. 임의로 만들지 않는다.
> 작성일: 2026-10-29 · 출처: `D:\python\onbid_openapi\명세서\OpenAPI활용가이드_*.docx`

## 1. 한눈에 보기

- 서비스ID(`SVC-API-NNN`)는 001~027 중 **008, 009번이 없다**. 파일 번호와 서비스ID는 서로 다른 체계다(예: 파일 08번의 서비스ID는 013).
- 명세서 25개 확인, 오퍼레이션 28개. 번호 01~26 중 **없는 번호: 16** → 26종 목표와의 차이는 사용자 확인 필요(PRD 부록 D '확정이 필요한 결정').
- 실호출로 확인한 오퍼레이션: 부동산 물건목록 `getRlstCltrList`, 부동산 물건상세 `getRlstDtlInf` (2026-10-29, 응답 형식이 명세와 일치).
- 나머지는 명세서 기준 정보만 있고, 서비스키 승인 범위·유효 입력값·무데이터 정책은 확인 전이다. 이 상태는 검증 불가(`UNVERIFIED`)로 취급하며 정상으로 세지 않는다.
- 모든 서비스: 읽기 전용 GET, `serviceKey` 필수, 응답은 XML/JSON(`resultType`) 지원(명세서 기준). 공통 결과코드는 PRD 부록 A-1.

## 2. 서비스·오퍼레이션 표

| 번호 | 서비스ID | 서비스명 | 오퍼레이션 | 한글명 | 호출 경로(명세서) | 업무 필수 파라미터 | 확인 상태 |
|---|---|---|---|---|---|---|---|
| 01 | SVC-API-001 | 온비드 부동산 물건목록 조회서비스 | `getRlstCltrList` | 부동산 물건목록 정보조회 | `[서비스URL]/getRlstCltrList2` | prptDivCd, pvctTrgtYn | 명세 확인, 실호출 확인(2026-10-29) |
| 02 | SVC-API-002 | 온비드 동산 물건목록 조회서비스 | `getMvastCltrList` | 동산 물건목록 정보조회 | `[서비스URL]/getMvastCltrList2` | prptDivCd, pvctTrgtYn | 명세 확인, 실호출 미확인 |
| 03 | SVC-API-003 | 온비드 차량 물건목록 조회서비스 | `getCarCltrList` | 차량 물건목록 정보조회 | `[서비스URL]/getCarCltrList2` | prptDivCd, pvctTrgtYn | 명세 확인, 실호출 미확인 |
| 04 | SVC-API-004 | 온비드 부동산 물건상세 조회서비스 | `getRlstDtlInf` | 부동산 물건상세정보 조회 | `[서비스URL]/getRlstDtlInf2` | cltrMngNo | 명세 확인, 실호출 확인(2026-10-29) |
| 05 | SVC-API-005 | 온비드 동산 물건상세 조회서비스 | `getMvastDtlInf` | 동산 물건상세정보 조회 | `[서비스URL]/getMvastDtlInf2` | cltrMngNo | 명세 확인, 실호출 미확인 |
| 06 | SVC-API-006 | 온비드 차량 물건상세 조회서비스 | `getCarDtlInf` | 차량 물건상세정보 조회 | `[서비스URL]/getCarDtlInf2` | cltrMngNo | 명세 확인, 실호출 미확인 |
| 07 | SVC-API-007 | 온비드 물건상세 입찰정보 조회서비스 | `getCltrBidInf` | 물건 입찰정보 조회 | `[서비스URL]/getCltrBidInf2` | cltrMngNo, pbctCdtnNo | 명세 확인, 실호출 미확인 |
| 08 | SVC-API-013 | 온비드 물건 입찰결과목록 조회서비스 | `getCltrBidRsltList` | 물건 입찰결과 목록조회 | `[서비스URL]/getCltrBidRsltList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | 명세 확인, 실호출 미확인 |
| 09 | SVC-API-014 | 온비드 물건 입찰결과상세 조회서비스 | `getCltrBidRsltDtl` | 물건 입찰결과상세 조회 | `[서비스URL]/getCltrBidRsltDtl2` | cltrMngNo | 명세 확인, 실호출 미확인 |
| 10 | SVC-API-015 | 온비드 공고목록 조회서비스 | `getPbancList` | 공고목록 정보조회 | `[서비스URL]/getPbancList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | 명세 확인, 실호출 미확인 |
| 11 | SVC-API-016 | 온비드 공고상세 조회서비스 | `getPbancDtlInf` | 공고상세 정보조회 | `[서비스URL]/getPbancDtlInf2` | pbancMngNo | 명세 확인, 실호출 미확인 |
| 12 | SVC-API-017 | 온비드 공고상세 입찰정보 조회서비스 | `getPbancBidInf` | 공고 입찰정보 조회 | `[서비스URL]/getPbancBidInf2` | pbancMngNo | 명세 확인, 실호출 미확인 |
| 13 | SVC-API-018 | 온비드 공고상세 물건정보 조회서비스 | `getPbancCltrInf` | 공고 물건정보 조회 | `[서비스URL]/getPbancCltrInf2` | pbancMngNo | 명세 확인, 실호출 미확인 |
| 14 | SVC-API-019 | 온비드 공고 입찰결과목록 조회서비스 | `getPbancBidRsltList` | 공고 입찰결과 목록조회 | `[서비스URL]/getPbancBidRsltList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | 명세 확인, 실호출 미확인 |
| 15 | SVC-API-020 | 온비드 공고 입찰결과상세 조회서비스 | `getPbancBidRsltDtl` | 공고 입찰결과상세 조회 | `[서비스URL]/getPbancBidRsltDtl2` | pbancMngNo | 명세 확인, 실호출 미확인 |
| 17 | SVC-API-010 | 온비드 순위물건목록 관심물건순위 조회서비스 | `getItrsCltrRnkClg` | 순위물건목록 관심물건순위 정보 | `[서비스URL]/getItrsCltrRnkClg` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 18 | SVC-API-011 | 온비드 순위물건목록 조회수 순위 조회서비스 | `getInqRnkClg` | 순위물건목록 조회수순위 정보 | `[서비스URL]/getInqRnkClg` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 19 | SVC-API-012 | 온비드 순위물건목록 저감률순위 조회서비스 | `get50PctDecrCltr` | 순위물건목록 저감순위 정보 | `[서비스URL]/get50PctDecrCltr` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 20 | SVC-API-021 | 온비드 정부재산목록 국유일반재산 조회서비스 | `getGvwsGnrPrptInf` | 정부재산목록 국유일반재산 정보 | `[서비스URL]/getGvwsGnrPrptInf` | sdnm | 명세 확인, 실호출 미확인 |
| 21 | SVC-API-022 | 온비드 정부재산목록 공유일반재산 조회서비스 | `getPbownGnrPrptInf` | 정부재산목록 공유일반재산 정보 | `[서비스URL]/getPbownGnrPrptInf` | sdnm | 명세 확인, 실호출 미확인 |
| 22 | SVC-API-023 | 온비드 정부재산목록 친일귀속재산 조회서비스 | `getPjpnBlnPrptInf` | 정부재산목록 친일귀속재산 정보 | `[서비스URL]/getPjpnBlnPrptInf` | sdnm | 명세 확인, 실호출 미확인 |
| 23 | SVC-API-024 | 온비드 정부재산목록 불용품 조회서비스 | `getDisuseCmdtyInf` | 정부재산목록 불용품 정보 | `[서비스URL]/getDisuseCmdtyInf` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 24 | SVC-API-025 | 온비드 코드 및 주소 조회서비스 | `getOnbidUsgCodeInfo` | 용도 코드 조회 | `[서비스URL]/getOnbidUsgCodeInfo` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 24 | SVC-API-025 | 온비드 코드 및 주소 조회서비스 | `getOnbidDtlAddrInfo` | 온비드 주소 조회 | `[서비스URL]/getOnbidDtlAddrInfo` | (공통 항목만) | 명세 확인, 실호출 미확인 |
| 25 | SVC-API-026 | 온비드 지역별 입찰 통계 조회서비스 | `getKamcoCltrClarStats` | 캠코 물건 지역별 통계 | `[서비스URL]/getKamcoCltrClarStats` | statsTypeCd, inqPerd | 명세 확인, 실호출 미확인 |
| 25 | SVC-API-026 | 온비드 지역별 입찰 통계 조회서비스 | `getOrgCltrClarStats` | 이용기관 물건 지역별 통계 | `[서비스URL]/getOrgCltrClarStats` | inqPerd | 명세 확인, 실호출 미확인 |
| 26 | SVC-API-027 | 온비드 용도별 입찰 통계 조회서비스 | `getKamcoCltrUsgStats` | 캠코 물건 용도별 통계 | `[서비스URL]/getKamcoCltrUsgStats` | statsTypeCd, inqPerd | 명세 확인, 실호출 미확인 |
| 26 | SVC-API-027 | 온비드 용도별 입찰 통계 조회서비스 | `getOrgCltrUsgStats` | 이용기관 물건 용도별 통계 | `[서비스URL]/getOrgCltrUsgStats` | inqPerd | 명세 확인, 실호출 미확인 |

> '업무 필수 파라미터'는 공통 항목(`serviceKey`·`pageNo`·`numOfRows`·`resultType`)을 뺀, 명세서에서 항목구분이 필수(1)인 항목이다.

## 3. 서비스별 상세 (명세서에서 읽은 값)

### 01. 온비드 부동산 물건목록 조회서비스

- 서비스ID: `SVC-API-001` / 영문명: `OnbidRlstListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidRlstListSrvc2`
- 오퍼레이션 `getRlstCltrList` (부동산 물건목록 정보조회) → `[서비스URL]/getRlstCltrList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `prptDivCd`, `pvctTrgtYn`
  - 선택 요청 항목 수: 30
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 02. 온비드 동산 물건목록 조회서비스

- 서비스ID: `SVC-API-002` / 영문명: `OnbidMvastListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidMvastListSrvc2`
- 오퍼레이션 `getMvastCltrList` (동산 물건목록 정보조회) → `[서비스URL]/getMvastCltrList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `prptDivCd`, `pvctTrgtYn`
  - 선택 요청 항목 수: 25
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 03. 온비드 차량 물건목록 조회서비스

- 서비스ID: `SVC-API-003` / 영문명: `OnbidCarListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCarListSrvc2`
- 오퍼레이션 `getCarCltrList` (차량 물건목록 정보조회) → `[서비스URL]/getCarCltrList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `prptDivCd`, `pvctTrgtYn`
  - 선택 요청 항목 수: 31
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 04. 온비드 부동산 물건상세 조회서비스

- 서비스ID: `SVC-API-004` / 영문명: `OnbidRlstDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2`
- 오퍼레이션 `getRlstDtlInf` (부동산 물건상세정보 조회) → `[서비스URL]/getRlstDtlInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrMngNo`
  - 선택 요청 항목 수: 1
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 05. 온비드 동산 물건상세 조회서비스

- 서비스ID: `SVC-API-005` / 영문명: `OnbidMvastDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidMvastDtlSrvc2`
- 오퍼레이션 `getMvastDtlInf` (동산 물건상세정보 조회) → `[서비스URL]/getMvastDtlInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrMngNo`
  - 선택 요청 항목 수: 1
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 06. 온비드 차량 물건상세 조회서비스

- 서비스ID: `SVC-API-006` / 영문명: `OnbidCarDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCarDtlSrvc2`
- 오퍼레이션 `getCarDtlInf` (차량 물건상세정보 조회) → `[서비스URL]/getCarDtlInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrMngNo`
  - 선택 요청 항목 수: 1
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 07. 온비드 물건상세 입찰정보 조회서비스

- 서비스ID: `SVC-API-007` / 영문명: `OnbidCltrBidDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCltrBidDtlSrvc2`
- 오퍼레이션 `getCltrBidInf` (물건 입찰정보 조회) → `[서비스URL]/getCltrBidInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrMngNo`, `pbctCdtnNo`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 08. 온비드 물건 입찰결과목록 조회서비스

- 서비스ID: `SVC-API-013` / 영문명: `OnbidCltrBidRsltListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2`
- 오퍼레이션 `getCltrBidRsltList` (물건 입찰결과 목록조회) → `[서비스URL]/getCltrBidRsltList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrTypeCd`, `prptDivCd`, `opbdDtStart`, `opbdDtEnd`
  - 선택 요청 항목 수: 35
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 09. 온비드 물건 입찰결과상세 조회서비스

- 서비스ID: `SVC-API-014` / 영문명: `OnbidCltrBidRsltDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCltrBidRsltDtlSrvc2`
- 오퍼레이션 `getCltrBidRsltDtl` (물건 입찰결과상세 조회) → `[서비스URL]/getCltrBidRsltDtl2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrMngNo`
  - 선택 요청 항목 수: 1
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 10. 온비드 공고목록 조회서비스

- 서비스ID: `SVC-API-015` / 영문명: `OnbidPbancListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancListSrvc2`
- 오퍼레이션 `getPbancList` (공고목록 정보조회) → `[서비스URL]/getPbancList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrTypeCd`, `prptDivCd`, `opbdDtStart`, `opbdDtEnd`
  - 선택 요청 항목 수: 8
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 11. 온비드 공고상세 조회서비스

- 서비스ID: `SVC-API-016` / 영문명: `OnbidPbancDtlnfSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancDtlnfSrvc2`
- 오퍼레이션 `getPbancDtlInf` (공고상세 정보조회) → `[서비스URL]/getPbancDtlInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `pbancMngNo`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 12. 온비드 공고상세 입찰정보 조회서비스

- 서비스ID: `SVC-API-017` / 영문명: `OnbidPbancBidDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancBidDtlSrvc2`
- 오퍼레이션 `getPbancBidInf` (공고 입찰정보 조회) → `[서비스URL]/getPbancBidInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `pbancMngNo`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 13. 온비드 공고상세 물건정보 조회서비스

- 서비스ID: `SVC-API-018` / 영문명: `OnbidPbancCltrDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancCltrDtlSrvc2`
- 오퍼레이션 `getPbancCltrInf` (공고 물건정보 조회) → `[서비스URL]/getPbancCltrInf2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `pbancMngNo`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 14. 온비드 공고 입찰결과목록 조회서비스

- 서비스ID: `SVC-API-019` / 영문명: `OnbidPbancBidRsltListSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancBidRsltListSrvc2`
- 오퍼레이션 `getPbancBidRsltList` (공고 입찰결과 목록조회) → `[서비스URL]/getPbancBidRsltList2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `cltrTypeCd`, `prptDivCd`, `opbdDtStart`, `opbdDtEnd`
  - 선택 요청 항목 수: 7
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 15. 온비드 공고 입찰결과상세 조회서비스

- 서비스ID: `SVC-API-020` / 영문명: `OnbidPbancBidRsltDtlSrvc` / 버전: 2.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbancBidRsltDtlSrvc2`
- 오퍼레이션 `getPbancBidRsltDtl` (공고 입찰결과상세 조회) → `[서비스URL]/getPbancBidRsltDtl2`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `pbancMngNo`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 17. 온비드 순위물건목록 관심물건순위 조회서비스

- 서비스ID: `SVC-API-010` / 영문명: `OnbidItrsCltrRnkClgSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidItrsCltrRnkClgSrvc`
- 오퍼레이션 `getItrsCltrRnkClg` (순위물건목록 관심물건순위 정보) → `[서비스URL]/getItrsCltrRnkClg`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 18. 온비드 순위물건목록 조회수 순위 조회서비스

- 서비스ID: `SVC-API-011` / 영문명: `OnbidInqRnkClgSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidInqRnkClgSrvc`
- 오퍼레이션 `getInqRnkClg` (순위물건목록 조회수순위 정보) → `[서비스URL]/getInqRnkClg`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 19. 온비드 순위물건목록 저감률순위 조회서비스

- 서비스ID: `SVC-API-012` / 영문명: `Onbid50PctDecrCltrSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/Onbid50PctDecrCltrSrvc`
- 오퍼레이션 `get50PctDecrCltr` (순위물건목록 저감순위 정보) → `[서비스URL]/get50PctDecrCltr`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 20. 온비드 정부재산목록 국유일반재산 조회서비스

- 서비스ID: `SVC-API-021` / 영문명: `OnbidGvwsGnrPrptInfSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidGvwsGnrPrptInfSrvc`
- 오퍼레이션 `getGvwsGnrPrptInf` (정부재산목록 국유일반재산 정보) → `[서비스URL]/getGvwsGnrPrptInf`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `sdnm`
  - 선택 요청 항목 수: 15
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 21. 온비드 정부재산목록 공유일반재산 조회서비스

- 서비스ID: `SVC-API-022` / 영문명: `OnbidPbownGnrPrptInfSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPbownGnrPrptInfSrvc`
- 오퍼레이션 `getPbownGnrPrptInf` (정부재산목록 공유일반재산 정보) → `[서비스URL]/getPbownGnrPrptInf`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `sdnm`
  - 선택 요청 항목 수: 12
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 22. 온비드 정부재산목록 친일귀속재산 조회서비스

- 서비스ID: `SVC-API-023` / 영문명: `OnbidPjpnBlnPrptInfSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidPjpnBlnPrptInfSrvc`
- 오퍼레이션 `getPjpnBlnPrptInf` (정부재산목록 친일귀속재산 정보) → `[서비스URL]/getPjpnBlnPrptInf`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `sdnm`
  - 선택 요청 항목 수: 12
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 23. 온비드 정부재산목록 불용품 조회서비스

- 서비스ID: `SVC-API-024` / 영문명: `OnbidDisuseCmdtyInfSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidDisuseCmdtyInfSrvc`
- 오퍼레이션 `getDisuseCmdtyInf` (정부재산목록 불용품 정보) → `[서비스URL]/getDisuseCmdtyInf`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 24. 온비드 코드 및 주소 조회서비스

- 서비스ID: `SVC-API-025` / 영문명: `OnbidCodeSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidCodeSrvc`
- 오퍼레이션 `getOnbidUsgCodeInfo` (용도 코드 조회) → `[서비스URL]/getOnbidUsgCodeInfo`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 1
- 오퍼레이션 `getOnbidDtlAddrInfo` (온비드 주소 조회) → `[서비스URL]/getOnbidDtlAddrInfo`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`
  - 선택 요청 항목 수: 3
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 25. 온비드 지역별 입찰 통계 조회서비스

- 서비스ID: `SVC-API-026` / 영문명: `OnbidClarBidStatsSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidClarBidStatsSrvc`
- 오퍼레이션 `getKamcoCltrClarStats` (캠코 물건 지역별 통계) → `[서비스URL]/getKamcoCltrClarStats`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `statsTypeCd`, `inqPerd`, `pageNo`, `totalCount`, `numOfRows`, `resultCode`, `resultMsg`
  - 선택 요청 항목 수: 0
- 오퍼레이션 `getOrgCltrClarStats` (이용기관 물건 지역별 통계) → `[서비스URL]/getOrgCltrClarStats`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `inqPerd`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

### 26. 온비드 용도별 입찰 통계 조회서비스

- 서비스ID: `SVC-API-027` / 영문명: `OnbidUsgBidStatsSrvc` / 버전: 1.0 / 배포일자: 2026/04/06
- 운영 URL: `https://apis.data.go.kr/B010003/OnbidUsgBidStatsSrvc`
- 오퍼레이션 `getKamcoCltrUsgStats` (캠코 물건 용도별 통계) → `[서비스URL]/getKamcoCltrUsgStats`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `statsTypeCd`, `inqPerd`, `pageNo`, `totalCount`, `numOfRows`, `resultCode`, `resultMsg`
  - 선택 요청 항목 수: 0
- 오퍼레이션 `getOrgCltrUsgStats` (이용기관 물건 용도별 통계) → `[서비스URL]/getOrgCltrUsgStats`
  - 필수 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`, `inqPerd`
  - 선택 요청 항목 수: 0
- 등록 상태: 승인 상태·유효 샘플·무데이터 정책·Probe 방식·호출 예산은 **미정**

## 4. 읽지 못한 항목 (사람이 확인할 것)

- 자동 읽기에서 문제가 없었던 문서: 전체
- 결번 확인: 명세서 파일 번호 16번이 없고, 서비스ID(`SVC-API-NNN`)도 008, 009번이 없다(번호 001~027 중 25개만 확인). 26종의 구성은 미확정이며 공식 목록과 대조해야 한다.

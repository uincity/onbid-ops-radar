# 온비드 OpenAPI 서비스 등록부 (R01 확정판)

> 이 문서는 `data/registry/api-registry.json`에서 `python scripts/build-api-registry.py <명세서 폴더>`로 만든다. 손으로 고치지 않는다.
> 확정일: 2026-10-29 · 출처: 로컬 활용가이드(명세서) 25개. API는 이 작업에서 한 번도 호출하지 않았다.

## 1. 확정 결과

- **관리 목표 26종 중 25종의 명세를 확인해 등록했고, 1종은 미확정**이다. 미확정 슬롯은 점검 대상·분모에 넣지 않는다.
- 등록한 오퍼레이션은 28개이며, 이 중 실제 호출로 응답 형식을 확인한 것은 **2개**(부동산 물건목록·상세)다. 나머지 26개는 명세서 확인만 했으므로 점검 결과가 나오기 전까지 `UNVERIFIED`로 취급한다(정상으로 세지 않음).
- 미확정 1종의 단서: 명세서 파일 번호 16번이 없고, 서비스ID(SVC-API-NNN)도 008, 009번이 없다. 26종의 정확한 구성은 공공데이터포털 공식 목록과 대조해야 확정된다. 확정 전에는 이 슬롯을 점검 대상·분모에 넣지 않고 '미확정'으로 표시한다.
- 승인 상태·유효 샘플·무데이터 정책·점검 주기·호출 예산·Probe 방식은 명세서로 알 수 없어 **미정**이다. 임의로 채우지 않는다.
- **갱신(2026-11-03, 사용자 확인):** 등록한 25종 서비스는 모두 공공데이터포털에서 승인되어 있고 서비스별 일일 100,000회 트래픽이 가능하다. 등록부의 승인 상태(`APPROVED`)와 쿼터에 반영했다. 유효 샘플·무데이터 정책·점검 주기·Probe 방식은 여전히 **미정**이며, 그전까지 해당 오퍼레이션은 요청을 보내지 않고 `UNVERIFIED(NO_VALID_INPUT)`로 둔다. 등록부를 스크립트로 다시 만들어도 같은 값이 나오도록 `scripts/build-api-registry.py`에도 반영했다.
- **점검 입력(2026-11-03, 1단계 9개):** 사용자의 수집 코드(2026-04 사용)에서 확인된 값으로 순위 3종(`cltrDivNm=부동산`), 코드·주소 2종(입력 없음), 통계 4종(`statsTypeCd`·`inqPerd={PREV_YEAR}`)의 점검 입력을 등록부 `probe`에 기록했다. 근거는 `probe.inputSource`에 파일 이름으로 남겼고, **이번 점검에서 실호출로 확인하기 전**이다. 나머지 오퍼레이션은 근거가 없어 비워 두었다. `{PREV_YEAR}`는 점검할 때 KST 기준 직전 연도로 풀어 쓴다.
- **실호출 확인(2026-11-03):** 위 1단계 9개는 사용자가 `npm run test:public-probes`로 1회씩 호출해 모두 PASS_DATA(HTTP 200·코드 00·필수 항목 누락 0)를 확인했다. 등록부 verification은 LIVE_VERIFIED로 갱신했다(이 문서의 표는 스크립트로 다시 만들 때 갱신된다).
- **2단계 점검 입력 4개(2026-11-03 실호출 확인 완료, 모두 PASS_DATA):** 공고 목록·입찰결과 목록(`cltrTypeCd=0001`, `prptDivCd=0007`, 개찰일 `{DAYS_AGO_7}`~`{TODAY}`), 동산·차량 목록(재산유형 전체, `pvctTrgtYn=N`). 공고 입찰결과(`getPbancBidRsltList`)와 정부재산 4종은 사용자 코드에 사용 기록이 없었다.
- **3단계 점검 입력 5개(2026-11-03, 명세서 샘플 값 사용을 사용자가 승인. 실호출 결과: 4개 PASS_DATA, 공유일반재산 `getPbownGnrPrptInf`는 `sdnm=강원도`에서 결과코드 03(데이터 없음). 2026-11-04 서울특별시 등 9가지 조합에서도 모두 03이라 사용자 결정으로 무데이터를 허용(`noDataPolicy=ALLOWED`)해 0건을 `PASS_NO_DATA`로 처리, 실데이터는 미확인):** 공고 입찰결과 목록은 013·015와 같은 입력(`0001`·`0007`·최근 7일), 정부재산 국유·친일귀속은 `sdnm=서울특별시`, 공유는 `sdnm=강원도`, 불용품은 입력 없음. 근거는 `probe.inputSource`에 "서비스 명세서 샘플 값"으로 남겼다.
- 결과코드표는 25개 문서가 모두 같다.

## 2. 서비스·오퍼레이션 표

| 번호 | 서비스ID | 서비스명 | 오퍼레이션 | 호출 주소 | 업무 필수 파라미터 | 입력값 출처 후보 | 확인 상태 |
|---|---|---|---|---|---|---|---|
| 01 | SVC-API-001 | 온비드 부동산 물건목록 조회서비스 | `getRlstCltrList` | `https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2` | prptDivCd, pvctTrgtYn | - | 실호출 확인 |
| 02 | SVC-API-002 | 온비드 동산 물건목록 조회서비스 | `getMvastCltrList` | `https://apis.data.go.kr/B010003/OnbidMvastListSrvc2/getMvastCltrList2` | prptDivCd, pvctTrgtYn | - | 명세만 확인 |
| 03 | SVC-API-003 | 온비드 차량 물건목록 조회서비스 | `getCarCltrList` | `https://apis.data.go.kr/B010003/OnbidCarListSrvc2/getCarCltrList2` | prptDivCd, pvctTrgtYn | - | 명세만 확인 |
| 04 | SVC-API-004 | 온비드 부동산 물건상세 조회서비스 | `getRlstDtlInf` | `https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2` | cltrMngNo | getRlstCltrList, getMvastCltrList, getCarCltrList, getItrsCltrRnkClg, getInqRnkClg, get50PctDecrCltr, getCltrBidRsltList | 실호출 확인 |
| 05 | SVC-API-005 | 온비드 동산 물건상세 조회서비스 | `getMvastDtlInf` | `https://apis.data.go.kr/B010003/OnbidMvastDtlSrvc2/getMvastDtlInf2` | cltrMngNo | getRlstCltrList, getMvastCltrList, getCarCltrList, getItrsCltrRnkClg, getInqRnkClg, get50PctDecrCltr, getCltrBidRsltList | 명세만 확인 |
| 06 | SVC-API-006 | 온비드 차량 물건상세 조회서비스 | `getCarDtlInf` | `https://apis.data.go.kr/B010003/OnbidCarDtlSrvc2/getCarDtlInf2` | cltrMngNo | getRlstCltrList, getMvastCltrList, getCarCltrList, getItrsCltrRnkClg, getInqRnkClg, get50PctDecrCltr, getCltrBidRsltList | 명세만 확인 |
| 07 | SVC-API-007 | 온비드 물건상세 입찰정보 조회서비스 | `getCltrBidInf` | `https://apis.data.go.kr/B010003/OnbidCltrBidDtlSrvc2/getCltrBidInf2` | cltrMngNo, pbctCdtnNo | getRlstCltrList, getMvastCltrList, getCarCltrList, getItrsCltrRnkClg, getInqRnkClg, get50PctDecrCltr, getCltrBidRsltList | 명세만 확인 |
| 08 | SVC-API-013 | 온비드 물건 입찰결과목록 조회서비스 | `getCltrBidRsltList` | `https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | - | 명세만 확인 |
| 09 | SVC-API-014 | 온비드 물건 입찰결과상세 조회서비스 | `getCltrBidRsltDtl` | `https://apis.data.go.kr/B010003/OnbidCltrBidRsltDtlSrvc2/getCltrBidRsltDtl2` | cltrMngNo | getRlstCltrList, getMvastCltrList, getCarCltrList, getItrsCltrRnkClg, getInqRnkClg, get50PctDecrCltr, getCltrBidRsltList | 명세만 확인 |
| 10 | SVC-API-015 | 온비드 공고목록 조회서비스 | `getPbancList` | `https://apis.data.go.kr/B010003/OnbidPbancListSrvc2/getPbancList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | - | 명세만 확인 |
| 11 | SVC-API-016 | 온비드 공고상세 조회서비스 | `getPbancDtlInf` | `https://apis.data.go.kr/B010003/OnbidPbancDtlnfSrvc2/getPbancDtlInf2` | pbancMngNo | getPbancList, getPbancBidRsltList | 실호출 확인 |
| 12 | SVC-API-017 | 온비드 공고상세 입찰정보 조회서비스 | `getPbancBidInf` | `https://apis.data.go.kr/B010003/OnbidPbancBidDtlSrvc2/getPbancBidInf2` | pbancMngNo | getPbancList, getPbancBidRsltList | 명세만 확인 |
| 13 | SVC-API-018 | 온비드 공고상세 물건정보 조회서비스 | `getPbancCltrInf` | `https://apis.data.go.kr/B010003/OnbidPbancCltrDtlSrvc2/getPbancCltrInf2` | pbancMngNo | getPbancList, getPbancBidRsltList | 명세만 확인 |
| 14 | SVC-API-019 | 온비드 공고 입찰결과목록 조회서비스 | `getPbancBidRsltList` | `https://apis.data.go.kr/B010003/OnbidPbancBidRsltListSrvc2/getPbancBidRsltList2` | cltrTypeCd, prptDivCd, opbdDtStart, opbdDtEnd | - | 명세만 확인 |
| 15 | SVC-API-020 | 온비드 공고 입찰결과상세 조회서비스 | `getPbancBidRsltDtl` | `https://apis.data.go.kr/B010003/OnbidPbancBidRsltDtlSrvc2/getPbancBidRsltDtl2` | pbancMngNo | getPbancList, getPbancBidRsltList | 명세만 확인 |
| 17 | SVC-API-010 | 온비드 순위물건목록 관심물건순위 조회서비스 | `getItrsCltrRnkClg` | `https://apis.data.go.kr/B010003/OnbidItrsCltrRnkClgSrvc/getItrsCltrRnkClg` | (공통 항목만) | - | 명세만 확인 |
| 18 | SVC-API-011 | 온비드 순위물건목록 조회수 순위 조회서비스 | `getInqRnkClg` | `https://apis.data.go.kr/B010003/OnbidInqRnkClgSrvc/getInqRnkClg` | (공통 항목만) | - | 명세만 확인 |
| 19 | SVC-API-012 | 온비드 순위물건목록 저감률순위 조회서비스 | `get50PctDecrCltr` | `https://apis.data.go.kr/B010003/Onbid50PctDecrCltrSrvc/get50PctDecrCltr` | (공통 항목만) | - | 명세만 확인 |
| 20 | SVC-API-021 | 온비드 정부재산목록 국유일반재산 조회서비스 | `getGvwsGnrPrptInf` | `https://apis.data.go.kr/B010003/OnbidGvwsGnrPrptInfSrvc/getGvwsGnrPrptInf` | sdnm | - | 명세만 확인 |
| 21 | SVC-API-022 | 온비드 정부재산목록 공유일반재산 조회서비스 | `getPbownGnrPrptInf` | `https://apis.data.go.kr/B010003/OnbidPbownGnrPrptInfSrvc/getPbownGnrPrptInf` | sdnm | - | 명세만 확인 |
| 22 | SVC-API-023 | 온비드 정부재산목록 친일귀속재산 조회서비스 | `getPjpnBlnPrptInf` | `https://apis.data.go.kr/B010003/OnbidPjpnBlnPrptInfSrvc/getPjpnBlnPrptInf` | sdnm | - | 명세만 확인 |
| 23 | SVC-API-024 | 온비드 정부재산목록 불용품 조회서비스 | `getDisuseCmdtyInf` | `https://apis.data.go.kr/B010003/OnbidDisuseCmdtyInfSrvc/getDisuseCmdtyInf` | (공통 항목만) | - | 명세만 확인 |
| 24 | SVC-API-025 | 온비드 코드 및 주소 조회서비스 | `getOnbidUsgCodeInfo` | `https://apis.data.go.kr/B010003/OnbidCodeSrvc/getOnbidUsgCodeInfo` | (공통 항목만) | - | 명세만 확인 |
| 24 | SVC-API-025 | 온비드 코드 및 주소 조회서비스 | `getOnbidDtlAddrInfo` | `https://apis.data.go.kr/B010003/OnbidCodeSrvc/getOnbidDtlAddrInfo` | (공통 항목만) | - | 명세만 확인 |
| 25 | SVC-API-026 | 온비드 지역별 입찰 통계 조회서비스 | `getKamcoCltrClarStats` | `https://apis.data.go.kr/B010003/OnbidClarBidStatsSrvc/getKamcoCltrClarStats` | statsTypeCd, inqPerd | - | 명세만 확인 |
| 25 | SVC-API-026 | 온비드 지역별 입찰 통계 조회서비스 | `getOrgCltrClarStats` | `https://apis.data.go.kr/B010003/OnbidClarBidStatsSrvc/getOrgCltrClarStats` | inqPerd | - | 명세만 확인 |
| 26 | SVC-API-027 | 온비드 용도별 입찰 통계 조회서비스 | `getKamcoCltrUsgStats` | `https://apis.data.go.kr/B010003/OnbidUsgBidStatsSrvc/getKamcoCltrUsgStats` | statsTypeCd, inqPerd | - | 명세만 확인 |
| 26 | SVC-API-027 | 온비드 용도별 입찰 통계 조회서비스 | `getOrgCltrUsgStats` | `https://apis.data.go.kr/B010003/OnbidUsgBidStatsSrvc/getOrgCltrUsgStats` | inqPerd | - | 명세만 확인 |

> '입력값 출처 후보'는 필수 식별 파라미터(물건관리번호·공매조건번호·공고관리번호)를 얻을 수 있는 목록형 오퍼레이션의 **후보**이며, 파라미터 이름만 보고 추정한 것이다. 실제로 어떤 목록을 쓸지는 R04에서 확인한다.

## 3. 공통

- 허용 호스트: `apis.data.go.kr` · HTTPS · 읽기 전용 GET · 응답 형식 JSON/XML(`resultType`)
- 공통 요청 항목: `serviceKey`, `pageNo`, `numOfRows`, `resultType`

| 결과코드 | 메시지 | 설명 |
|---|---|---|
| 00 | NORMAL_CODE | 정상 |
| 01 | APPLICATION_ERROR | 어플리케이션 에러 |
| 02 | DB_ERROR | 데이터베이스 에러 |
| 03 | NODATA_ERROR | 데이터없음 에러 |
| 04 | HTTP_ERROR | HTTP 에러 |
| 05 | SERVICETIMEOUT_ERROR | 서비스 연결실패 에러 |
| 10 | INVALID_REQUEST_PARAMETER_ERROR | 잘못된 요청 파라메터 에러 |
| 11 | NO_MANDATORY_REQUEST_PARAMETERS_ERROR | 필수요청 파라메터가 없음 |
| 12 | NO_OPENAPI_SERVICE_ERROR | 해당 오픈API서비스가 없거나 폐기됨 |
| 20 | SERVICE_ACCESS_DENIED_ERROR | 서비스 접근거부 |
| 21 | TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR | 일시적으로 사용할 수 없는 서비스 키 |
| 22 | LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR | 서비스 요청제한횟수 초과에러 |
| 30 | SERVICE_KEY_IS_NOT_REGISTERED_ERROR | 등록되지 않은 서비스키 |
| 31 | DEADLINE_HAS_EXPIRED_ERROR | 기한만료된 서비스키 |
| 32 | UNREGISTERED_IP_ERROR | 등록되지 않은 IP |
| 33 | UNSIGNED_CALL_ERROR | 서명되지 않은 호출 |
| 99 | UNKNOWN_ERROR | 기타에러 |

## 4. 읽기에서 확인한 문제

- 명세서 25개 모두 서비스ID·운영 URL·오퍼레이션·요청 항목·응답 항목을 읽었다.
- 명세서에 초당 최대 호출 수가 적혀 있지 않은 오퍼레이션 5개: `SVC-API-024/getDisuseCmdtyInf`, `SVC-API-026/getKamcoCltrClarStats`, `SVC-API-026/getOrgCltrClarStats`, `SVC-API-027/getKamcoCltrUsgStats`, `SVC-API-027/getOrgCltrUsgStats`. 다른 서비스의 값(초당 10회)을 가져다 쓰지 않고 R04에서 확인한다.


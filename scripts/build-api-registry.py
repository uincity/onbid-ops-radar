# -*- coding: utf-8 -*-
"""온비드 OpenAPI 활용가이드(명세서 .docx)를 읽어 서비스 등록부(R01)를 만든다.

실행: python scripts/build-api-registry.py "D:/python/onbid_openapi/명세서"
만드는 것:
  - data/registry/api-registry.json   기계가 읽는 등록부 (lib/registry가 읽고 검증한다. 손으로 고치지 않는다)
  - docs/api-registry.md              사람이 읽는 등록부

읽기 전용이다. 명세서 파일만 읽고 API는 호출하지 않는다. 명세서에 없는 값(승인 상태·유효 샘플·무데이터 정책·호출 예산)은
지어내지 않고 "미정"으로 둔다. (PRD 5-2-1, 부록 A-2)
"""
import glob
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
REGISTRY_DATE = "2026-10-29"
# 사용자 확인(2026-11-03): 온비드 OpenAPI 25종 서비스 모두 공공데이터포털에서 승인되어 있고 서비스별 일일 100,000회 트래픽이 가능하다.
APPROVAL_CONFIRMED_DATE = "2026-11-03"
# 점검 입력(1단계 9개 + 2단계 4개): 사용자의 수집 코드(2026-04 사용, 사용자 PC의 수집 스크립트 폴더)에서 확인된 값만 쓴다. 근거 없는 오퍼레이션은 비워 둔다.
# {PREV_YEAR} 같은 {…} 값은 점검할 때 lib/checks/generic-probe.ts가 KST 기준으로 풀어 쓴다.
PROBE_INPUTS = {"SVC-API-010/getItrsCltrRnkClg": {"cltrDivNm": "부동산"}, "SVC-API-011/getInqRnkClg": {"cltrDivNm": "부동산"}, "SVC-API-012/get50PctDecrCltr": {"cltrDivNm": "부동산"}, "SVC-API-025/getOnbidUsgCodeInfo": {}, "SVC-API-025/getOnbidDtlAddrInfo": {}, "SVC-API-026/getKamcoCltrClarStats": {"statsTypeCd": "0021", "inqPerd": "{PREV_YEAR}"}, "SVC-API-026/getOrgCltrClarStats": {"inqPerd": "{PREV_YEAR}"}, "SVC-API-027/getKamcoCltrUsgStats": {"statsTypeCd": "0041", "inqPerd": "{PREV_YEAR}"}, "SVC-API-027/getOrgCltrUsgStats": {"inqPerd": "{PREV_YEAR}"}, "SVC-API-002/getMvastCltrList": {"prptDivCd": "0007,0010,0005,0004,0002,0003,0006,0008,0011,0013", "pvctTrgtYn": "N"}, "SVC-API-003/getCarCltrList": {"prptDivCd": "0007,0010,0005,0004,0002,0003,0006,0008,0011,0013", "pvctTrgtYn": "N"}, "SVC-API-013/getCltrBidRsltList": {"cltrTypeCd": "0001", "prptDivCd": "0007", "opbdDtStart": "{DAYS_AGO_7}", "opbdDtEnd": "{TODAY}"}, "SVC-API-015/getPbancList": {"cltrTypeCd": "0001", "prptDivCd": "0007", "opbdDtStart": "{DAYS_AGO_7}", "opbdDtEnd": "{TODAY}"}}
# 근거 문구에는 사용자 PC의 폴더 경로를 넣지 않는다(공개 저장소). 파일 이름만 적는다.
PROBE_INPUT_SOURCES = {
    "ranking": "사용자 수집 코드 onbid_ranking_list.py (2026-04 사용). 이번 점검에서 실호출 확인 전",
    "code": "사용자 수집 코드 코드·주소 크롤러(onbid_usage_code_crawler.py, onbid_dtl_addr_crawler.py) (2026-04 사용, 필수 입력 없음). 이번 점검에서 실호출 확인 전",
    "stats": "사용자 수집 코드 onbid_bid_stats.py (2026-04 사용, statsTypeCd·inqPerd 형식). 이번 점검에서 실호출 확인 전",
    "list": "사용자 수집 코드 onbid_movable_property_list.py, onbid_vehicle_list.py (2026-04 사용, 재산유형 전체·수의계약 N). 이번 점검에서 실호출 확인 전",
    "bid": "사용자 수집 코드 onbid_bid_result_list.py (2026-04 사용, 부동산/압류재산·개찰일 기간). 이번 점검에서 실호출 확인 전",
    "notice": "사용자 수집 코드 onbid_notice_list.py (2026-04 사용, 기본값: 오늘 기준 1주 전~오늘, 부동산). 이번 점검에서 실호출 확인 전",
}


def probe_of(key):
    if key not in PROBE_INPUTS:
        return {"mode": None, "input": None, "inputSource": None}
    if "Mvast" in key or "Car" in key:
        source = PROBE_INPUT_SOURCES["list"]
    elif "BidRslt" in key:
        source = PROBE_INPUT_SOURCES["bid"]
    elif "Pbanc" in key:
        source = PROBE_INPUT_SOURCES["notice"]
    elif "Rnk" in key or "Decr" in key:
        source = PROBE_INPUT_SOURCES["ranking"]
    elif "SVC-API-025" in key:
        source = PROBE_INPUT_SOURCES["code"]
    else:
        source = PROBE_INPUT_SOURCES["stats"]
    return {"mode": "structural", "input": PROBE_INPUTS[key], "inputSource": source}
USER_QUOTA = {"dailyLimit": 100000, "source": "사용자 확인 2026-11-03: 25종 모두 승인, 일 100,000회 트래픽 (공공데이터포털 개발계정)"}
TARGET_SERVICES = 26  # 사용자가 정한 관리 목표 수 (PRD 용어 주의)

# 2026-10-29에 실제 호출로 응답 형식을 확인한 오퍼레이션 (PRD 부록 A-1, tests/unit/public-live.test.ts)
LIVE_VERIFIED = {"getRlstCltrList", "getRlstDtlInf"}
# 2026-11-03 사용자가 npm run test:public-probes로 실호출 1회씩 확인한 14개 (PASS_DATA, 필수 항목 누락 0). getPbancDtlInf는 공고 목록(getPbancList)의 pbancMngNo로 호출
LIVE_VERIFIED_2026_11_03 = ["getItrsCltrRnkClg", "getInqRnkClg", "get50PctDecrCltr", "getOnbidUsgCodeInfo", "getOnbidDtlAddrInfo", "getKamcoCltrClarStats", "getOrgCltrClarStats", "getKamcoCltrUsgStats", "getOrgCltrUsgStats", "getMvastCltrList", "getCarCltrList", "getCltrBidRsltList", "getPbancList", "getPbancDtlInf"]
LIVE_VERIFIED_EVIDENCE_2026_11_03 = "2026-11-03 사용자 실행 실호출 1회(npm run test:public-probes): HTTP 200·결과코드 00·1건 응답, 응답 구조 필수 항목 누락 0·자료형 경고 0"
COMMON_REQUEST = ("serviceKey", "pageNo", "numOfRows", "resultType")
# 다른 서비스의 결과를 받아야 입력값을 얻을 수 있는 식별 파라미터
ID_PARAMS = ("cltrMngNo", "pbctCdtnNo", "pbancMngNo")

spec_dir = sys.argv[1] if len(sys.argv) > 1 else None
if not spec_dir or not os.path.isdir(spec_dir):
    raise SystemExit("사용법: python scripts/build-api-registry.py <명세서 폴더>")
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def text(el):
    return "".join(t.text or "" for t in el.iter(W + "t"))


def lines_of(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    out = []
    for el in root.find(W + "body"):
        if el.tag == W + "p":
            t = text(el).strip()
            if t:
                out.append(t)
        elif el.tag == W + "tbl":
            for tr in el.iter(W + "tr"):
                out.append("| " + " | ".join(text(tc).strip().replace("\n", " ") for tc in tr.findall(W + "tc")) + " |")
    return out


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse(path):
    ls = lines_of(path)
    base = os.path.basename(path)
    doc = {"file": base, "no": int(re.search(r"_(\d{2})_", base).group(1)), "ops": [], "result_codes": {}}
    cur = None
    stage = "none"  # none → req(요청 표) → resp(응답 표)
    for idx, l in enumerate(ls):
        if not l.startswith("|"):
            if l.startswith("※ 항목구분"):
                if stage == "req" and cur is not None:
                    cur["req_done"] = True
                    stage = "between"
                elif stage == "resp":
                    stage = "none"
            continue
        c = cells(l)
        if "서비스ID" in c:
            doc["service_id"] = c[c.index("서비스ID") + 1]
        if "서비스명(국문)" in c:
            doc["name"] = c[c.index("서비스명(국문)") + 1]
        if "서비스명(영문)" in c:
            doc["name_en"] = c[c.index("서비스명(영문)") + 1]
        if "운영환경" in c and "base_url" not in doc:
            v = c[c.index("운영환경") + 1]
            if v.startswith("http") and any("서비스URL" in x for x in ls[max(0, idx - 2) : idx + 1]):
                doc["base_url"] = v
        if "서비스버전" in c:
            doc["version"] = c[c.index("서비스버전") + 1]
        if "배포일자" in c:
            doc["deployed"] = c[c.index("배포일자") + 1]
        # 응답 결과코드 표: "| 00 | NORMAL_CODE | 정상 |"
        if len(c) >= 3 and re.fullmatch(r"\d{2}", c[0]) and re.fullmatch(r"[A-Z_]{4,}", c[1]):
            doc["result_codes"][c[0]] = {"message": c[1], "description": c[2]}
            continue
        # 오퍼레이션 목록 행: 일련번호 | 국문 | 영문
        if len(c) >= 3 and c[0].isdigit() and re.fullmatch(r"[A-Za-z][A-Za-z0-9]+", c[2]) and "일련번호" not in c[0]:
            doc["ops"].append({"seq": c[0], "name_kr": c[1], "name": c[2], "path": None, "tps": None, "avg_ms": None, "params": [], "fields": []})
            continue
        if "Call Back URL" in c:
            cb = c[c.index("Call Back URL") + 1]
            m = re.search(r"/([A-Za-z0-9]+)$", cb)
            op = next((o for o in doc["ops"] if m and m.group(1).startswith(o["name"])), None)
            if op is None and doc["ops"]:
                op = next((o for o in doc["ops"] if o["path"] is None), doc["ops"][0])
            if op is not None and m:
                op["path"] = m.group(1)
            cur = op
            stage = "none"
            continue
        if cur is not None and "평균응답시간" in c:
            mm = re.search(r"(\d+)\s*ms", c[c.index("평균응답시간") + 1])
            tt = [x for x in c if "tps" in x.lower()]
            cur["avg_ms"] = int(mm.group(1)) if mm else None
            cur["tps"] = int(re.search(r"\d+", tt[0]).group(0)) if tt and re.search(r"\d+", tt[0]) else None
            continue
        if c and c[0] == "항목명(영문)" and "항목구분" in c and "샘플데이터" in c and len(c) == 6 and cur is not None:
            # 첫 번째 머리글은 요청 표, 두 번째는 응답 표다. (일부 문서는 요청 표 끝의 '※ 항목구분' 줄이 없어 stage로 구분한다)
            if stage in ("none",) and not cur.get("req_done"):
                stage = "req"
            else:
                cur["req_done"] = True
                stage = "resp"
            continue
        if cur is None:
            continue
        if stage == "req" and len(c) == 6 and c[0]:
            cur["params"].append({"name": c[0], "kr": c[1], "type": c[2], "required": c[3] == "1", "sample": c[4], "description": c[5]})
        elif stage == "resp":
            if len(c) == 7 and c[0] == "" and c[1]:
                cur["fields"].append({"name": c[1], "kr": c[2], "type": c[3], "required": c[4] == "1", "multiplicity": c[4]})
            elif len(c) == 8 and c[0] == "" and c[1] == "" and c[2]:
                cur["fields"].append({"name": c[2], "kr": c[3], "type": c[4], "required": c[5] == "1", "multiplicity": c[5], "nested": True})
    return doc


docs = sorted((parse(f) for f in glob.glob(os.path.join(spec_dir, "*.docx"))), key=lambda d: d["no"])
problems = []
for d in docs:
    if not d.get("service_id") or not d.get("base_url") or not d["ops"]:
        problems.append(f"{d['no']:02d}번 문서: 서비스ID·운영 URL·오퍼레이션 중 읽지 못한 것이 있음")
    for o in d["ops"]:
        if not o["path"]:
            problems.append(f"{d['no']:02d}번 {o['name']}: 호출 경로를 읽지 못함")
        if not o["params"]:
            problems.append(f"{d['no']:02d}번 {o['name']}: 요청 항목을 읽지 못함")
        if not o["fields"]:
            problems.append(f"{d['no']:02d}번 {o['name']}: 응답 항목을 읽지 못함")

# 결과코드표: 문서마다 같은지 확인하고 공통표로 만든다
code_sets = [json.dumps(d["result_codes"], sort_keys=True, ensure_ascii=False) for d in docs]
common_codes = docs[0]["result_codes"]
differing = [f"{d['no']:02d}" for d, s in zip(docs, code_sets) if s != code_sets[0]]

# 오퍼레이션 ID: 문서 안에서 유일하지 않을 수 있어(드물게) 서비스ID로 구분한다
all_ops = [(d, o) for d in docs for o in d["ops"]]


def is_list_like(o):
    """다른 서비스의 결과 없이 부를 수 있는 오퍼레이션(식별 파라미터가 필수가 아님)"""
    return not any(p["required"] and p["name"] in ID_PARAMS for p in o["params"])


def producers_of(param, me):
    return sorted(
        f"{d['service_id']}/{o['name']}"
        for d, o in all_ops
        if o is not me and is_list_like(o) and any(f["name"] == param for f in o["fields"])
    )


services = []
for d in docs:
    ops = []
    for o in d["ops"]:
        required = [p for p in o["params"] if p["required"]]
        business = [p for p in required if p["name"] not in COMMON_REQUEST]
        needs_ids = [p["name"] for p in business if p["name"] in ID_PARAMS]
        depends = sorted({x for p in needs_ids for x in producers_of(p, o)})
        live = o["name"] in LIVE_VERIFIED
        ops.append(
            {
                "operationId": o["name"],
                "nameKr": o["name_kr"],
                "method": "GET",
                "path": o["path"],
                "url": f"{d['base_url']}/{o['path']}",
                "tpsLimit": o["tps"],
                "avgResponseMs": o["avg_ms"],
                "requiredParams": [{"name": p["name"], "kr": p["kr"], "type": p["type"], "sample": p["sample"]} for p in business],
                "optionalParamCount": len([p for p in o["params"] if not p["required"]]),
                "responseFields": [{"name": f["name"], "kr": f["kr"], "type": f["type"], "required": f["required"], "multiplicity": f["multiplicity"]} for f in o["fields"] if not f.get("nested")],
                "responseFieldCount": len(o["fields"]),
                "inputSourceCandidates": depends,
                "dependencyNote": "필수 식별 파라미터 " + ", ".join(needs_ids) + "는 선행 오퍼레이션 응답에서 얻는 값으로 보이며, 후보는 같은 이름의 필드를 응답에 가진 목록형 오퍼레이션이다(이름 기준 추정, R04에서 확인)" if needs_ids else None,
                "verification": {
                    "state": "LIVE_VERIFIED" if (live or o["name"] in LIVE_VERIFIED_2026_11_03) else "SPEC_ONLY",
                    "evidence": ("2026-10-29 실호출 확인(응답 형식이 명세와 일치, tests/unit/public-live.test.ts)" if live else (LIVE_VERIFIED_EVIDENCE_2026_11_03 if o["name"] in LIVE_VERIFIED_2026_11_03 else "명세서 확인만 함. 실호출 없음")),
                    "verifiedAt": REGISTRY_DATE if live else ("2026-11-03" if o["name"] in LIVE_VERIFIED_2026_11_03 else None),
                },
                # 명세서로는 알 수 없는 항목: 확인 전까지 '미정'이며 점검 결과를 정상으로 세지 않는다 (PRD 3-3, 5-2-3)
                "approval": "CONFIRMED_BY_USER_2026_10_29" if live else "APPROVED",
                "probe": probe_of(f"{d['service_id']}/{o['name']}"),
                "noDataPolicy": "UNDEFINED",
                "quota": USER_QUOTA,
                # 승인은 확인됐지만 점검에 쓸 유효 입력값(probe.input)은 아직 정하지 않았다. 정하기 전에는 요청을 보내지 않고 검증 불가로 둔다
                "availabilityBeforeProbe": None if live or o["name"] in LIVE_VERIFIED_2026_11_03 or f"{d['service_id']}/{o['name']}" in PROBE_INPUTS else "UNVERIFIED:NO_VALID_INPUT",
            }
        )
    services.append(
        {
            "no": d["no"],
            "serviceId": d["service_id"],
            "name": d["name"],
            "nameEn": d["name_en"],
            "baseUrl": d["base_url"],
            "version": d.get("version"),
            "deployedAt": d.get("deployed"),
            "specFile": d["file"],
            "operations": ops,
        }
    )

doc_nums = sorted(d["no"] for d in docs)
service_numbers = sorted(int(s["serviceId"].split("-")[-1]) for s in services)
registry = {
    "registryVersion": 1,
    "generatedAt": REGISTRY_DATE,
    "source": "온비드 OpenAPI 활용가이드(명세서) 25개 — 로컬 폴더, 공공데이터포털 공식 문서와의 대조는 사용자 확인 필요",
    "targetServices": TARGET_SERVICES,
    "confirmedServices": len(services),
    "unconfirmedServices": TARGET_SERVICES - len(services),
    "unresolved": [
        {
            "slot": "26번째 서비스",
            "state": "UNCONFIRMED",
            "note": "명세서 파일 번호 " + ", ".join(f"{n:02d}" for n in range(1, 27) if n not in doc_nums)
            + "번이 없고, 서비스ID(SVC-API-NNN)도 "
            + ", ".join(f"{n:03d}" for n in range(1, max(service_numbers) + 1) if n not in service_numbers)
            + "번이 없다. 26종의 정확한 구성은 공공데이터포털 공식 목록과 대조해야 확정된다. 확정 전에는 이 슬롯을 점검 대상·분모에 넣지 않고 '미확정'으로 표시한다.",
        }
    ],
    "common": {
        "allowedHosts": ["apis.data.go.kr"],
        "method": "GET",
        "responseTypes": ["json", "xml"],
        "commonRequestParams": list(COMMON_REQUEST),
        "resultCodes": [{"code": k, "message": v["message"], "description": v["description"]} for k, v in sorted(common_codes.items())],
        "resultCodesDifferInDocs": differing,
    },
    "services": services,
}

out_json = os.path.join(root_dir, "data", "registry", "api-registry.json")
os.makedirs(os.path.dirname(out_json), exist_ok=True)
with open(out_json, "w", encoding="utf-8", newline="") as f:
    f.write(json.dumps(registry, ensure_ascii=False, indent=2) + "\n")

# ---------------------------------------------------------------- 사람이 읽는 문서
n_ops = sum(len(s["operations"]) for s in services)
n_live = sum(1 for s in services for o in s["operations"] if o["verification"]["state"] == "LIVE_VERIFIED")
lines = []
w = lines.append
w("# 온비드 OpenAPI 서비스 등록부 (R01 확정판)")
w("")
w("> 이 문서는 `data/registry/api-registry.json`에서 `python scripts/build-api-registry.py <명세서 폴더>`로 만든다. 손으로 고치지 않는다.")
w(f"> 확정일: {REGISTRY_DATE} · 출처: 로컬 활용가이드(명세서) 25개. API는 이 작업에서 한 번도 호출하지 않았다.")
w("")
w("## 1. 확정 결과")
w("")
w(f"- **관리 목표 {TARGET_SERVICES}종 중 {len(services)}종의 명세를 확인해 등록했고, {TARGET_SERVICES - len(services)}종은 미확정**이다. 미확정 슬롯은 점검 대상·분모에 넣지 않는다.")
w(f"- 등록한 오퍼레이션은 {n_ops}개이며, 이 중 실제 호출로 응답 형식을 확인한 것은 **{n_live}개**(부동산 물건목록·상세, 그리고 2026-11-03 사용자가 실행한 순위 3종·코드·주소·통계 4종·공고·입찰결과·동산·차량 목록·공고 상세 14개)다. 나머지 {n_ops - n_live}개는 명세서 확인만 했으므로 점검 결과가 나오기 전까지 `UNVERIFIED`로 취급한다(정상으로 세지 않음).")
w(f"- 미확정 1종의 단서: {registry['unresolved'][0]['note']}")
w("- 승인 상태·유효 샘플·무데이터 정책·점검 주기·호출 예산·Probe 방식은 명세서로 알 수 없어 **미정**이다. 임의로 채우지 않는다.")
w(f"- 결과코드표는 {'25개 문서가 모두 같다' if not differing else '문서마다 다른 곳이 있다: ' + ', '.join(differing)}.")
w("")
w("## 2. 서비스·오퍼레이션 표")
w("")
w("| 번호 | 서비스ID | 서비스명 | 오퍼레이션 | 호출 주소 | 업무 필수 파라미터 | 입력값 출처 후보 | 확인 상태 |")
w("|---|---|---|---|---|---|---|---|")
for s in services:
    for o in s["operations"]:
        req = ", ".join(p["name"] for p in o["requiredParams"]) or "(공통 항목만)"
        dep = ", ".join(x.split("/")[-1] for x in o["inputSourceCandidates"]) or "-"
        state = "실호출 확인" if o["verification"]["state"] == "LIVE_VERIFIED" else "명세만 확인"
        w(f"| {s['no']:02d} | {s['serviceId']} | {s['name']} | `{o['operationId']}` | `{o['url']}` | {req} | {dep} | {state} |")
w("")
w("> '입력값 출처 후보'는 필수 식별 파라미터(물건관리번호·공매조건번호·공고관리번호)를 얻을 수 있는 목록형 오퍼레이션의 **후보**이며, 파라미터 이름만 보고 추정한 것이다. 실제로 어떤 목록을 쓸지는 R04에서 확인한다.")
w("")
w("## 3. 공통")
w("")
w(f"- 허용 호스트: `apis.data.go.kr` · HTTPS · 읽기 전용 GET · 응답 형식 JSON/XML(`resultType`)")
w(f"- 공통 요청 항목: {', '.join('`' + p + '`' for p in COMMON_REQUEST)}")
w("")
w("| 결과코드 | 메시지 | 설명 |")
w("|---|---|---|")
for code in registry["common"]["resultCodes"]:
    w(f"| {code['code']} | {code['message']} | {code['description']} |")
w("")
w("## 4. 읽기에서 확인한 문제")
w("")
if problems:
    for p in problems:
        w(f"- {p}")
else:
    w("- 명세서 25개 모두 서비스ID·운영 URL·오퍼레이션·요청 항목·응답 항목을 읽었다.")
missing_tps = [f"{s['serviceId']}/{o['operationId']}" for s in services for o in s["operations"] if o["tpsLimit"] is None]
if missing_tps:
    w(f"- 명세서에 초당 최대 호출 수가 적혀 있지 않은 오퍼레이션 {len(missing_tps)}개: " + ", ".join(f"`{x}`" for x in missing_tps) + ". 다른 서비스의 값(초당 10회)을 가져다 쓰지 않고 R04에서 확인한다.")
w("")
with open(os.path.join(root_dir, "docs", "api-registry.md"), "w", encoding="utf-8", newline="") as f:
    f.write("\n".join(lines) + "\n")

print(f"서비스 {len(services)}개, 오퍼레이션 {n_ops}개(실호출 확인 {n_live}개), 읽기 문제 {len(problems)}건, 결과코드표 불일치 문서 {differing or '없음'}")
for p in problems:
    print(" -", p)

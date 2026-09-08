# WeCover 원인 파악 지식 연구 — 2026-09-06

## 범위와 판정

Charlotte–Mecklenburg의 Plumbing, HVAC, handyman-safe 원격 접수에 필요한 안전한 triage 지식을 조사했다. 원격 챗봇은 원인을 확정하지 않고 증상별 가능성을 좁히며, 위험 신호가 있으면 진단·견적보다 대피와 공공기관 연락을 우선한다.

판정: 기존 지식은 대표적인 누수·화장실·수전·온수기·AC·창호 사례를 다루지만, CO 경보/증상, 연료 연소 장치, 오수 역류, 누수 후 곰팡이, 반복 차단기 트립, 열펌프 제상과 보조난방, 허가·면허 경계가 부족하다. 아래 계약으로 보강해야 한다.

## 개발 지식 계약

각 기록은 다음을 가져야 한다.

- EN/ES 제목과 구분 질문
- 관찰된 증상 신호의 AND 그룹
- 복수의 가능한 원인(확정 진단 금지)
- 사용자가 분해 없이 수행할 수 있는 안전한 관찰
- 즉시 중단·대피·911/utility/professional 전환을 유발하는 red flag
- 현장 점검 필수 표시와 원격 판단 한계
- HTTPS 출처, 접근일, 관할권

## 안전 우선 규칙

1. CO 경보 또는 두통·어지럼·구역·혼란 등 CO 의심 증상: 전원 신선한 공기로 대피하고 밖에서 911. 재진입 금지.
2. 가스 냄새·누출 의심: 스위치·전화·불꽃을 실내에서 사용하지 말고 즉시 대피, 밖에서 911 또는 가스회사 연락.
3. 오수/오염수 역류: 접촉 차단, 어린이·반려동물 격리, 전문 오염수 복구 요청.
4. 물이 전기설비에 닿거나 스파크·타는 냄새·반복 차단기 트립: 접근·재투입 금지, 긴급/자격 전문가 전환.
5. 처진 천장·빠른 구조 움직임·급격한 침수: 접근 차단과 긴급 평가.
6. 냉매 회로, 연소 조정, 열교환기, 가스압, 내부 전기패널은 사용자 작업으로 안내하지 않는다.

## 증상별 추가 지식

- 여러 배수구 동시 역류/오수 상승: 사설 배수관 막힘, sewer lateral 또는 공공 하수 문제 가능. 오수 접촉을 피하고 Charlotte Water/311 및 전문 배관업체로 전환.
- 누수 후 24–48시간 이상 젖은 자재/곰팡이: 수분원 해결이 우선. 약 10ft² 초과, 오염수 원인, HVAC 오염, 고위험 거주자는 전문 복구.
- AC 무가동: thermostat, 전원, 필터/공기흐름, condensate safety 가능성을 구분하되 차단기는 한 번만 확인하고 반복 트립은 전문가 호출.
- AC 가동하나 냉방 불량/결빙: 막힌 필터·공기흐름, 코일, 냉매 문제 가능. 냉방을 끄고 패널·냉매를 만지지 않는다.
- Furnace 단주기/미온풍: thermostat·필터·공기흐름과 점화/연소/배기 문제를 구분. 황색 불꽃·그을음·폭발음·배기가스는 즉시 중지.
- Heat pump 서리: 얇은 일시적 서리는 정상 제상일 수 있으나 지속 결빙, setpoint 미도달, 상시 auxiliary heat, 급격한 전기료 상승은 고장 신호.
- 반복 breaker trip/타는 냄새/스파크: 단순 reset을 반복하지 않고 전기·HVAC 전문가에게 전환.
- permit 경계: Charlotte–Mecklenburg에서 plumbing/mechanical system의 설치·연장·변경·일반 수리는 허가 대상일 수 있다. homeowner permit은 소유·주거·본인 시공 조건이 있고 trade certificate가 필요하다. 챗봇은 허가 필요 여부를 단정하지 않고 Mecklenburg Code Enforcement 확인을 안내한다.

## 공식 출처

- Mecklenburg County Code Enforcement — Permitting: https://code.mecknc.gov/permitting
- Mecklenburg County — Homeowner Internet Permitting: https://code.mecknc.gov/permitting/hip
- Mecklenburg County — Trade Internet Permitting: https://code.mecknc.gov/permitting/tip
- Mecklenburg County Code support: https://code.mecknc.gov/support
- EPA — Mold Cleanup in Your Home: https://www.epa.gov/mold/mold-cleanup-your-home
- EPA — Flood Cleanup and Indoor Air: https://www.epa.gov/emergencies-iaq/flood-cleanup-protect-indoor-air-and-your-health
- EPA — Carbon Monoxide factsheet: https://www.epa.gov/indoor-air-quality-iaq/carbon-monoxide-poisoning-protect-your-family-and-yourself-factsheet
- CDC — Carbon Monoxide Poisoning Basics: https://www.cdc.gov/carbon-monoxide/about/index.html
- CDC — Mold cleanup: https://www.cdc.gov/mold-health/about/clean-up.html
- ENERGY STAR — HVAC maintenance guidance: https://www.energystar.gov/saveathome/heating-cooling/maintenance-checklist
- U.S. DOE — Air conditioner maintenance: https://www.energy.gov/energysaver/maintaining-your-air-conditioner
- EPA — Section 608 technician certification: https://www.epa.gov/section608/section-608-technician-certification-0
- CPSC — Carbon monoxide safety: https://www.cpsc.gov/Safety-Education/Safety-Education-Centers/Carbon-Monoxide-Information-Center

## 구현 권고

- `server/intake/knowledge/sources.ts`: 공식 출처를 source metadata로 등록.
- `records.ts`: CO, sewage, mold/moisture, furnace combustion, HVAC electrical, heat-pump frost/aux heat 기록 추가.
- retrieval은 red flag 문구가 있는 emergency 기록을 일반 후보보다 우선하도록 검증.
- provider prompt는 출처를 가설 근거로만 사용하고 위험 DIY·원격 확진을 금지.
- 평가 fixture에 EN/ES, 오타, 복합 증상, 안전 red flag, no-match를 포함.

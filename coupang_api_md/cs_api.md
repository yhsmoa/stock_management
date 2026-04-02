# 쿠팡 CS API (Customer Service APIs)

> 출처: https://developers.coupangcorp.com/hc/ko/sections/360005081953
> Base URL: `https://api-gateway.coupang.com`
> 지원 지역: 한국, 대만

---

## 전체 API 목록 (6개)

### 조회 API (데이터 조회 가능) ✅

| # | API명 | Method | Endpoint | 설명 |
|---|-------|--------|----------|------|
| 1 | **상품별 고객문의 조회** | `GET` | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries` | 고객-판매자 간 Q&A 조회. 판매중인 제품에 대한 상담 조회 |
| 2 | **쿠팡 고객센터 문의조회** | `GET` | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/callCenterInquiries` | 고객이 쿠팡 고객센터에 접수한 문의 조회 |
| 3 | **쿠팡 고객센터 문의 단건 조회** | `GET` | `/v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/{inquiryId}` | 상담번호(inquiryId)로 단건 조회 |

### 답변/처리 API

| # | API명 | Method | 설명 |
|---|-------|--------|------|
| 4 | 상품별 고객문의 답변 | `PUT` | 고객문의(inquiryId)에 대해 답변 |
| 5 | 쿠팡 고객센터 문의답변 | `PUT` | 고객센터 접수 문의에 답변 (미답변 상태만 가능) |
| 6 | 쿠팡 고객센터 문의확인 | `PUT` | 업체이관 건에 대한 확인 처리 (미확인 TRANSFER 상태) |

---

## 데이터 조회 가능 항목 체크리스트

| 조회 대상 | 가능 여부 | 사용 API | 비고 |
|----------|----------|---------|------|
| 상품별 고객 Q&A 목록 | ✅ | 상품별 고객문의 조회 | vendorId 필요, 옵션아이템ID/기간 필터 가능 |
| 고객센터 문의 목록 | ✅ | 쿠팡 고객센터 문의조회 | vendorId 필요, 옵션아이템ID/기간 필터 가능 |
| 고객센터 문의 단건 상세 | ✅ | 쿠팡 고객센터 문의 단건 조회 | inquiryId 필요 |
| 문의 답변 이력 | ✅ | 조회 API에 포함 | 답변 상태/내용 포함 |
| 고객 이메일 | ❌ | - | 2026-03-15부터 buyerEmail 삭제됨 |
| 문의 통계/요약 | ❌ | - | API 미제공 |

---

## 주요 파라미터

### 상품별 고객문의 조회
- `vendorId` - 업체 ID (필수)
- `vendorItemId` - 옵션아이템 ID (선택)
- `startAt` / `endAt` - 조회 기간
- `answeredType` - 답변 상태 필터

### 쿠팡 고객센터 문의조회
- `vendorId` - 업체 ID (필수)
- `vendorItemId` - 옵션아이템 ID (선택)
- `startAt` / `endAt` - 조회 기간
- `inquiryStatus` - 문의 상태 필터

### 문의 상태값
| 상태 | 설명 |
|------|------|
| `progress` | 미답변 |
| `completed` | 답변완료 |
| `TRANSFER` | 업체이관 (미확인) |

---

## 주의사항
- 과도한 고객센터 문의 조회 시 시스템에 의해 **자동 차단** 될 수 있음
- 2026년 3월 15일부터 상품 검색을 통한 고객 문의 API 응답에서 `buyerEmail` 입력란 **삭제**

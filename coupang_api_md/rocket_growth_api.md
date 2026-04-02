# 쿠팡 로켓그로스 API (Rocket Growth APIs)

> 출처: https://developers.coupangcorp.com/hc/ko/sections/35157469062553
> Base URL: `https://api-gateway.coupang.com`
> 지원 지역: 한국

---

## 전체 API 목록 (9개)

### 조회 API (데이터 조회 가능) ✅

| # | API명 | Method | Endpoint | 설명 |
|---|-------|--------|----------|------|
| 1 | **로켓그로스 주문 API (목록 쿼리)** | `GET` | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders` | 주문 목록 조회. 주문 동기화, 수요 분석 용도. 출고일 이후 주문 지원 |
| 2 | **로켓그로스 주문 API (단건)** | `GET` | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/order/{orderId}` | orderId로 단건 주문 상세 조회 |
| 3 | **로켓창고 재고 API** | `GET` | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries` | 쿠팡 로켓 물류센터 재고 정보 조회 |
| 4 | **상품 목록 페이징 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?businessTypes=rocketGrowth` | 로켓그로스 상품 목록 페이징 조회 |
| 5 | **상품 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}` | sellerProductId로 로켓그로스 상품 상세 조회 |
| 6 | **카테고리 메타 정보 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/{displayCategoryCode}` | 카테고리별 고시정보, 옵션, 구비서류, 인증정보 조회 |
| 7 | **카테고리 목록 조회 (로켓그로스)** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories?registrationType=RFM` | 로켓그로스 운영 카테고리 전체 목록 조회 |

### 생성/수정 API

| # | API명 | Method | 설명 |
|---|-------|--------|------|
| 8 | 상품 생성 (로켓그로스) | `POST` | 로켓그로스 상품 등록 (WING에서 사전 설정 필요) |
| 9 | 상품 수정 (로켓그로스) | `PUT` | 로켓그로스 상품 정보 수정 |

---

## 데이터 조회 가능 항목 체크리스트

| 조회 대상 | 가능 여부 | 사용 API | 비고 |
|----------|----------|---------|------|
| 로켓그로스 주문 목록 | ✅ | 주문 API (목록 쿼리) | vendorId 필요, 출고일 이후 주문만 |
| 주문 단건 상세 | ✅ | 주문 API (단건) | orderId 필요 |
| 로켓창고 재고 현황 | ✅ | 로켓창고 재고 API | vendorId 필요, 물류센터별 재고 |
| 로켓그로스 상품 목록 | ✅ | 상품 목록 페이징 조회 | businessTypes=rocketGrowth 파라미터 |
| 로켓그로스 상품 상세 | ✅ | 상품 조회 | sellerProductId 필요 |
| 운영 카테고리 목록 | ✅ | 카테고리 목록 조회 | registrationType=RFM 파라미터 |
| 카테고리 메타 정보 | ✅ | 카테고리 메타 정보 조회 | displayCategoryCode 필요 |
| 로켓그로스 정산 내역 | ❌ | - | 정산 API 별도 확인 필요 |
| 입고/출고 이력 | ❌ | - | API 미제공 |
| 반품/교환 상세 | ❌ | - | 로켓그로스 전용 반품/교환 API 미제공 |

---

## API Provider 경로 구분

| Provider | 경로 접두사 | 용도 |
|----------|-----------|------|
| `rg_open_api` | `/v2/providers/rg_open_api/apis/api/v1/` | 로켓그로스 전용 (주문, 재고) |
| `seller_api` | `/v2/providers/seller_api/apis/api/v1/marketplace/` | 마켓플레이스 공용 (상품, 카테고리) |

> 상품/카테고리 API는 기존 마켓플레이스 API와 동일한 endpoint를 사용하며,
> `businessTypes=rocketGrowth` 또는 `registrationType=RFM` 파라미터로 로켓그로스를 구분합니다.

---

## 주요 파라미터

### 주문 목록 쿼리
- `vendorId` - 업체 ID (필수)
- 주문 동기화, 주문 조사, 수요 분석 등에 활용
- **출고일 이후** 주문만 지원

### 로켓창고 재고 API
- `vendorId` - 업체 ID (필수)
- 쿠팡 국내 로켓 물류센터 재고 요약 정보 조회

### 상품 목록 페이징 조회
- 기존 상품 목록 페이징 조회 API에 `businessTypes=rocketGrowth` 파라미터 추가
- 로켓그로스 단독 + 마켓플레이스/로켓그로스 동시 운영 상품 모두 조회

---

## 주의사항
- 로켓그로스 상품 생성 시 **WING 플랫폼에서 사전 설정** 필요
- 로켓그로스 상품은 마켓플레이스(판매자배송)와 **동시 운영** 가능
- 상품 조회/수정 시 로켓그로스 전용 필드가 추가되어 있음

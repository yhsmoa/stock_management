# 쿠팡 상품 API (Product APIs)

> 출처: https://developers.coupangcorp.com/hc/ko/sections/360005046534
> Base URL: `https://api-gateway.coupang.com`

---

## 전체 API 목록 (22개)

### 조회/검색 API (데이터 조회 가능) ✅

| # | API명 | Method | Endpoint | 설명 |
|---|-------|--------|----------|------|
| 1 | **상품 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}` | sellerProductId로 상품 상세 정보 조회. 옵션ID(vendorItemId) 확인 가능 |
| 2 | **상품 조회 (승인불필요)** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/partial` | 배송/반품지 등 관련 정보 조회 (승인 불필요 항목) |
| 3 | **상품 등록 현황 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/inflow-status` | 등록 가능 상품수 / 현재 등록된 상품수 조회 |
| 4 | **상품 목록 페이징 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` | 등록상품 목록 페이징 조회 (한국, 대만 지원) |
| 5 | **상품 목록 구간 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/time-frame` | 생성일시 기준 상품 목록 조회 (최대 10분 구간) |
| 6 | **상품 상태변경이력 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/histories` | sellerProductId로 상품 상태변경 이력 조회 |
| 7 | **상품 요약 정보 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/external-vendor-sku-codes/{externalVendorSkuCode}` | 판매자 상품코드(externalVendorSku)로 요약 정보 조회 |
| 8 | **상품 아이템별 수량/가격/상태 조회** | `GET` | `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories` | vendorItemId로 재고수량, 판매가격, 판매상태 조회 |

### 생성/수정/삭제 API

| # | API명 | Method | 설명 |
|---|-------|--------|------|
| 9 | 상품 생성 | `POST` | 상품 등록 (카테고리, 고시정보, 옵션 등 필요) |
| 10 | 상품 승인 요청 | `PUT` | 임시저장 상태 → 승인요청 → 승인완료 |
| 11 | 상품 수정 (승인필요) | `PUT` | 상품 정보 전체 수정 (승인 필요) |
| 12 | 상품 수정 (승인불필요) | `PUT` | 배송/반품지 관련 정보 빠른 수정 |
| 13 | 상품 삭제 | `DELETE` | 상품 삭제 (모든 옵션 판매중지 상태여야 가능) |
| 14 | 상품 아이템별 수량 변경 | `PUT` | 재고수량 변경 (vendorItemId 필요) |
| 15 | 상품 아이템별 가격 변경 | `PUT` | 판매가격 변경 (vendorItemId 필요) |
| 16 | 상품 아이템별 판매 재개 | `PUT` | 판매상태 → 판매중 |
| 17 | 상품 아이템별 판매 중지 | `PUT` | 판매상태 → 판매중지 |
| 18 | 상품 아이템별 할인율 기준가격 변경 | `PUT` | 할인율 기준가격 변경 |
| 19 | 자동생성옵션 활성화 (옵션 상품 단위) | `POST` | 개별 옵션상품 자동생성옵션 활성화 |
| 20 | 자동생성옵션 활성화 (전체 상품 단위) | `POST` | 전체 상품 자동생성옵션 활성화 |
| 21 | 자동생성옵션 비활성화 (옵션 상품 단위) | `POST` | 개별 옵션상품 자동생성옵션 비활성화 |
| 22 | 자동생성옵션 비활성화 (전체 상품 단위) | `POST` | 전체 상품 자동생성옵션 비활성화 |

---

## 데이터 조회 가능 항목 체크리스트

| 조회 대상 | 가능 여부 | 사용 API | 비고 |
|----------|----------|---------|------|
| 개별 상품 상세 정보 | ✅ | 상품 조회 | sellerProductId 필요 |
| 상품 배송/반품지 정보 | ✅ | 상품 조회 (승인불필요) | sellerProductId 필요 |
| 전체 상품 목록 | ✅ | 상품 목록 페이징 조회 | 페이지 단위 조회 |
| 기간별 상품 목록 | ✅ | 상품 목록 구간 조회 | 최대 10분 구간, 생성일시 기준 |
| 상품 등록 현황 (쿼터) | ✅ | 상품 등록 현황 조회 | 등록 가능/현재 등록 수 |
| 상품 상태 변경 이력 | ✅ | 상품 상태변경이력 조회 | sellerProductId 필요 |
| 판매자 SKU로 상품 검색 | ✅ | 상품 요약 정보 조회 | externalVendorSkuCode 필요 |
| 아이템별 재고/가격/상태 | ✅ | 아이템별 수량/가격/상태 조회 | vendorItemId 필요 |
| 상품명 키워드 검색 | ❌ | - | API 미제공 |
| 카테고리별 상품 필터링 | ❌ | - | API 미제공 (페이징 조회로 전체 순회 필요) |
| 상품 판매 통계 | ❌ | - | 정산 API에서 일부 확인 가능 |

---

## 주요 파라미터

### 상품 목록 페이징 조회 Query Parameters
- `vendorId` - 업체 ID
- `nextToken` - 다음 페이지 토큰
- `maxPerPage` - 페이지당 최대 건수
- `status` - 상품 상태 필터

### 상품 목록 구간 조회 Query Parameters
- `vendorId` - 업체 ID
- `createdAt` - 조회 시작 일시
- `searchType` - 조회 유형
- 최대 조회 범위: **10분**

### 핵심 식별자
- `sellerProductId` - 등록상품 ID (상품 단위)
- `vendorItemId` - 옵션 ID (아이템/SKU 단위)
- `externalVendorSkuCode` - 판매자 상품코드 (외부 SKU)

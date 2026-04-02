# 쿠팡 Open API - 상품 조회 가이드

## 개요

등록상품 ID(`sellerProductId`)로 등록된 상품의 정보를 조회하는 API입니다.

**주요 용도:**
- 상품 가격/재고/판매상태 수정 시 필요한 옵션ID(`vendorItemId`) 확인
- 상품 정보 조회 후 상품 수정에 활용할 수 있는 전문 획득

> API 적용 가능한 구매자 사용자 지역: **한국**

---

## 요청 (Request)

### Endpoint

```
GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}
```

### Base URL

```
https://api-gateway.coupang.com
```

### Full URL 예시

```
https://api-gateway.coupang.com/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/123459542
```

### Path Parameter

| Name              | Required | Type   | Description                          |
|-------------------|----------|--------|--------------------------------------|
| sellerProductId   | O        | Number | 등록상품ID (상품 생성 시 결과 값으로 획득한 ID) |

### Request Body

```
없음 (not require body)
```

---

## 응답 (Response)

### 최상위 필드

| Name    | Type   | Description            |
|---------|--------|------------------------|
| code    | String | 결과코드 (SUCCESS / ERROR) |
| message | String | 메시지                   |
| data    | Object | 상품 데이터 본문             |

### data 객체 주요 필드

| Name                     | Type    | Description                                          |
|--------------------------|---------|------------------------------------------------------|
| sellerProductId          | Number  | 등록상품ID                                              |
| statusName               | String  | 등록상품상태 (심사중/임시저장/승인대기중/승인완료/부분승인완료/승인반려/상품삭제) |
| displayCategoryCode      | Number  | 노출카테고리코드                                           |
| sellerProductName        | String  | 등록상품명 (발주서에 사용되는 상품명)                              |
| vendorId                 | String  | 판매자ID (쿠팡에서 업체에게 발급한 고유 코드)                       |
| saleStartedAt            | String  | 판매시작일시 (`yyyy-MM-dd'T'HH:mm:ss`)                  |
| saleEndedAt              | String  | 판매종료일시 (`yyyy-MM-dd'T'HH:mm:ss`)                  |
| displayProductName       | String  | 노출상품명 (쿠팡 판매페이지에서 노출될 상품명)                        |
| brand                    | String  | 브랜드                                                 |
| generalProductName       | String  | 제품명                                                 |
| productGroup             | String  | 상품군                                                 |

### 배송 관련 필드

| Name                     | Type   | Description          | 값                                                                  |
|--------------------------|--------|----------------------|--------------------------------------------------------------------|
| deliveryMethod           | String | 배송방법                | SEQUENCIAL(일반배송), COLD_FRESH(신선냉동), MAKE_ORDER(주문제작), AGENT_BUY(구매대행), VENDOR_DIRECT(설치배송/판매자직접전달) |
| deliveryCompanyCode      | String | 택배사 코드              | 별도 코드표 참조                                                         |
| deliveryChargeType       | String | 배송비종류               | FREE(무료), NOT_FREE(유료), CHARGE_RECEIVED(착불), CONDITIONAL_FREE(조건부무료) |
| deliveryCharge           | Number | 기본배송비               | 유료/조건부 무료배송 시 편도 배송비                                              |
| freeShipOverAmount       | Number | 조건부 무료배송 기준 금액     | 무료배송인 경우 0                                                        |
| deliveryChargeOnReturn   | Number | 초도반품배송비             | 무료배송 시 반품 소비자 부담 배송비                                              |
| returnCharge             | Number | 반품배송비(편도)           | 반품회수시 편도 배송비                                                      |
| remoteAreaDeliverable    | String | 도서산간 배송여부           | Y / N                                                              |
| unionDeliveryType        | String | 묶음배송 여부             | UNION_DELIVERY / NOT_UNION_DELIVERY                                |
| outboundShippingPlaceCode| Number | 출고지주소코드             | 묶음배송 시 필수                                                         |

### 반품지 정보

| Name                  | Type   | Description  |
|-----------------------|--------|--------------|
| returnCenterCode      | String | 반품지센터코드     |
| returnChargeName      | String | 반품지담당자명     |
| companyContactNumber  | String | 반품지연락처      |
| returnZipCode         | String | 반품지우편번호     |
| returnAddress         | String | 반품지주소       |
| returnAddressDetail   | String | 반품지주소상세     |

### items (업체상품옵션 목록) 주요 필드

| Name                        | Type    | Description                     |
|-----------------------------|---------|---------------------------------|
| sellerProductItemId         | Number  | 업체상품옵션아이디                      |
| vendorItemId                | Number  | 옵션아이디 (승인완료 시 값 표시)            |
| itemName                    | String  | 업체상품옵션명                         |
| originalPrice               | Number  | 할인율기준가                          |
| salePrice                   | Number  | 판매가격                            |
| maximumBuyCount             | Number  | 판매가능수량 (재고)                     |
| maximumBuyForPerson         | Number  | 인당 최대 구매 수량 (0=제한없음)           |
| maximumBuyForPersonPeriod   | Number  | 최대 구매 수량 기간 (일)                |
| outboundShippingTimeDay     | Number  | 기준출고일 (일 단위)                   |
| adultOnly                   | String  | 19세이상 여부 (ADULT_ONLY/EVERYONE) |
| taxType                     | String  | 과세여부 (TAX/FREE)                |
| parallelImported            | String  | 병행수입여부                          |
| overseasPurchased           | String  | 해외구매대행여부                        |
| externalVendorSku           | String  | 판매자상품코드                         |
| barcode                     | String  | 바코드                             |
| modelNo                     | String  | 모델번호                            |
| offerCondition              | String  | 상품상태 (NEW/REFURBISHED/USED_BEST/USED_GOOD/USED_NORMAL) |

### items 하위 - images

| Name       | Type   | Description                     |
|------------|--------|---------------------------------|
| imageOrder | Number | 이미지 표시순서 (0, 1, 2...)           |
| imageType  | String | REPRESENTATION(대표이미지), DETAIL(기타이미지), USED_PRODUCT(중고상태이미지) |
| cdnPath    | String | 쿠팡 CDN 경로                       |
| vendorPath | String | 업체 이미지 경로                       |

### items 하위 - attributes (옵션)

| Name               | Type   | Description                          |
|--------------------|--------|--------------------------------------|
| attributeTypeName  | String | 옵션타입명 (예: 수량, 개당 용량 등)              |
| attributeValueName | String | 옵션값                                  |
| exposed            | String | EXPOSED(구매옵션) / NONE(검색옵션)           |
| editable           | String | 수정 가능 여부 (true/false)               |

### items 하위 - notices (상품고시정보)

| Name                      | Type   | Description       |
|---------------------------|--------|-------------------|
| noticeCategoryName        | String | 상품고시정보 카테고리명     |
| noticeCategoryDetailName  | String | 상품고시정보 카테고리 상세명 |
| content                   | String | 내용               |

### items 하위 - contents (상세 컨텐츠)

| Name           | Type   | Description                                                    |
|----------------|--------|----------------------------------------------------------------|
| contentsType   | String | IMAGE, IMAGE_NO_SPACE, TEXT, IMAGE_TEXT, TEXT_IMAGE, IMAGE_IMAGE, TEXT_TEXT, TITLE, HTML |
| contentDetails | List   | 상세 컨텐츠 목록                                                     |
| content        | String | 내용                                                             |
| detailType     | String | IMAGE / TEXT                                                   |

---

## 응답 예시 (Response Example)

```json
{
  "code": "SUCCESS",
  "message": "",
  "data": {
    "sellerProductId": 123459542,
    "sellerProductName": "test_클렌징오일_관리용_상품명",
    "displayCategoryCode": 56137,
    "vendorId": "A0001235",
    "saleStartedAt": "2019-01-09T18:41:14",
    "saleEndedAt": "2099-01-01T23:59:59",
    "displayProductName": "해피바스 솝베리 클렌징 오일",
    "brand": "해피바스",
    "generalProductName": "솝베리 클렌징 오일",
    "productGroup": "클렌징 오일",
    "statusName": "승인완료",
    "deliveryMethod": "VENDOR_DIRECT",
    "deliveryCompanyCode": "KDEXP",
    "deliveryChargeType": "FREE",
    "deliveryCharge": 0,
    "freeShipOverAmount": 0,
    "deliveryChargeOnReturn": 2500,
    "returnCharge": 2500,
    "unionDeliveryType": "UNION_DELIVERY",
    "returnCenterCode": "1234274592",
    "returnChargeName": "반품지_1",
    "companyContactNumber": "02-1234-678",
    "returnZipCode": "06168",
    "returnAddress": "서울특별시 강남구 삼성동",
    "returnAddressDetail": "1-23 19층",
    "outboundShippingPlaceCode": 74010,
    "vendorUserId": "wing_loginId_123",
    "requested": false,
    "items": [
      {
        "offerCondition": "NEW",
        "sellerProductItemId": 1271845812,
        "vendorItemId": 4279191312,
        "itemName": "200ml_1개_(변경될수있음)",
        "originalPrice": 0,
        "salePrice": 1280960,
        "maximumBuyCount": 1,
        "maximumBuyForPerson": 0,
        "outboundShippingTimeDay": 2,
        "adultOnly": "EVERYONE",
        "taxType": "TAX",
        "parallelImported": "NOT_PARALLEL_IMPORTED",
        "overseasPurchased": "NOT_OVERSEAS_PURCHASED",
        "externalVendorSku": "0001",
        "pccNeeded": false,
        "emptyBarcode": true,
        "emptyBarcodeReason": "상품확인불가_바코드없음사유",
        "modelNo": "171717",
        "images": [
          {
            "imageOrder": 0,
            "imageType": "REPRESENTATION",
            "cdnPath": "vendor_inventory/images/.../image.jpg",
            "vendorPath": "151009021007000006.jpg"
          }
        ],
        "notices": [
          {
            "noticeCategoryName": "화장품",
            "noticeCategoryDetailName": "용량(중량)",
            "content": "상세페이지 참조"
          }
        ],
        "attributes": [
          {
            "attributeTypeName": "수량",
            "attributeValueName": "1개",
            "exposed": "EXPOSED",
            "editable": true
          },
          {
            "attributeTypeName": "개당 용량",
            "attributeValueName": "200ml",
            "exposed": "EXPOSED",
            "editable": true
          }
        ],
        "contents": [
          {
            "contentsType": "TEXT",
            "contentDetails": [
              {
                "content": "<div>...</div>",
                "detailType": "TEXT"
              }
            ]
          }
        ],
        "searchTags": ["검색어1", "검색어2"]
      }
    ],
    "manufacture": "제조사_테스트",
    "bundleInfo": {
      "bundleType": "SINGLE"
    }
  }
}
```

---

## Python 호출 예시

```python
import hmac
import hashlib
import time
import requests

# 인증 정보
SECRET_KEY = "your-secret-key"
ACCESS_KEY = "your-access-key"

# 요청 정보
method = "GET"
path = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/123459542"
base_url = "https://api-gateway.coupang.com"

# HMAC 서명 생성
datetime_now = time.strftime("%y%m%dT%H%M%SZ", time.gmtime())
message = datetime_now + method + path

signature = hmac.new(
    SECRET_KEY.encode("utf-8"),
    message.encode("utf-8"),
    hashlib.sha256
).hexdigest()

authorization = (
    f"CEA algorithm=HmacSHA256, "
    f"access-key={ACCESS_KEY}, "
    f"signed-date={datetime_now}, "
    f"signature={signature}"
)

# API 호출
url = base_url + path
headers = {
    "Authorization": authorization,
    "Content-Type": "application/json;charset=UTF-8"
}

response = requests.get(url, headers=headers)
data = response.json()

# 결과 확인
if data["code"] == "SUCCESS":
    product = data["data"]
    print(f"상품명: {product['displayProductName']}")
    print(f"브랜드: {product['brand']}")
    print(f"상태: {product['statusName']}")

    for item in product["items"]:
        print(f"  옵션: {item['itemName']}")
        print(f"  vendorItemId: {item['vendorItemId']}")
        print(f"  판매가: {item['salePrice']}")
        print(f"  재고: {item['maximumBuyCount']}")
else:
    print(f"에러: {data['message']}")
```

---

## 에러 코드

| HTTP 상태코드 | 오류 메시지 | 해결 방법 |
|------------|---------|---------|
| 400 | 상품 정보가 등록 또는 수정되고 있습니다. 잠시 후 다시 조회해 주시기 바랍니다. | 상품등록 요청 후 최소 10분 이후 재조회 |
| 400 | 업체[A00123456]는 다른 업체의 상품을 조회할 수 없습니다. | sellerProductId 값 확인 |
| 400 | 상품(123456789)의 데이터가 없습니다. | sellerProductId 값 확인 |
| 400 | 업체상품아이디[null]는 숫자형으로 입력해주세요. | sellerProductId를 올바른 숫자로 입력 |

---

## 참고

- **URL API Name:** `GET_PRODUCT_BY_PRODUCT_ID`
- **공식 문서:** https://developers.coupangcorp.com/hc/ko/articles/360033644994
- 승인완료 이후 가격/재고 수정은 별도 API 사용 필요 (옵션별 가격 변경, 옵션별 수량 변경 API)
- `vendorItemId`는 임시저장 상태에서는 null이며, 승인완료 후에 값이 생성됨

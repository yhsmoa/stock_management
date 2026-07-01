# 쿠팡 CS API 연동 가이드 (고객문의 / 쿠팡문의 2개 페이지 구성)

> 본 문서는 쿠팡 Open API의 CS APIs(상품별 고객문의 + 쿠팡 고객센터 문의)를
> 활용하여 자체 운영 사이트에 **"고객문의" / "쿠팡문의"** 두 개의 관리 페이지를
> 구축하기 위한 개발 가이드입니다.
>
> 참고 원문: https://developers.coupangcorp.com/hc/ko/sections/360005081953

---

## 0. 공통 사항

### 0-1. 사용 API 한눈에 보기

| 구분 | API | 메서드 | 엔드포인트 |
|---|---|---|---|
| 고객문의 | 상품별 고객문의 조회 | GET | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries` |
| 고객문의 | 상품별 고객문의 답변 | POST | `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies` |
| 쿠팡문의 | 쿠팡 고객센터 문의조회 | GET | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/callCenterInquiries` |
| 쿠팡문의 | 쿠팡 고객센터 문의 단건 조회 | GET | `/v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/{inquiryId}` |
| 쿠팡문의 | 쿠팡 고객센터 문의답변 | POST | `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/callCenterInquiries/{inquiryId}/replies` |
| 쿠팡문의 | 쿠팡 고객센터 문의확인 | POST | `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/callCenterInquiries/{inquiryId}/confirms` |

**Base URL**: `https://api-gateway.coupang.com`

### 0-2. 매우 중요한 제약 (반드시 숙지)

1. **조회 기간은 최대 7일**입니다. (`inquiryEndAt - inquiryStartAt <= 7days`)
   → 30일 단위 조회를 구현하려면 **7일 단위로 5번 분할 호출 후 병합**해야 합니다.
2. **상품별 고객문의(고객문의 페이지)**에서는 주문번호별 직접 조회 API가 없습니다.
   → 동일 `orderId`의 과거 문의를 찾으려면 기간 조회 결과의 `orderIds`를 클라이언트에서 필터링합니다.
3. **쿠팡 고객센터 문의 답변**의 상태가 24시간 이상 미답변이면 쿠팡이 자동 처리 멘트를 달고 "답변완료"로 전환됩니다. → 이후엔 API 답변 불가.
4. **답변 content**의 줄바꿈은 반드시 `\n` (이스케이프) 사용. CR(`\r`)은 400 에러 발생.
5. 동일 문의에 중복 답변 시 에러가 발생하므로, UI에서 답변 후 비활성화 처리 필수.
6. **타임아웃 발생 시**: 페이지 크기 10, 조회기간 1일로 재요청. 필요 시 `X-EXTENDED-TIMEOUT` 헤더 활용.

### 0-3. 인증

- 쿠팡 Open API HMAC 서명 방식(Authorization 헤더) 사용
- 필요 키: `Access Key`, `Secret Key`, `Vendor ID`
- 서버 사이드에서만 호출 (키 노출 금지)

---

## 1. 페이지 ① "고객문의" (상품별 고객문의)

### 1-1. 페이지 요구사항

1. 진입 시 **최근 30일 이내 "미답변(NOANSWER)"** 문의 리스트 표시
2. 문의 항목 클릭 → 상세정보 + 답변 입력
3. 상세 안에서 `orderId` 클릭 → 해당 주문의 **최근 30일 이내 이전 문의 내역** 조회
4. 답변 입력/전송 시 쿠팡에 반영

### 1-2. 데이터 흐름

```
[페이지 진입]
   └─> 7일 × 5회 분할 호출 (NOANSWER) → 클라이언트에서 inquiryAt 기준 merge/sort
        └─> 리스트 표시 (inquiryId, content, inquiryAt, orderIds, productId)
              └─> [행 클릭] 상세 패널 오픈
                    ├─> 응답 데이터 그대로 표시 (별도 단건 조회 API 없음)
                    │     - inquiryId, productId, sellerProductId, sellerItemId
                    │     - vendorItemId, content(질문), inquiryAt, orderIds
                    │     - commentDtoList[](기존 답변 이력)
                    ├─> [orderId 클릭]
                    │     └─> 같은 7일×5회 호출(ALL) 결과를 캐싱해두고
                    │          orderIds 에 해당 orderId 포함된 문의만 필터링
                    └─> [답변 입력 + 전송]
                          └─> POST onlineInquiries/{inquiryId}/replies
```

### 1-3. ① 30일 이내 미답변 조회 (리스트)

**Endpoint**
```
GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries
```

**Query Parameters**

| 이름 | 필수 | 값 | 설명 |
|---|---|---|---|
| vendorId | O | A0000xxxx | 판매자 ID |
| answeredType | O | `NOANSWER` | 미답변만 |
| inquiryStartAt | O | yyyy-MM-dd | 조회 시작일 |
| inquiryEndAt | O | yyyy-MM-dd | 조회 종료일 (시작일 + 7일 이내) |
| pageNum | - | 1 | 페이지 번호 |
| pageSize | - | 10 (최대 50) | 페이지 크기 |

**예시 (30일 조회용 분할 호출 의사 코드)**

```js
const today = new Date();
const ranges = [];
for (let i = 0; i < 5; i++) {
  const end   = addDays(today, -i * 7);
  const start = addDays(end, -6); // 7일 구간 (양끝 포함)
  ranges.push({ start: fmt(start), end: fmt(end) });
}

let all = [];
for (const r of ranges) {
  let page = 1;
  while (true) {
    const res = await getOnlineInquiries({
      vendorId, answeredType: 'NOANSWER',
      inquiryStartAt: r.start, inquiryEndAt: r.end,
      pageNum: page, pageSize: 50,
    });
    all = all.concat(res.data.content);
    if (page >= res.data.pagination.totalPages) break;
    page++;
  }
}
// inquiryId 기준 중복 제거 후 inquiryAt 내림차순 정렬
const uniq = dedupBy(all, 'inquiryId').sort((a,b)=>b.inquiryAt.localeCompare(a.inquiryAt));
```

**리스트 컬럼 추천**

- 문의일시 (`inquiryAt`)
- 문의내용 (`content`, 1줄 말줄임)
- 주문번호 (`orderIds[0]` / 여러 개일 경우 “외 N건”)
- 상품ID (`productId`) 또는 `vendorItemId`
- 상세보기 버튼

### 1-4. ② 문의 클릭 시 얻을 수 있는 정보

상품별 고객문의는 **단건 조회 API가 별도로 없으므로** 리스트 응답의 항목을
그대로 보여주거나, 클라이언트 캐시에서 꺼내 보여줍니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| inquiryId | Number | 질문(문의) ID |
| productId | Number | 노출상품 ID |
| sellerProductId | Number | 등록상품 ID |
| sellerItemId | Number | 판매자 아이템 ID |
| vendorItemId | Number | 옵션 ID |
| content | String | **질문 본문** |
| inquiryAt | String(ISO-8601) | 문의 일시 |
| orderIds | List<Long> | 연관 주문번호들 |
| commentDtoList | Array | **기존 답변 이력** |
| ㄴ inquiryCommentId | Number | 답변 ID |
| ㄴ inquiryId | Number | 질문 ID |
| ㄴ content | String | 답변 내용 |
| ㄴ inquiryCommentAt | String | 답변 일시 |

**UI 표기 권장**

- 상단: 질문 내용 + 작성일시
- 중단: 주문번호 칩(여러개면 모두 표기, 클릭 가능)
- 하단: 기존 답변 타임라인(`commentDtoList`)
- 우측 또는 하단: 답변 입력 폼

### 1-5. ③ 주문번호 클릭 → 30일 이내 이전 문의내역

> ⚠️ 쿠팡 상품별 고객문의 조회 API에는 **orderId 필터 파라미터가 없습니다**.
> 따라서 다음 방식을 사용해야 합니다.

**구현 방식**

1. 페이지 진입 시 미답변 조회와 별개로 **`answeredType=ALL`** 로
   30일치(7일 × 5회) 데이터를 백그라운드 캐시.
2. 사용자가 `orderId`를 클릭하면 캐시에서
   `item.orderIds.includes(clickedOrderId)` 인 항목만 필터링하여 모달로 표시.
3. 캐시가 없거나 만료되었으면 그 시점에 7일×5회 호출 후 필터링.

**표시 컬럼**
- 문의일시, 문의내용(요약), 상태(답변완료/미답변), 답변 본문 미리보기

### 1-6. ④ 문의 답변 작성

**Endpoint**
```
POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies
```

**Path Params**

| 이름 | 필수 | 설명 |
|---|---|---|
| vendorId | O | 판매자 ID |
| inquiryId | O | 답변할 문의 ID |

**Body**

| 이름 | 필수 | 타입 | 설명 |
|---|---|---|---|
| content | O | String | 답변 내용. 줄바꿈 `\n` 사용 |
| vendorId | O | String | 판매자 ID |
| replyBy | O | String | 응답자 셀러포탈(WING) 아이디 |

**Request Example**
```json
{
  "content": "안녕하세요\n블랙색상이 주문량이 많아 입고 지연중입니다.\n19일 입고예정으로 확인됩니다.",
  "vendorId": "A00010028",
  "replyBy": "wanger"
}
```

**Response**
```json
{ "code": "200", "message": "OK" }
```

**주요 에러**

| HTTP | 메시지 | 대응 |
|---|---|---|
| 400 | `replyBy ... incorrect` | 올바른 WING ID 확인 |
| 400 | `삭제된 상품문의에는 더 이상 답변할 수 없습니다.` | 비활성화 처리 |
| 400 | `Could not read JSON: Illegal unquoted character ...` | content를 JSON 안전 문자열로 인코딩 (`\n` 사용, `\r` 제거) |
| 400 | `내용을 입력하세요.` | 빈 답변 방지 |
| 400 | `동일한 답변이 존재합니다.` | 전송 직후 버튼 비활성화 |

### 1-7. "고객문의" 페이지 UX 체크리스트

- [ ] 진입 시 로딩 인디케이터(7회 호출이라 1~3초 소요 가능)
- [ ] 30일 캐시 TTL 설정(예: 5분)
- [ ] 답변 입력란에 글자 수 카운터
- [ ] 전송 후 즉시 해당 행을 "답변완료" 로 옵티미스틱 업데이트
- [ ] 동일 inquiryId 중복 답변 방지(버튼 disabled)

---

## 2. 페이지 ② "쿠팡문의" (쿠팡 고객센터 문의)

### 2-1. 페이지 요구사항

1. 쿠팡 고객센터로 접수된 문의 리스트 조회
2. 문의 클릭 → 단건 상세 조회 → 답변 또는 확인 처리

### 2-2. 데이터 흐름

```
[페이지 진입]
   └─> 쿠팡 고객센터 문의조회 (7일 × N회, 상태 필터)
        └─> [행 클릭]
              └─> 쿠팡 고객센터 문의 단건 조회 (inquiryId)
                    ├─ partnerTransferStatus = requestAnswer  → [답변 작성]
                    │      └─> POST callCenterInquiries/{inquiryId}/replies
                    └─ csPartnerCounselingStatus = TRANSFER(미확인) → [확인 처리]
                           └─> POST callCenterInquiries/{inquiryId}/confirms
```

### 2-3. ① 쿠팡 고객센터 문의조회 (리스트)

**Endpoint**
```
GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/callCenterInquiries
```

**Query Parameters**

| 이름 | 필수 | 값 | 설명 |
|---|---|---|---|
| vendorId | O | A0000xxxx | 판매자 ID |
| partnerCounselingStatus | O | `NONE` / `ANSWER` / `NO_ANSWER` / `TRANSFER` | 문의 상태 필터 |
| inquiryStartAt | △ | yyyy-MM-dd | vendorItemId가 없으면 필수, 7일 제한 |
| inquiryEndAt | △ | yyyy-MM-dd | 종료일 |
| orderId | - | Number | 주문번호 |
| vendorItemId | - | String | 옵션 ID. 단독 사용 시 기간 없이 전체 조회 가능 |
| pageNum | - | 1 | 페이지 번호 |
| pageSize | - | 10 (최대 30) | 페이지 크기 |

**partnerCounselingStatus 의미**

| 코드 | 의미 |
|---|---|
| NONE | 전체 |
| ANSWER | 답변완료 |
| NO_ANSWER | 미답변 (판매자 답변 필요) |
| TRANSFER | 미확인 (쿠팡 상담완료 업체이관, 답변 불필요/확인만) |

**리스트 응답 주요 필드**

| 필드 | 설명 |
|---|---|
| inquiryId | 상담번호 |
| inquiryStatus | progress / complete |
| csPartnerCounselingStatus | requestAnswer / answered |
| vendorItemId / itemName | 상품 정보 |
| content | 문의 내용 |
| replies[] | 답변 타임라인 (answerType: `csAgent` / `vendor`) |
| inquiryAt | 문의 일시 |
| buyerPhone | 고객 전화 (이메일은 미사용/빈값) |
| orderId, orderDate | 주문번호/주문일 |
| receiptCategory | 문의 유형 (예: "배송>배송>배송") |

### 2-4. ② 단건 조회 (상세)

**Endpoint**
```
GET /v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/{inquiryId}
```

> ⚠️ **과도한 호출 시 자동 차단**될 수 있습니다. 행 클릭 시 1회만 호출하고
> 동일 inquiryId는 캐시(예: 60초)에서 재사용 권장.

응답 스키마는 리스트의 `content[i]`와 동일합니다. 답변 작성을 위해 필요한
`replies[].answerId` (= **parentAnswerId** 로 사용) 가 들어 있습니다.

### 2-5. ③ 문의 답변

**Endpoint**
```
POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/callCenterInquiries/{inquiryId}/replies
```

**Body Parameters**

| 이름 | 필수 | 설명 |
|---|---|---|
| vendorId | O | 판매자 ID |
| inquiryId | O | 문의 ID |
| content | O | 답변 내용 (2 ~ 1,000자, 줄바꿈 `\n`) |
| replyBy | O | WING 사용자 ID |
| parentAnswerId | O | 답변 대상 `answerId` (단건 조회의 `replies[].answerId`) |

**Request Example**
```json
{
  "vendorId": "A00010028",
  "inquiryId": "1007837444",
  "content": "안녕하세요\n주문 확인 부탁드립니다.\n수고하세요.",
  "replyBy": "wanger",
  "parentAnswerId": "1023208324"
}
```

**답변 가능 조건**
- `inquiryStatus = progress` **AND** `partnerTransferStatus = requestAnswer`
- 위 조건 외에는 400 에러 (`The inquiry can't be answer...`)

**주요 에러**

| 메시지 | 대응 |
|---|---|
| The inquiry can't be answer. ... | 상태 확인. 미답변 상태일 때만 호출 |
| The reply content length should be between 2 ~ 1000 | 길이 검증 |
| The parentAnswerId is required. | 단건 조회 시 가져온 answerId 사용 |
| userId가 올바르지 않습니다 - 520/521 | replyBy 의 WING ID 확인 |
| 상담이 종료된 문의입니다 - 522 | UI에서 답변 비활성화 |

### 2-6. ④ 문의 확인 (TRANSFER 건)

상태가 `TRANSFER`(미확인)인 문의는 **답변이 아닌 "확인" 처리**가 필요합니다.

**Endpoint**
```
POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/callCenterInquiries/{inquiryId}/confirms
```

**Body**
```json
{ "confirmBy": "wanger" }
```

- 24시간 경과 또는 이미 종료된 문의는 확인 불가 (`522` 에러).

### 2-7. "쿠팡문의" 페이지 UX 체크리스트

- [ ] 상태 탭 분리: 전체 / 미답변(NO_ANSWER) / 답변완료(ANSWER) / 미확인(TRANSFER)
- [ ] 24시간 카운트다운 표시(미답변 건은 자동 종료까지 남은 시간)
- [ ] 답변 폼은 2~1,000자 검증, 줄바꿈 자동 변환(`\n`)
- [ ] TRANSFER 상태에서는 "답변" 대신 "확인" 버튼 노출
- [ ] 단건 조회는 클릭당 1회, 60초 캐시
- [ ] 답변/확인 성공 시 즉시 상태 갱신 및 버튼 비활성화

---

## 3. 공통 구현 팁

### 3-1. 30일 분할 호출 유틸 (의사 코드)

```js
async function fetchRange(api, base, days = 30, window = 7) {
  const today = new Date();
  const buckets = [];
  for (let offset = 0; offset < days; offset += window) {
    const end = addDays(today, -offset);
    const start = addDays(end, -(window - 1));
    buckets.push({ start: fmt(start), end: fmt(end) });
  }
  const results = [];
  for (const b of buckets) {
    let page = 1;
    while (true) {
      const r = await api({ ...base, inquiryStartAt: b.start, inquiryEndAt: b.end, pageNum: page, pageSize: 50 });
      results.push(...r.data.content);
      if (page >= r.data.pagination.totalPages) break;
      page++;
    }
  }
  return dedupBy(results, 'inquiryId').sort((a,b)=>b.inquiryAt.localeCompare(a.inquiryAt));
}
```

### 3-2. 에러 핸들링 공통 규칙

| HTTP | 유형 | 권장 처리 |
|---|---|---|
| 400 | 요청변수확인 | 사용자에게 메시지 노출 + 입력값 검증 |
| 400 | 타임아웃(Read timed out) | 기간 1일/페이지 10으로 축소 재시도 + `X-EXTENDED-TIMEOUT` |
| 404 | Inquiry not found / Vendor mismatch | 권한/ID 확인 |
| 5xx | 서버 | 지수 백오프 재시도(최대 3회) |

### 3-3. 보안

- API Key/Secret은 **서버 환경변수**로만 관리, 클라이언트 노출 금지
- 사이트 사용자 → 우리 서버 → 쿠팡 API 의 프록시 구조
- 응답에서 `buyerPhone` 등은 권한 있는 사용자에게만 노출(마스킹 권장: `+1(***)***-1234`)

### 3-4. 추천 데이터 모델 (의사 정의)

```ts
type OnlineInquiry = {
  inquiryId: number;
  productId: number;
  sellerProductId: number;
  sellerItemId: number;
  vendorItemId: number;
  content: string;
  inquiryAt: string; // ISO-8601
  orderIds: number[];
  commentDtoList: Array<{
    inquiryCommentId: number;
    inquiryId: number;
    content: string;
    inquiryCommentAt: string;
  }>;
};

type CallCenterInquiry = {
  inquiryId: number;
  inquiryStatus: 'progress' | 'complete';
  csPartnerCounselingStatus: 'requestAnswer' | 'answered';
  vendorItemId: number[];
  itemName: string;
  content: string;
  answeredAt: string;
  replies: Array<{
    answerId: number;
    parentAnswerId: number | string | null;
    partnerTransferStatus: 'none' | 'requestAnswer' | 'answered' | null;
    partnerTransferCompleteReason: 'NONE' | 'DISPUTE_PROCESS' | 'DISPUTE_PROCESS_COMPLETE' | 'CANCEL';
    answerType: 'csAgent' | 'vendor';
    needAnswer: boolean;
    receptionistName: string;
    receptionist: string;
    replyAt: string;
    content: string;
  }>;
  inquiryAt: string;
  buyerEmail: string;
  buyerPhone: string;
  orderId: number;
  orderDate: string;
  receiptCategory: string;
  saleStartedAt: string;
  saleEndedAt: string;
};
```

---

## 4. 페이지별 라우팅/엔드포인트 매핑 요약

### "고객문의" 페이지 (`/cs/online`)
- `GET /api/online-inquiries?status=NOANSWER&days=30` (내부 API, 7일×5회 합쳐서 반환)
- `GET /api/online-inquiries?orderId={orderId}&days=30` (내부 캐시 필터)
- `POST /api/online-inquiries/{inquiryId}/replies`

### "쿠팡문의" 페이지 (`/cs/coupang`)
- `GET /api/cc-inquiries?status=NO_ANSWER&days=30` (또는 7, 14 등 옵션)
- `GET /api/cc-inquiries/{inquiryId}` (단건)
- `POST /api/cc-inquiries/{inquiryId}/replies`
- `POST /api/cc-inquiries/{inquiryId}/confirms`

---

## 5. 출처

- 상품별 고객문의 조회: https://developers.coupangcorp.com/hc/ko/articles/360033400754
- 상품별 고객문의 답변: https://developers.coupangcorp.com/hc/ko/articles/360033645174
- 쿠팡 고객센터 문의조회: https://developers.coupangcorp.com/hc/ko/articles/360033645354
- 쿠팡 고객센터 문의 단건 조회: https://developers.coupangcorp.com/hc/ko/articles/20376877844249
- 쿠팡 고객센터 문의답변: https://developers.coupangcorp.com/hc/ko/articles/360034156233
- 쿠팡 고객센터 문의확인: https://developers.coupangcorp.com/hc/ko/articles/360034204013
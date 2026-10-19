/* ================================================================
   프로덕션 서버 (Railway 배포용)
   - Express: 쿠팡 API 프록시 + QZ Tray 서명(라벨 인쇄) + 고객문의 AI 답변(OpenAI) + dist/ 정적 파일 서빙 + SPA fallback
   - coupangProxy.ts · qzSignProxy.ts (Vite 전용)의 로직을 CommonJS로 재구현
   - AI 답변은 ai/inquiryReplyAi.js 를 aiProxy.ts 와 공용으로 쓴다 (라우트 껍데기만 여기)
   ================================================================ */

const express = require('express')
const crypto = require('node:crypto')
const path = require('node:path')
const { generateInquiryReplies, AiRequestError } = require('./ai/inquiryReplyAi')

const app = express()
const PORT = process.env.PORT || 3000
const DIST_DIR = path.resolve(__dirname, '../../dist')

// ══════════════════════════════════════════════════════════════════
// JSON body 파싱 — AI 답변 요청(문의 20건 + 이전문의)이 기본 100kb 를 넘을 수 있어 1mb
// ══════════════════════════════════════════════════════════════════

app.use(express.json({ limit: '1mb' }))

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 헬퍼
// ══════════════════════════════════════════════════════════════════

/** 요청 헤더에서 사용자별 쿠팡 API 키 추출 */
function extractCoupangKeys(req) {
  const accessKey = req.headers['x-coupang-access-key']
  const secretKey = req.headers['x-coupang-secret-key']
  const vendorCode = req.headers['x-vendor-code']
  if (!accessKey || !secretKey || !vendorCode) return null
  return { accessKey, secretKey, vendorCode }
}

/** 쿠팡 API HMAC-SHA256 서명 생성 */
function generateAuth(method, apiPath, queryString, accessKey, secretKey) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z'

  const message = datetime + method + apiPath + (queryString || '')
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex')

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 API Gateway 호출
// ══════════════════════════════════════════════════════════════════

async function callCoupangAPI(method, apiPath, queryParams, accessKey, secretKey, body, vendorCode) {
  const baseUrl = 'https://api-gateway.coupang.com'
  const queryString = queryParams
    ? new URLSearchParams(queryParams).toString()
    : ''
  const authorization = generateAuth(method, apiPath, queryString, accessKey, secretKey)
  const fullUrl = baseUrl + apiPath + (queryString ? '?' + queryString : '')

  // X-EXTENDED-TIMEOUT: 대용량 응답 타임아웃 대응 (Coupang 공식 가이드)
  const headers = {
    Authorization: authorization,
    'Content-Type': 'application/json;charset=UTF-8',
    'X-EXTENDED-TIMEOUT': '90000',
  }
  if (vendorCode) headers['X-Requested-By'] = vendorCode

  const options = {
    method,
    headers,
  }
  if (body) options.body = JSON.stringify(body)

  const response = await fetch(fullUrl, options)
  const text = await response.text()

  // ── JSON 파싱 안전장치 (빈 body / HTML 응답 등 방어) ──
  if (!text) {
    const err = new Error(`Coupang 응답 비어있음 (status=${response.status})`)
    err.status = response.status
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ')
    const err = new Error(`Coupang 비JSON 응답 (status=${response.status}): ${preview}`)
    err.status = response.status
    throw err
  }
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 API 프록시 라우트
// ══════════════════════════════════════════════════════════════════

// ── GET /api/coupang/rg-products — 상품 목록 조회 ────────────────
app.get('/api/coupang/rg-products', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const nextToken = req.query.nextToken
    const pageSize = req.query.pageSize || '50'

    const apiPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
    const params = {
      vendorId: keys.vendorCode,
      businessTypes: 'rocketGrowth',
      maxPerPage: pageSize,
    }
    if (nextToken) params.nextToken = nextToken

    const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] rg-products 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/rg-product/:sellerProductId — 상세 조회 ────
app.get('/api/coupang/rg-product/:sellerProductId', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { sellerProductId } = req.params
    if (!sellerProductId) return res.status(400).json({ success: false, error: 'sellerProductId 필요' })

    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`
    const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] rg-product 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/ordersheets — 발주서 목록 조회 ──────────────
app.get('/api/coupang/ordersheets', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { createdAtFrom, createdAtTo, status, maxPerPage, nextToken } = req.query
    if (!createdAtFrom || !createdAtTo || !status) {
      return res.status(400).json({ success: false, error: 'createdAtFrom, createdAtTo, status 파라미터 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/ordersheets`
    const params = { createdAtFrom, createdAtTo, status, maxPerPage: maxPerPage || '50' }
    if (nextToken) params.nextToken = nextToken

    const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] ordersheets 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/return-requests — 반품/취소 요청 목록 ──────
// 출고중지요청(RU) / 반품접수(UC) 조회. 일단위 페이징 (nextToken).
app.get('/api/coupang/return-requests', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { createdAtFrom, createdAtTo, status, maxPerPage, nextToken } = req.query
    if (!createdAtFrom || !createdAtTo || !status) {
      return res.status(400).json({ success: false, error: 'createdAtFrom, createdAtTo, status 파라미터 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v6/vendors/${keys.vendorCode}/returnRequests`
    const params = { createdAtFrom, createdAtTo, status, maxPerPage: maxPerPage || '50' }
    if (nextToken) params.nextToken = nextToken

    const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] return-requests 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── PUT /api/coupang/ordersheets-acknowledge — 주문확인 ──────────
app.put('/api/coupang/ordersheets-acknowledge', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { shipmentBoxIds } = req.body
    if (!shipmentBoxIds || !Array.isArray(shipmentBoxIds)) {
      return res.status(400).json({ success: false, error: 'shipmentBoxIds 배열 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/ordersheets/acknowledgement`
    const result = await callCoupangAPI(
      'PUT', apiPath, null,
      keys.accessKey, keys.secretKey,
      { vendorId: keys.vendorCode, shipmentBoxIds },
      keys.vendorCode,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] ordersheets-acknowledge 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/vendor-item-inventory?vendorItemId= — 수량/가격/판매상태 조회 ──
app.get('/api/coupang/vendor-item-inventory', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const vendorItemId = req.query.vendorItemId
    if (!vendorItemId) return res.status(400).json({ success: false, error: 'vendorItemId 필요' })

    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/inventories`
    const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] vendor-item-inventory 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── PUT /api/coupang/vendor-item-price — 아이템별 가격 변경 ──
// body: { vendorItemId, price(10원 단위), force?:boolean }
app.put('/api/coupang/vendor-item-price', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { vendorItemId, force } = req.body
    const price = Number(req.body.price)
    if (!vendorItemId || !Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, error: 'vendorItemId, price(양수) 필수' })
    }
    if (price % 10 !== 0) {
      return res.status(400).json({ success: false, error: 'price 는 10원 단위여야 합니다.' })
    }

    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/prices/${price}`
    const params = force ? { forceSalePriceUpdate: 'true' } : null
    const result = await callCoupangAPI('PUT', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] vendor-item-price 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── PUT /api/coupang/vendor-item-sale — 아이템별 판매 재개/중지 ──
// body: { vendorItemId, action: 'resume' | 'stop' }
app.put('/api/coupang/vendor-item-sale', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { vendorItemId, action } = req.body
    if (!vendorItemId || (action !== 'resume' && action !== 'stop')) {
      return res.status(400).json({ success: false, error: "vendorItemId, action('resume'|'stop') 필수" })
    }

    const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/sales/${action}`
    const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] vendor-item-sale 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ══════════════════════════════════════════════════════════════════
// 일반상품(판매자배송) 관리 — 상품관리 화면 (/coupang)
//   - coupangProxy.ts 와 같은 경로 · 같은 검증 (양쪽을 같이 고친다)
//   - 상세 조회는 기존 /api/coupang/rg-product/:id 를 같이 쓴다 (같은 seller-products 엔드포인트)
// ══════════════════════════════════════════════════════════════════

/** 상품 목록 페이징 조회 maxPerPage 최대값 (쿠팡 문서: 기본 10, 최대 100) */
const PRODUCT_LIST_MAX_PER_PAGE = 100
/** 상품 목록 status 필터 허용값 (쿠팡 문서) */
const PRODUCT_LIST_STATUSES = ['IN_REVIEW', 'SAVED', 'APPROVING', 'APPROVED', 'PARTIAL_APPROVED', 'DENIED', 'DELETED']
const SELLER_PRODUCTS_PATH = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
const VENDOR_ITEMS_PATH = '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items'

/** 숫자 ID 경로값 검증 — 경로에 그대로 넣으므로 숫자만 허용 */
function isNumericId(v) {
  return typeof v === 'string' && /^\d+$/.test(v)
}

/** 0 이상 정수 (아니면 null) */
function toNonNegativeInt(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// ── GET /api/coupang/mp-products — 상품 목록 페이징 (businessTypes 없음 → 일반 + 하이브리드) ──
// query: nextToken?, maxPerPage?(1~100), status?
app.get('/api/coupang/mp-products', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { nextToken, status } = req.query
    const maxPerPage = toNonNegativeInt(req.query.maxPerPage ?? PRODUCT_LIST_MAX_PER_PAGE)
    if (!maxPerPage || maxPerPage > PRODUCT_LIST_MAX_PER_PAGE) {
      return res.status(400).json({ success: false, error: `maxPerPage 는 1~${PRODUCT_LIST_MAX_PER_PAGE}` })
    }
    if (status && !PRODUCT_LIST_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `status 허용값: ${PRODUCT_LIST_STATUSES.join(', ')}` })
    }

    const params = { vendorId: keys.vendorCode, maxPerPage: String(maxPerPage) }
    if (nextToken) params.nextToken = String(nextToken)
    if (status) params.status = status

    const result = await callCoupangAPI('GET', SELLER_PRODUCTS_PATH, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] mp-products 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/product-histories?sellerProductId= — 상품 상태변경 이력 ──
// query: sellerProductId, nextToken?, maxPerPage?
app.get('/api/coupang/product-histories', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const sellerProductId = req.query.sellerProductId
    if (!isNumericId(sellerProductId)) {
      return res.status(400).json({ success: false, error: 'sellerProductId(숫자) 필요' })
    }
    const params = {}
    if (req.query.nextToken) params.nextToken = String(req.query.nextToken)
    if (req.query.maxPerPage && toNonNegativeInt(req.query.maxPerPage)) params.maxPerPage = String(req.query.maxPerPage)

    const apiPath = `${SELLER_PRODUCTS_PATH}/${sellerProductId}/histories`
    const result = await callCoupangAPI('GET', apiPath, Object.keys(params).length ? params : null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] product-histories 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── PUT /api/coupang/vendor-item-quantity — 아이템별 수량(재고) 변경 ──
// body: { vendorItemId, quantity(0 이상 정수) }
app.put('/api/coupang/vendor-item-quantity', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const vendorItemId = String(req.body.vendorItemId ?? '')
    const quantity = toNonNegativeInt(req.body.quantity)
    if (!isNumericId(vendorItemId) || quantity === null) {
      return res.status(400).json({ success: false, error: 'vendorItemId(숫자), quantity(0 이상 정수) 필수' })
    }

    const apiPath = `${VENDOR_ITEMS_PATH}/${vendorItemId}/quantities/${quantity}`
    const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] vendor-item-quantity 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── PUT /api/coupang/vendor-item-original-price — 아이템별 할인율 기준가격 변경 ──
// body: { vendorItemId, originalPrice(0 이상, 10원 단위) }
app.put('/api/coupang/vendor-item-original-price', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const vendorItemId = String(req.body.vendorItemId ?? '')
    const originalPrice = toNonNegativeInt(req.body.originalPrice)
    if (!isNumericId(vendorItemId) || originalPrice === null) {
      return res.status(400).json({ success: false, error: 'vendorItemId(숫자), originalPrice(0 이상 정수) 필수' })
    }
    if (originalPrice % 10 !== 0) {
      return res.status(400).json({ success: false, error: 'originalPrice 는 10원 단위여야 합니다.' })
    }

    const apiPath = `${VENDOR_ITEMS_PATH}/${vendorItemId}/original-prices/${originalPrice}`
    const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] vendor-item-original-price 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/online-inquiries — 상품별 고객문의 조회 (CS) ──
// answeredType(ALL/ANSWERED/NOANSWER) 필수, 기간은 7일 이내 제한.
// 30일 조회는 클라이언트(csService)에서 7일×5회 분할 후 병합.
app.get('/api/coupang/online-inquiries', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { answeredType, inquiryStartAt, inquiryEndAt } = req.query
    const pageNum = req.query.pageNum || '1'
    const pageSize = req.query.pageSize || '50'
    if (!answeredType || !inquiryStartAt || !inquiryEndAt) {
      return res.status(400).json({ success: false, error: 'answeredType, inquiryStartAt, inquiryEndAt 파라미터 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/onlineInquiries`
    // vendorId 는 path/query 양쪽 요구 (쿠팡 onlineInquiries 스펙)
    const params = { vendorId: keys.vendorCode, answeredType, inquiryStartAt, inquiryEndAt, pageNum, pageSize }

    const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] online-inquiries 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/ordersheet-by-order?orderId= — 발주서 단건(주문번호) 조회 ──
// 고객문의(CS) 주문정보 표시용. 응답 data[] = shipmentBox 목록 (orderItems 포함).
app.get('/api/coupang/ordersheet-by-order', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { orderId } = req.query
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId 파라미터 필수' })

    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/${orderId}/ordersheets`
    const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] ordersheet-by-order 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── POST /api/coupang/online-inquiry-reply — 상품별 고객문의 답변 ──
// body: { inquiryId, content, replyBy }. content 줄바꿈은 \n (CR 금지).
app.post('/api/coupang/online-inquiry-reply', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { inquiryId, content, replyBy } = req.body
    if (!inquiryId || !content || !replyBy) {
      return res.status(400).json({ success: false, error: 'inquiryId, content, replyBy 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/onlineInquiries/${inquiryId}/replies`
    const result = await callCoupangAPI(
      'POST', apiPath, null,
      keys.accessKey, keys.secretKey,
      { content, vendorId: keys.vendorCode, replyBy },
      keys.vendorCode,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] online-inquiry-reply 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── POST /api/coupang/order-cancel — 주문 상품 취소 처리 ──
// body: { orderId, vendorItemIds[], receiptCounts[], bigCancelCode, middleCancelCode, userId }
app.post('/api/coupang/order-cancel', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { orderId, vendorItemIds, receiptCounts, bigCancelCode, middleCancelCode, cancelReason, userId } = req.body
    if (
      !orderId ||
      !Array.isArray(vendorItemIds) || vendorItemIds.length === 0 ||
      !Array.isArray(receiptCounts) || receiptCounts.length !== vendorItemIds.length ||
      !bigCancelCode || !middleCancelCode || !userId
    ) {
      return res.status(400).json({ success: false, error: 'orderId, vendorItemIds[], receiptCounts[](길이일치), bigCancelCode, middleCancelCode, userId 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/orders/${orderId}/cancel`
    const cancelBody = {
      orderId, vendorId: keys.vendorCode, vendorItemIds, receiptCounts, bigCancelCode, middleCancelCode, userId,
    }
    if (cancelReason) cancelBody.cancelReason = cancelReason // 고객 안내용 직접 입력 사유
    const result = await callCoupangAPI(
      'POST', apiPath, null,
      keys.accessKey, keys.secretKey,
      cancelBody,
      keys.vendorCode,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] order-cancel 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ══════════════════════════════════════════════════════════════════
// 쿠팡 고객센터 문의 (쿠팡문의) — callCenterInquiries
// ══════════════════════════════════════════════════════════════════

// ── GET /api/coupang/cc-inquiries — 문의 조회 (리스트) ──
app.get('/api/coupang/cc-inquiries', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { partnerCounselingStatus, inquiryStartAt, inquiryEndAt } = req.query
    const pageNum = req.query.pageNum || '1'
    const pageSize = req.query.pageSize || '30'
    if (!partnerCounselingStatus || !inquiryStartAt || !inquiryEndAt) {
      return res.status(400).json({ success: false, error: 'partnerCounselingStatus, inquiryStartAt, inquiryEndAt 파라미터 필수' })
    }

    const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/callCenterInquiries`
    const params = { vendorId: keys.vendorCode, partnerCounselingStatus, inquiryStartAt, inquiryEndAt, pageNum, pageSize }
    const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] cc-inquiries 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── GET /api/coupang/cc-inquiry-detail?inquiryId= — 단건 조회 (경로에 vendorId 없음) ──
app.get('/api/coupang/cc-inquiry-detail', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const inquiryId = req.query.inquiryId
    if (!inquiryId) return res.status(400).json({ success: false, error: 'inquiryId 파라미터 필수' })

    const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/${inquiryId}`
    const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, null, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] cc-inquiry-detail 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── POST /api/coupang/cc-inquiry-reply — 문의 답변 ──
app.post('/api/coupang/cc-inquiry-reply', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { inquiryId, content, replyBy, parentAnswerId } = req.body
    if (!inquiryId || !content || !replyBy || !parentAnswerId) {
      return res.status(400).json({ success: false, error: 'inquiryId, content, replyBy, parentAnswerId 필수' })
    }
    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/callCenterInquiries/${inquiryId}/replies`
    const result = await callCoupangAPI(
      'POST', apiPath, null,
      keys.accessKey, keys.secretKey,
      { vendorId: keys.vendorCode, inquiryId: String(inquiryId), content, replyBy, parentAnswerId: String(parentAnswerId) },
      keys.vendorCode,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] cc-inquiry-reply 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── POST /api/coupang/cc-inquiry-confirm — 문의 확인 (TRANSFER) ──
app.post('/api/coupang/cc-inquiry-confirm', async (req, res) => {
  try {
    const keys = extractCoupangKeys(req)
    if (!keys) return res.status(401).json({ success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })

    const { inquiryId, confirmBy } = req.body
    if (!inquiryId || !confirmBy) {
      return res.status(400).json({ success: false, error: 'inquiryId, confirmBy 필수' })
    }
    const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/callCenterInquiries/${inquiryId}/confirms`
    const result = await callCoupangAPI('POST', apiPath, null, keys.accessKey, keys.secretKey, { confirmBy }, keys.vendorCode)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[prod-server] cc-inquiry-confirm 오류:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ══════════════════════════════════════════════════════════════════
// QZ Tray 인증서 · 요청 서명 (라벨 인쇄) — qzSignProxy.ts 와 같은 로직
//   env QZ_CERTIFICATE / QZ_PRIVATE_KEY (\n 이스케이프 PEM). 개인키는 브라우저로 나가지 않는다.
//   인쇄 PC 의 QZ Tray 가 같은 인증서를 override.crt 로 신뢰하면 허용 창 없이 인쇄된다.
// ══════════════════════════════════════════════════════════════════

/** 클라이언트(utils/label/qzTray.ts)의 setSignatureAlgorithm('SHA512') 과 같아야 한다 */
const QZ_SIGN_ALGORITHM = 'RSA-SHA512'
/** 해시 문자열(64자) + 여유. 이보다 길면 정상 요청이 아니다 */
const QZ_MAX_REQUEST_LEN = 512

/** env 의 \n 이스케이프를 실제 개행으로 */
function readPem(raw) {
  if (!raw) return null
  return raw.replace(/\\n/g, '\n').trim()
}

const QZ_CERTIFICATE = readPem(process.env.QZ_CERTIFICATE)
const QZ_PRIVATE_KEY = (() => {
  const pem = readPem(process.env.QZ_PRIVATE_KEY)
  if (!pem) return null
  try {
    return crypto.createPrivateKey(pem)
  } catch (error) {
    console.error('[prod-server] QZ_PRIVATE_KEY 파싱 실패:', error.message)
    return null
  }
})()

// ── GET /api/qz/cert — 공개 인증서 (?download=1 → override.crt) ──
//   없으면 404 → 클라이언트는 익명 모드(허용 창이 뜸)로 동작
app.get('/api/qz/cert', (req, res) => {
  if (!QZ_CERTIFICATE) return res.status(404).send('QZ_CERTIFICATE 가 설정되지 않았습니다.')
  res.set('Content-Type', 'application/x-pem-file; charset=utf-8')
  res.set('Cache-Control', 'no-store')
  if (req.query.download === '1') {
    res.set('Content-Disposition', 'attachment; filename="override.crt"')
  }
  res.send(QZ_CERTIFICATE + '\n')
})

// ── POST /api/qz/sign — 요청 서명 (body: { request }) ───────────
app.post('/api/qz/sign', (req, res) => {
  try {
    if (!QZ_PRIVATE_KEY) {
      return res.status(404).json({ success: false, error: 'QZ_PRIVATE_KEY 가 설정되지 않았습니다.' })
    }
    const toSign = req.body && req.body.request
    if (typeof toSign !== 'string' || !toSign || toSign.length > QZ_MAX_REQUEST_LEN) {
      return res.status(400).json({ success: false, error: '서명할 요청 문자열이 올바르지 않습니다.' })
    }
    const signer = crypto.createSign(QZ_SIGN_ALGORITHM)
    signer.update(toSign, 'utf8')
    res.json({ success: true, signature: signer.sign(QZ_PRIVATE_KEY, 'base64') })
  } catch (error) {
    console.error('[prod-server] QZ 서명 오류:', error.message)
    res.status(500).json({ success: false, error: '서명 중 오류가 발생했습니다.' })
  }
})

// ══════════════════════════════════════════════════════════════════
// 고객문의 AI 답변 (OpenAI) — aiProxy.ts 와 같은 라우트
//   env OPENAI_API_KEY / OPENAI_MODEL. 프롬프트·검증·호출은 ai/inquiryReplyAi.js
// ══════════════════════════════════════════════════════════════════

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim()
const OPENAI_MODEL = (process.env.OPENAI_MODEL || '').trim()
if (!OPENAI_API_KEY) console.warn('[prod-server] OPENAI_API_KEY 가 없어 [AI 답변] 이 동작하지 않습니다.')

// ── POST /api/ai/inquiry-replies — body { items } → { success, data: drafts[] } ──
app.post('/api/ai/inquiry-replies', async (req, res) => {
  try {
    const data = await generateInquiryReplies({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, items: req.body && req.body.items })
    res.json({ success: true, data })
  } catch (error) {
    const status = error instanceof AiRequestError ? error.status : 500
    console.error('[prod-server] AI 답변 생성 오류:', error.message)
    res.status(status).json({ success: false, error: error.message || 'AI 답변 생성 중 오류가 발생했습니다.' })
  }
})

// ══════════════════════════════════════════════════════════════════
// 정적 파일 서빙 + SPA fallback
// ══════════════════════════════════════════════════════════════════

app.use(express.static(DIST_DIR))

// SPA: /api 이외 모든 GET → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

// ══════════════════════════════════════════════════════════════════
// 서버 시작
// ══════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`[prod-server] 서버 시작: http://localhost:${PORT}`)
})

/* ================================================================
   프로덕션 서버 (Railway 배포용)
   - Express: 쿠팡 API 프록시 + dist/ 정적 파일 서빙 + SPA fallback
   - coupangProxy.ts (Vite 전용)의 로직을 CommonJS로 재구현
   ================================================================ */

const express = require('express')
const crypto = require('node:crypto')
const path = require('node:path')

const app = express()
const PORT = process.env.PORT || 3000
const DIST_DIR = path.resolve(__dirname, '../../dist')

// ══════════════════════════════════════════════════════════════════
// JSON body 파싱
// ══════════════════════════════════════════════════════════════════

app.use(express.json())

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

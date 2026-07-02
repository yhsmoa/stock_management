/* ================================================================
   Vite Plugin: Coupang API Proxy
   - configureServer 미들웨어로 /api/coupang/* 엔드포인트 제공
   - HMAC-SHA256 서명은 서버 사이드에서 처리 (SECRET_KEY 보호)
   - 브라우저 → 요청 헤더(사용자별 키) → Vite 서버 → Coupang API Gateway
   ================================================================ */

import type { Plugin } from 'vite'
import crypto from 'node:crypto'

// ══════════════════════════════════════════════════════════════════
// 요청 헤더에서 쿠팡 인증 키 추출
// ══════════════════════════════════════════════════════════════════

/** 요청 헤더에서 사용자별 쿠팡 API 키를 추출 (없으면 null) */
function extractCoupangKeys(req: any): {
  accessKey: string
  secretKey: string
  vendorCode: string
} | null {
  const accessKey = req.headers['x-coupang-access-key']
  const secretKey = req.headers['x-coupang-secret-key']
  const vendorCode = req.headers['x-vendor-code']

  if (!accessKey || !secretKey || !vendorCode) return null
  return { accessKey, secretKey, vendorCode }
}

// ══════════════════════════════════════════════════════════════════
// HMAC-SHA256 서명 생성
// ══════════════════════════════════════════════════════════════════

/** 쿠팡 API 인증 서명 생성 (HMAC-SHA256) */
function generateAuth(
  method: string,
  apiPath: string,
  queryString: string,
  accessKey: string,
  secretKey: string,
) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z'

  // 서명 메시지: datetime + method + path + query (? 없이 바로 이어붙임)
  const message = datetime + method + apiPath + (queryString || '')
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex')

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}

// ══════════════════════════════════════════════════════════════════
// Coupang API 호출
// ══════════════════════════════════════════════════════════════════

/** Coupang API Gateway 호출 (서명 포함, GET/PUT/PATCH 지원) */
async function callCoupangAPI(
  method: string,
  apiPath: string,
  queryParams: Record<string, string> | null,
  accessKey: string,
  secretKey: string,
  body?: unknown,
  vendorCode?: string,
) {
  const baseUrl = 'https://api-gateway.coupang.com'
  const queryString = queryParams
    ? new URLSearchParams(queryParams).toString()
    : ''
  const authorization = generateAuth(method, apiPath, queryString, accessKey, secretKey)
  const fullUrl = baseUrl + apiPath + (queryString ? '?' + queryString : '')

  // X-EXTENDED-TIMEOUT: 대용량 응답 타임아웃 대응 (Coupang 공식 가이드)
  const headers: Record<string, string> = {
    Authorization: authorization,
    'Content-Type': 'application/json;charset=UTF-8',
    'X-EXTENDED-TIMEOUT': '90000',
  }
  if (vendorCode) headers['X-Requested-By'] = vendorCode

  const response = await fetch(fullUrl, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await response.text()

  // ── JSON 파싱 안전장치 (빈 body / HTML 응답 등 방어) ──
  if (!text) {
    const err: any = new Error(`Coupang 응답 비어있음 (status=${response.status})`)
    err.status = response.status
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ')
    const err: any = new Error(`Coupang 비JSON 응답 (status=${response.status}): ${preview}`)
    err.status = response.status
    throw err
  }
}

// ── JSON 응답 헬퍼 ────────────────────────────────────────────────
function sendJson(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// ── Request Body 파싱 헬퍼 ─────────────────────────────────────────
/** Vite 미들웨어에서 JSON body를 파싱 */
function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch { reject(new Error('JSON 파싱 실패')) }
    })
    req.on('error', reject)
  })
}

// ══════════════════════════════════════════════════════════════════
// Vite Plugin 본체
// ══════════════════════════════════════════════════════════════════

export function coupangProxyPlugin(): Plugin {
  return {
    name: 'coupang-proxy',
    configureServer(server) {

      // ── GET /api/coupang/rg-products — 상품 목록 조회 ───────────
      // nextToken 지원: 첫 호출은 pageNum, 이후는 nextToken으로 순회
      server.middlewares.use('/api/coupang/rg-products', async (req: any, res: any) => {
        try {
          // 헤더에서 사용자별 쿠팡 키 추출
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const nextToken = url.searchParams.get('nextToken')
          const pageSize = url.searchParams.get('pageSize') || '50'

          const apiPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
          const params: Record<string, string> = {
            vendorId: keys.vendorCode,
            businessTypes: 'rocketGrowth',
            maxPerPage: pageSize,
          }
          if (nextToken) {
            params.nextToken = nextToken
          }

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] rg-products 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/rg-product/{sellerProductId} — 상세 조회 ─
      server.middlewares.use('/api/coupang/rg-product/', async (req: any, res: any) => {
        try {
          // 헤더에서 사용자별 쿠팡 키 추출
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          // Vite 미들웨어는 등록 경로를 req.url에서 제거함
          // /api/coupang/rg-product/12345 → req.url = /12345
          const sellerProductId = (req.url || '').replace(/^\//, '').split('?')[0]

          if (!sellerProductId) {
            sendJson(res, 400, { success: false, error: 'sellerProductId 필요' })
            return
          }

          const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`
          const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] rg-product 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/ordersheets — 발주서 목록 조회 ──────
      // 일단위 페이징, status/createdAtFrom/createdAtTo 필수
      server.middlewares.use('/api/coupang/ordersheets', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const createdAtFrom = url.searchParams.get('createdAtFrom')
          const createdAtTo = url.searchParams.get('createdAtTo')
          const status = url.searchParams.get('status')
          const maxPerPage = url.searchParams.get('maxPerPage') || '50'
          const nextToken = url.searchParams.get('nextToken')

          if (!createdAtFrom || !createdAtTo || !status) {
            sendJson(res, 400, { success: false, error: 'createdAtFrom, createdAtTo, status 파라미터 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/ordersheets`
          const params: Record<string, string> = {
            createdAtFrom,
            createdAtTo,
            status,
            maxPerPage,
          }
          if (nextToken) {
            params.nextToken = nextToken
          }

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] ordersheets 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/return-requests — 반품/취소 요청 목록 ───
      // 출고중지요청(RU) / 반품접수(UC) 조회. 일단위 페이징 (nextToken).
      server.middlewares.use('/api/coupang/return-requests', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const createdAtFrom = url.searchParams.get('createdAtFrom')
          const createdAtTo = url.searchParams.get('createdAtTo')
          const status = url.searchParams.get('status')
          const maxPerPage = url.searchParams.get('maxPerPage') || '50'
          const nextToken = url.searchParams.get('nextToken')

          if (!createdAtFrom || !createdAtTo || !status) {
            sendJson(res, 400, { success: false, error: 'createdAtFrom, createdAtTo, status 파라미터 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v6/vendors/${keys.vendorCode}/returnRequests`
          const params: Record<string, string> = {
            createdAtFrom,
            createdAtTo,
            status,
            maxPerPage,
          }
          if (nextToken) {
            params.nextToken = nextToken
          }

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] return-requests 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/ordersheets-acknowledge — 주문확인 ────
      // 결제완료 → 상품준비중 상태 변경 (shipmentBoxIds 배열)
      server.middlewares.use('/api/coupang/ordersheets-acknowledge', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const shipmentBoxIds = body.shipmentBoxIds
          if (!shipmentBoxIds || !Array.isArray(shipmentBoxIds)) {
            sendJson(res, 400, { success: false, error: 'shipmentBoxIds 배열 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/ordersheets/acknowledgement`
          const result = await callCoupangAPI(
            'PUT',
            apiPath,
            null,
            keys.accessKey,
            keys.secretKey,
            { vendorId: keys.vendorCode, shipmentBoxIds },
            keys.vendorCode,
          )

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] ordersheets-acknowledge 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/vendor-item-inventory?vendorItemId= — 수량/가격/판매상태 조회 ──
      server.middlewares.use('/api/coupang/vendor-item-inventory', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const vendorItemId = url.searchParams.get('vendorItemId')
          if (!vendorItemId) {
            sendJson(res, 400, { success: false, error: 'vendorItemId 필요' })
            return
          }

          const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/inventories`
          const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] vendor-item-inventory 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/vendor-item-price — 아이템별 가격 변경 ──
      // body: { vendorItemId, price(10원 단위), force?:boolean }
      server.middlewares.use('/api/coupang/vendor-item-price', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const vendorItemId = body.vendorItemId
          const price = Number(body.price)
          if (!vendorItemId || !Number.isFinite(price) || price <= 0) {
            sendJson(res, 400, { success: false, error: 'vendorItemId, price(양수) 필수' })
            return
          }
          if (price % 10 !== 0) {
            sendJson(res, 400, { success: false, error: 'price 는 10원 단위여야 합니다.' })
            return
          }

          const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/prices/${price}`
          const params = body.force ? { forceSalePriceUpdate: 'true' } : null
          const result = await callCoupangAPI('PUT', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] vendor-item-price 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/vendor-item-sale — 아이템별 판매 재개/중지 ──
      // body: { vendorItemId, action: 'resume' | 'stop' }
      server.middlewares.use('/api/coupang/vendor-item-sale', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const vendorItemId = body.vendorItemId
          const action = body.action
          if (!vendorItemId || (action !== 'resume' && action !== 'stop')) {
            sendJson(res, 400, { success: false, error: "vendorItemId, action('resume'|'stop') 필수" })
            return
          }

          const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/sales/${action}`
          const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] vendor-item-sale 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/online-inquiries — 상품별 고객문의 조회 (CS) ──
      // answeredType(ALL/ANSWERED/NOANSWER) 필수, 기간은 7일 이내 제한.
      // 30일 조회는 클라이언트(csService)에서 7일×5회 분할 후 병합.
      server.middlewares.use('/api/coupang/online-inquiries', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const answeredType = url.searchParams.get('answeredType')
          const inquiryStartAt = url.searchParams.get('inquiryStartAt')
          const inquiryEndAt = url.searchParams.get('inquiryEndAt')
          const pageNum = url.searchParams.get('pageNum') || '1'
          const pageSize = url.searchParams.get('pageSize') || '50'

          if (!answeredType || !inquiryStartAt || !inquiryEndAt) {
            sendJson(res, 400, { success: false, error: 'answeredType, inquiryStartAt, inquiryEndAt 파라미터 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/onlineInquiries`
          // vendorId 는 path/query 양쪽 요구 (쿠팡 onlineInquiries 스펙)
          const params: Record<string, string> = {
            vendorId: keys.vendorCode,
            answeredType,
            inquiryStartAt,
            inquiryEndAt,
            pageNum,
            pageSize,
          }

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] online-inquiries 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/ordersheet-by-order?orderId= — 발주서 단건(주문번호) 조회 ──
      // 고객문의(CS) 주문정보 표시용. 응답 data[] = shipmentBox 목록 (orderItems 포함).
      server.middlewares.use('/api/coupang/ordersheet-by-order', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const orderId = url.searchParams.get('orderId')
          if (!orderId) {
            sendJson(res, 400, { success: false, error: 'orderId 파라미터 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/${orderId}/ordersheets`
          const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] ordersheet-by-order 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── POST /api/coupang/online-inquiry-reply — 상품별 고객문의 답변 ──
      // body: { inquiryId, content, replyBy }. content 줄바꿈은 \n (CR 금지).
      server.middlewares.use('/api/coupang/online-inquiry-reply', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const { inquiryId, content, replyBy } = body
          if (!inquiryId || !content || !replyBy) {
            sendJson(res, 400, { success: false, error: 'inquiryId, content, replyBy 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/onlineInquiries/${inquiryId}/replies`
          const result = await callCoupangAPI(
            'POST', apiPath, null,
            keys.accessKey, keys.secretKey,
            { content, vendorId: keys.vendorCode, replyBy },
            keys.vendorCode,
          )

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] online-inquiry-reply 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── POST /api/coupang/order-cancel — 주문 상품 취소 처리 ──
      // body: { orderId, vendorItemIds[], receiptCounts[], bigCancelCode, middleCancelCode, userId }
      //   - vendorItemIds / receiptCounts 는 같은 인덱스끼리 (취소 대상 옵션 + 수량)
      //   - bigCancelCode/middleCancelCode: 취소 사유 코드 (귀책 대분류/소분류)
      //   - userId: 셀러포탈(WING) 로그인 ID
      server.middlewares.use('/api/coupang/order-cancel', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const { orderId, vendorItemIds, receiptCounts, bigCancelCode, middleCancelCode, cancelReason, userId } = body
          if (
            !orderId ||
            !Array.isArray(vendorItemIds) || vendorItemIds.length === 0 ||
            !Array.isArray(receiptCounts) || receiptCounts.length !== vendorItemIds.length ||
            !bigCancelCode || !middleCancelCode || !userId
          ) {
            sendJson(res, 400, { success: false, error: 'orderId, vendorItemIds[], receiptCounts[](길이일치), bigCancelCode, middleCancelCode, userId 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/orders/${orderId}/cancel`
          const cancelBody: Record<string, unknown> = {
            orderId, vendorId: keys.vendorCode, vendorItemIds, receiptCounts, bigCancelCode, middleCancelCode, userId,
          }
          if (cancelReason) cancelBody.cancelReason = cancelReason // 고객 안내용 직접 입력 사유
          const result = await callCoupangAPI(
            'POST', apiPath, null,
            keys.accessKey, keys.secretKey,
            cancelBody,
            keys.vendorCode,
          )

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] order-cancel 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ══════════════════════════════════════════════════════════════
      // 쿠팡 고객센터 문의 (쿠팡문의) — callCenterInquiries
      // ══════════════════════════════════════════════════════════════

      // ── GET /api/coupang/cc-inquiries — 쿠팡 고객센터 문의 조회 (리스트) ──
      // partnerCounselingStatus(NONE/ANSWER/NO_ANSWER/TRANSFER) + 7일 기간
      server.middlewares.use('/api/coupang/cc-inquiries', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const partnerCounselingStatus = url.searchParams.get('partnerCounselingStatus')
          const inquiryStartAt = url.searchParams.get('inquiryStartAt')
          const inquiryEndAt = url.searchParams.get('inquiryEndAt')
          const pageNum = url.searchParams.get('pageNum') || '1'
          const pageSize = url.searchParams.get('pageSize') || '30'

          if (!partnerCounselingStatus || !inquiryStartAt || !inquiryEndAt) {
            sendJson(res, 400, { success: false, error: 'partnerCounselingStatus, inquiryStartAt, inquiryEndAt 파라미터 필수' })
            return
          }

          const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/${keys.vendorCode}/callCenterInquiries`
          const params: Record<string, string> = {
            vendorId: keys.vendorCode,
            partnerCounselingStatus,
            inquiryStartAt,
            inquiryEndAt,
            pageNum,
            pageSize,
          }
          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] cc-inquiries 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/cc-inquiry-detail?inquiryId= — 단건 조회 ──
      // 경로에 vendorId 없음 (쿠팡 스펙). parentAnswerId 확보용.
      server.middlewares.use('/api/coupang/cc-inquiry-detail', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }
          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const inquiryId = url.searchParams.get('inquiryId')
          if (!inquiryId) {
            sendJson(res, 400, { success: false, error: 'inquiryId 파라미터 필수' })
            return
          }
          const apiPath = `/v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/${inquiryId}`
          const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] cc-inquiry-detail 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── POST /api/coupang/cc-inquiry-reply — 문의 답변 ──
      // body: { inquiryId, content, replyBy, parentAnswerId }
      server.middlewares.use('/api/coupang/cc-inquiry-reply', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }
          const body = await parseBody(req)
          const { inquiryId, content, replyBy, parentAnswerId } = body
          if (!inquiryId || !content || !replyBy || !parentAnswerId) {
            sendJson(res, 400, { success: false, error: 'inquiryId, content, replyBy, parentAnswerId 필수' })
            return
          }
          const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/callCenterInquiries/${inquiryId}/replies`
          const result = await callCoupangAPI(
            'POST', apiPath, null,
            keys.accessKey, keys.secretKey,
            { vendorId: keys.vendorCode, inquiryId: String(inquiryId), content, replyBy, parentAnswerId: String(parentAnswerId) },
            keys.vendorCode,
          )
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] cc-inquiry-reply 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── POST /api/coupang/cc-inquiry-confirm — 문의 확인 (TRANSFER 건) ──
      // body: { inquiryId, confirmBy }
      server.middlewares.use('/api/coupang/cc-inquiry-confirm', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }
          const body = await parseBody(req)
          const { inquiryId, confirmBy } = body
          if (!inquiryId || !confirmBy) {
            sendJson(res, 400, { success: false, error: 'inquiryId, confirmBy 필수' })
            return
          }
          const apiPath = `/v2/providers/openapi/apis/api/v4/vendors/${keys.vendorCode}/callCenterInquiries/${inquiryId}/confirms`
          const result = await callCoupangAPI(
            'POST', apiPath, null,
            keys.accessKey, keys.secretKey,
            { confirmBy },
            keys.vendorCode,
          )
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] cc-inquiry-confirm 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      console.log('[coupang-proxy] 쿠팡 API 프록시 미들웨어 등록 완료')
    },
  }
}

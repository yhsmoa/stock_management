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

// ══════════════════════════════════════════════════════════════════
// 일반상품(판매자배송) 상품 API 상수 — prodServer.js 와 같은 값
// ══════════════════════════════════════════════════════════════════

/** 상품 목록 페이징 조회 maxPerPage 최대값 (쿠팡 문서: 기본 10, 최대 100) */
const PRODUCT_LIST_MAX_PER_PAGE = 100
/** 상품 목록 status 필터 허용값 (쿠팡 문서) */
const PRODUCT_LIST_STATUSES = ['IN_REVIEW', 'SAVED', 'APPROVING', 'APPROVED', 'PARTIAL_APPROVED', 'DENIED', 'DELETED']
const SELLER_PRODUCTS_PATH = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
const VENDOR_ITEMS_PATH = '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items'

/** 숫자 ID 경로값 검증 — 경로에 그대로 넣으므로 숫자만 허용 */
function isNumericId(v: unknown): v is string {
  return typeof v === 'string' && /^\d+$/.test(v)
}

/** 0 이상 정수 */
function toNonNegativeInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * 상품 수정(승인불필요, partial) 허용 필드 — 쿠팡 문서 그대로. 그 외 키는 프록시가 버린다.
 * prodServer.js 의 PARTIAL_UPDATE_FIELDS 와 같아야 한다.
 */
const PARTIAL_UPDATE_FIELDS = [
  'companyContactNumber', 'deliveryCharge', 'deliveryChargeOnReturn', 'deliveryChargeType',
  'deliveryCompanyCode', 'deliveryMethod', 'extraInfoMessage', 'freeShipOverAmount',
  'outboundShippingPlaceCode', 'outboundShippingTimeDay', 'pccNeeded', 'remoteAreaDeliverable',
  'returnAddress', 'returnAddressDetail', 'returnCenterCode', 'returnCharge', 'returnChargeName',
  'returnZipCode', 'unionDeliveryType',
]

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

      // ════════════════════════════════════════════════════════════
      // 일반상품(판매자배송) 관리 — 상품관리 화면 (/coupang)
      //   - 상세 조회는 기존 /api/coupang/rg-product/:id 를 같이 쓴다 (같은 seller-products 엔드포인트)
      // ════════════════════════════════════════════════════════════

      // ── GET /api/coupang/mp-products — 상품 목록 페이징 (businessTypes 없음 → 일반 + 하이브리드) ──
      // query: nextToken?, maxPerPage?(1~100), status?
      server.middlewares.use('/api/coupang/mp-products', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const nextToken = url.searchParams.get('nextToken')
          const status = url.searchParams.get('status')
          const maxPerPage = toNonNegativeInt(url.searchParams.get('maxPerPage') ?? PRODUCT_LIST_MAX_PER_PAGE)
          if (!maxPerPage || maxPerPage > PRODUCT_LIST_MAX_PER_PAGE) {
            sendJson(res, 400, { success: false, error: `maxPerPage 는 1~${PRODUCT_LIST_MAX_PER_PAGE}` })
            return
          }
          if (status && !PRODUCT_LIST_STATUSES.includes(status)) {
            sendJson(res, 400, { success: false, error: `status 허용값: ${PRODUCT_LIST_STATUSES.join(', ')}` })
            return
          }

          const params: Record<string, string> = { vendorId: keys.vendorCode, maxPerPage: String(maxPerPage) }
          if (nextToken) params.nextToken = nextToken
          if (status) params.status = status

          const result = await callCoupangAPI('GET', SELLER_PRODUCTS_PATH, params, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] mp-products 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/product-histories?sellerProductId= — 상품 상태변경 이력 ──
      // query: sellerProductId, nextToken?, maxPerPage?
      server.middlewares.use('/api/coupang/product-histories', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const sellerProductId = url.searchParams.get('sellerProductId')
          if (!isNumericId(sellerProductId)) {
            sendJson(res, 400, { success: false, error: 'sellerProductId(숫자) 필요' })
            return
          }
          const params: Record<string, string> = {}
          const nextToken = url.searchParams.get('nextToken')
          const maxPerPage = url.searchParams.get('maxPerPage')
          if (nextToken) params.nextToken = nextToken
          if (maxPerPage && toNonNegativeInt(maxPerPage)) params.maxPerPage = maxPerPage

          const apiPath = `${SELLER_PRODUCTS_PATH}/${sellerProductId}/histories`
          const result = await callCoupangAPI('GET', apiPath, Object.keys(params).length ? params : null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] product-histories 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/vendor-item-quantity — 아이템별 수량(재고) 변경 ──
      // body: { vendorItemId, quantity(0 이상 정수) }
      server.middlewares.use('/api/coupang/vendor-item-quantity', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const vendorItemId = String(body.vendorItemId ?? '')
          const quantity = toNonNegativeInt(body.quantity)
          if (!isNumericId(vendorItemId) || quantity === null) {
            sendJson(res, 400, { success: false, error: 'vendorItemId(숫자), quantity(0 이상 정수) 필수' })
            return
          }

          const apiPath = `${VENDOR_ITEMS_PATH}/${vendorItemId}/quantities/${quantity}`
          const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] vendor-item-quantity 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/vendor-item-original-price — 아이템별 할인율 기준가격 변경 ──
      // body: { vendorItemId, originalPrice(0 이상, 10원 단위) }
      server.middlewares.use('/api/coupang/vendor-item-original-price', async (req: any, res: any) => {
        try {
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const vendorItemId = String(body.vendorItemId ?? '')
          const originalPrice = toNonNegativeInt(body.originalPrice)
          if (!isNumericId(vendorItemId) || originalPrice === null) {
            sendJson(res, 400, { success: false, error: 'vendorItemId(숫자), originalPrice(0 이상 정수) 필수' })
            return
          }
          if (originalPrice % 10 !== 0) {
            sendJson(res, 400, { success: false, error: 'originalPrice 는 10원 단위여야 합니다.' })
            return
          }

          const apiPath = `${VENDOR_ITEMS_PATH}/${vendorItemId}/original-prices/${originalPrice}`
          const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, undefined, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] vendor-item-original-price 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/seller-product-partial — 상품 수정 (승인불필요: 배송·반품) ──
      // body: { sellerProductId, ...허용 필드(PARTIAL_UPDATE_FIELDS) }. 임시저장·승인대기 상품은 쿠팡이 거절한다.
      server.middlewares.use('/api/coupang/seller-product-partial', async (req: any, res: any) => {
        try {
          if (req.method !== 'PUT') { sendJson(res, 405, { success: false, error: 'PUT 만 허용' }); return }
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          const sellerProductId = String(body.sellerProductId ?? '')
          if (!isNumericId(sellerProductId)) {
            sendJson(res, 400, { success: false, error: 'sellerProductId(숫자) 필수' })
            return
          }
          const payload: Record<string, unknown> = { sellerProductId: Number(sellerProductId) }
          for (const key of PARTIAL_UPDATE_FIELDS) if (body[key] !== undefined) payload[key] = body[key]
          if (Object.keys(payload).length === 1) {
            sendJson(res, 400, { success: false, error: '바꿀 필드가 없습니다.' })
            return
          }

          const apiPath = `${SELLER_PRODUCTS_PATH}/${sellerProductId}/partial`
          const result = await callCoupangAPI('PUT', apiPath, null, keys.accessKey, keys.secretKey, payload, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] seller-product-partial 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── PUT /api/coupang/seller-product — 상품 수정 (승인필요: 상품 전문) ──
      // body: 상품 조회 응답 전문에서 바꿀 칸만 고친 것 + requested(true = 승인요청 자동). 승인 뒤 반영된다.
      server.middlewares.use('/api/coupang/seller-product', async (req: any, res: any) => {
        try {
          if (req.method !== 'PUT') { sendJson(res, 405, { success: false, error: 'PUT 만 허용' }); return }
          const keys = extractCoupangKeys(req)
          if (!keys) {
            sendJson(res, 401, { success: false, error: '쿠팡 API 키가 요청에 포함되지 않았습니다.' })
            return
          }

          const body = await parseBody(req)
          if (!isNumericId(String(body.sellerProductId ?? '')) || !Array.isArray(body.items) || body.items.length === 0) {
            sendJson(res, 400, { success: false, error: 'sellerProductId(숫자) · items(1개 이상) 필수 — 상품 조회 응답 전문을 보내야 합니다.' })
            return
          }
          // 다른 판매자 상품을 고치지 않도록 vendorId 는 헤더의 값으로 맞춘다
          const payload = { ...body, vendorId: keys.vendorCode }

          const result = await callCoupangAPI('PUT', SELLER_PRODUCTS_PATH, null, keys.accessKey, keys.secretKey, payload, keys.vendorCode)
          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] seller-product 오류:', error.message)
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

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
) {
  const baseUrl = 'https://api-gateway.coupang.com'
  const queryString = queryParams
    ? new URLSearchParams(queryParams).toString()
    : ''
  const authorization = generateAuth(method, apiPath, queryString, accessKey, secretKey)
  const fullUrl = baseUrl + apiPath + (queryString ? '?' + queryString : '')

  const response = await fetch(fullUrl, {
    method,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  return response.json()
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

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey)

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
          const result = await callCoupangAPI('GET', apiPath, null, keys.accessKey, keys.secretKey)

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

          const result = await callCoupangAPI('GET', apiPath, params, keys.accessKey, keys.secretKey)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] ordersheets 오류:', error.message)
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
          )

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] ordersheets-acknowledge 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      console.log('[coupang-proxy] 쿠팡 API 프록시 미들웨어 등록 완료')
    },
  }
}

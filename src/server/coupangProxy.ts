/* ================================================================
   Vite Plugin: Coupang API Proxy
   - configureServer 미들웨어로 /api/coupang/* 엔드포인트 제공
   - HMAC-SHA256 서명은 서버 사이드에서 처리 (SECRET_KEY 보호)
   - 브라우저 → Vite 서버 → Coupang API Gateway
   ================================================================ */

import type { Plugin } from 'vite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ── .env 파일에서 Coupang 키 로드 ─────────────────────────────────
function loadCoupangEnv(rootDir: string) {
  const envPath = path.join(rootDir, '.env')
  const envContent = fs.readFileSync(envPath, 'utf-8')
  const env: Record<string, string> = {}
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=#]+?)\s*=\s*(.+)$/)
    if (match) env[match[1].trim()] = match[2].trim()
  }
  return {
    accessKey: env.COUPANG_ACCESS_KEY,
    secretKey: env.COUPANG_SECRET_KEY,
    vendorCode: env.VENDOR_CODE,
  }
}

// ── HMAC-SHA256 서명 생성 (test-coupang-api.mjs 로직 재사용) ──────
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

// ── Coupang API 호출 함수 ─────────────────────────────────────────
async function callCoupangAPI(
  method: string,
  apiPath: string,
  queryParams: Record<string, string> | null,
  accessKey: string,
  secretKey: string,
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
  })

  return response.json()
}

// ── JSON 응답 헬퍼 ────────────────────────────────────────────────
function sendJson(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// ── Vite Plugin 본체 ──────────────────────────────────────────────
export function coupangProxyPlugin(): Plugin {
  return {
    name: 'coupang-proxy',
    configureServer(server) {
      const { accessKey, secretKey, vendorCode } = loadCoupangEnv(server.config.root)

      if (!accessKey || !secretKey || !vendorCode) {
        console.warn('[coupang-proxy] .env에 COUPANG 키가 없습니다. 프록시 비활성화.')
        return
      }

      // ── GET /api/coupang/rg-products — 상품 목록 조회 ───────────
      // nextToken 지원: 첫 호출은 pageNum, 이후는 nextToken으로 순회
      server.middlewares.use('/api/coupang/rg-products', async (req: any, res: any) => {
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host}`)
          const nextToken = url.searchParams.get('nextToken')
          const pageSize = url.searchParams.get('pageSize') || '50'

          const apiPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
          const params: Record<string, string> = {
            vendorId: vendorCode,
            businessTypes: 'rocketGrowth',
            maxPerPage: pageSize,
          }
          if (nextToken) {
            params.nextToken = nextToken
          }

          const result = await callCoupangAPI('GET', apiPath, params, accessKey, secretKey)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] rg-products 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      // ── GET /api/coupang/rg-product/{sellerProductId} — 상세 조회 ─
      server.middlewares.use('/api/coupang/rg-product/', async (req: any, res: any) => {
        try {
          // Vite 미들웨어는 등록 경로를 req.url에서 제거함
          // /api/coupang/rg-product/12345 → req.url = /12345
          const sellerProductId = (req.url || '').replace(/^\//, '').split('?')[0]

          if (!sellerProductId) {
            sendJson(res, 400, { success: false, error: 'sellerProductId 필요' })
            return
          }

          const apiPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`
          const result = await callCoupangAPI('GET', apiPath, null, accessKey, secretKey)

          sendJson(res, 200, { success: true, data: result })
        } catch (error: any) {
          console.error('[coupang-proxy] rg-product 오류:', error.message)
          sendJson(res, 500, { success: false, error: error.message })
        }
      })

      console.log('[coupang-proxy] 쿠팡 API 프록시 미들웨어 등록 완료')
    },
  }
}

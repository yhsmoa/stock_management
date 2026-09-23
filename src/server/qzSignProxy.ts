/* ================================================================
   Vite Plugin: QZ Tray 인증서 · 요청 서명 (라벨 인쇄)
   - GET  /api/qz/cert  — 공개 인증서 (?download=1 이면 override.crt 로 내려줌)
   - POST /api/qz/sign  — body { request } 를 SHA512withRSA 로 서명
   - 운영(Railway)은 prodServer.js 의 같은 라우트가 담당한다 — 바꾸면 양쪽을 같이 고친다
   - 개발 서버는 .env 의 QZ_CERTIFICATE / QZ_PRIVATE_KEY 를 읽는다 (VITE_ 접두어 없음 → 브라우저로 안 나감)

   왜 필요한가
     qz-tray.js 는 인쇄·프린터 조회마다 호출 내용을 해시해 서명을 받아 QZ Tray 에 보낸다.
     인쇄 PC 의 QZ Tray 가 같은 인증서를 override.crt 로 신뢰하면 허용 창 없이 실행된다.
     개인키는 서버에만 있어야 하므로 브라우저에서 서명할 수 없다.
   ================================================================ */

import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto'

// ══════════════════════════════════════════════════════════════════
// 설정
// ══════════════════════════════════════════════════════════════════

/** 클라이언트(utils/label/qzTray.ts)의 setSignatureAlgorithm('SHA512') 과 같아야 한다 */
const SIGN_ALGORITHM = 'RSA-SHA512'
/** 해시 문자열(64자) + 여유. 이보다 길면 정상 요청이 아니다 */
const MAX_REQUEST_LEN = 512

/** env 의 \n 이스케이프를 실제 개행으로 */
function readPem(raw: string | undefined): string | null {
  if (!raw) return null
  return raw.replace(/\\n/g, '\n').trim()
}

// ── JSON 응답 · body 파싱 헬퍼 ─────────────────────────────────────
function sendJson(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

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

export function qzSignProxyPlugin(): Plugin {
  let certificate: string | null = null
  let privateKey: KeyObject | null = null

  return {
    name: 'qz-sign-proxy',

    // ── .env 에서 인증서·개인키 읽기 (1회 파싱) ──
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), '')
      certificate = readPem(env.QZ_CERTIFICATE)
      const keyPem = readPem(env.QZ_PRIVATE_KEY)
      if (keyPem) {
        try {
          privateKey = createPrivateKey(keyPem)
        } catch (error: any) {
          console.error('[qz-sign-proxy] QZ_PRIVATE_KEY 파싱 실패:', error.message)
        }
      }
    },

    configureServer(server) {
      // ── GET /api/qz/cert — 공개 인증서 ──────────────────────────
      //   없으면 404 → 클라이언트는 익명 모드(허용 창이 뜸)로 동작
      server.middlewares.use('/api/qz/cert', (req: any, res: any) => {
        if (!certificate) {
          res.statusCode = 404
          res.end('QZ_CERTIFICATE 가 설정되지 않았습니다.')
          return
        }
        const url = new URL(req.url || '/', `http://${req.headers.host}`)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/x-pem-file; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (url.searchParams.get('download') === '1') {
          res.setHeader('Content-Disposition', 'attachment; filename="override.crt"')
        }
        res.end(certificate + '\n')
      })

      // ── POST /api/qz/sign — 요청 서명 ───────────────────────────
      server.middlewares.use('/api/qz/sign', async (req: any, res: any) => {
        try {
          if (!privateKey) {
            sendJson(res, 404, { success: false, error: 'QZ_PRIVATE_KEY 가 설정되지 않았습니다.' })
            return
          }
          const body = await parseBody(req).catch(() => null)
          const toSign = body?.request
          if (typeof toSign !== 'string' || !toSign || toSign.length > MAX_REQUEST_LEN) {
            sendJson(res, 400, { success: false, error: '서명할 요청 문자열이 올바르지 않습니다.' })
            return
          }
          const signer = createSign(SIGN_ALGORITHM)
          signer.update(toSign, 'utf8')
          sendJson(res, 200, { success: true, signature: signer.sign(privateKey, 'base64') })
        } catch (error: any) {
          console.error('[qz-sign-proxy] 서명 오류:', error.message)
          sendJson(res, 500, { success: false, error: '서명 중 오류가 발생했습니다.' })
        }
      })
    },
  }
}

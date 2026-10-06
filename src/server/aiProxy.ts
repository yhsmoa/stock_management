/* ================================================================
   Vite Plugin: 고객문의 AI 답변 (OpenAI 프록시)
   - POST /api/ai/inquiry-replies — body { items: InquiryAiContext[] } → { success, data: InquiryReplyDraft[] }
   - 프롬프트·검증·OpenAI 호출은 ai/inquiryReplyAi.js (운영 prodServer.js 와 공용)
   - 개발 서버는 .env 의 OPENAI_API_KEY / OPENAI_MODEL 을 읽는다 (VITE_ 접두어 없음 → 브라우저로 안 나감)
   - 운영(Railway)은 prodServer.js 의 같은 라우트가 담당한다 — 라우트를 바꾸면 양쪽을 같이 고친다
   ================================================================ */

import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { generateInquiryReplies, AiRequestError } from './ai/inquiryReplyAi'

// ── JSON 응답 · body 파싱 헬퍼 (qzSignProxy 와 동일) ───────────────
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

export function aiProxyPlugin(): Plugin {
  let apiKey = ''
  let model = ''

  return {
    name: 'ai-proxy',

    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), '')
      apiKey = (env.OPENAI_API_KEY || '').trim()
      model = (env.OPENAI_MODEL || '').trim()
      if (!apiKey) console.warn('[ai-proxy] OPENAI_API_KEY 가 없어 [AI 답변] 이 동작하지 않습니다 (.env 에 추가).')
    },

    configureServer(server) {
      // ── POST /api/ai/inquiry-replies ────────────────────────────
      server.middlewares.use('/api/ai/inquiry-replies', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'POST 만 지원합니다.' })
          return
        }
        try {
          const body = await parseBody(req).catch(() => null)
          const data = await generateInquiryReplies({ apiKey, model, items: body?.items })
          sendJson(res, 200, { success: true, data })
        } catch (error: any) {
          const status = error instanceof AiRequestError ? error.status : 500
          console.error('[ai-proxy] 초안 생성 오류:', error?.message)
          sendJson(res, status, { success: false, error: error?.message ?? 'AI 답변 생성 중 오류가 발생했습니다.' })
        }
      })
    },
  }
}

/* ================================================================
   고객문의 AI 답변 — 서버 공용 코어 (OpenAI 호출)
   - 개발(aiProxy.ts · Vite 플러그인)과 운영(prodServer.js · Express)이 이 모듈 하나를 쓴다.
     → 엔드포인트 껍데기만 양쪽에 있고, 프롬프트·검증·호출은 여기 한 곳.
   - CommonJS 인 이유: prodServer.js 가 node 로 바로 실행되는 CJS 이고, Vite 설정 번들러는 CJS 도 import 한다.
     타입은 옆의 inquiryReplyAi.d.ts.
   - 규칙서 customerInquiryGuide.md 를 instructions(system prompt) 에 그대로 넣는다 (파일이 단일 기준).
   - OpenAI Responses API (/v1/responses) + Structured Outputs(text.format json_schema strict). store:false.
   - 키: env OPENAI_API_KEY (Railway 환경변수 / 개발은 .env, VITE_ 접두어 없음 → 브라우저로 안 나감)
     모델: env OPENAI_MODEL (없으면 DEFAULT_MODEL)
   ================================================================ */

const fs = require('node:fs')
const path = require('node:path')

// ══════════════════════════════════════════════════════════════════
// 설정
// ══════════════════════════════════════════════════════════════════

const GUIDE_PATH = path.join(__dirname, 'customerInquiryGuide.md')
/** Responses API (2026 기준 권장 엔드포인트 — Chat Completions 는 구형) */
const OPENAI_URL = 'https://api.openai.com/v1/responses'
/**
 * 기본 모델 (2026-10 기준 현역: gpt-6-astra › gpt-6.1-sol › gpt-6-luna)
 * - 답변 품질이 우선이라 중간급 sol. 월 수백 건 규모라 비용 차이는 미미하다.
 * - 더 싸게 쓰려면 env OPENAI_MODEL=gpt-6-luna
 */
const DEFAULT_MODEL = 'gpt-6.1-sol'
/** 추론 강도 — 템플릿 기반 답변이라 low 로 충분하고 빠르다 (기본값 medium) */
const REASONING_EFFORT = 'low'
/** 출력 상한 — 10건 × 답변 300토큰 정도. 폭주 방지용 */
const MAX_OUTPUT_TOKENS = 12000

/** 한 요청에 받는 문의 수 상한 (화면 한 페이지 20건 + 여유) */
const MAX_ITEMS = 50
/** OpenAI 한 번 호출에 넣는 문의 수 — 출력이 길어지면 품질·지연이 나빠져 나눠 보낸다 */
const CHUNK_SIZE = 10
/** 입력 길이 상한 (토큰 폭주 방지) */
const MAX_CONTENT_LEN = 2000
const MAX_HISTORY_ITEMS = 10
const MAX_ANSWERS = 5
/** OpenAI 응답 대기 상한 */
const TIMEOUT_MS = 60_000

/** 가이드 2장의 그룹 키 — renderer/services/inquiryAiService.ts 의 INQUIRY_CATEGORY_LABELS 와 같아야 한다 */
const CATEGORY_KEYS = [
  'CANCEL_REQUEST', 'CANCEL_CONFIRM', 'SELLER_CANCELLED', 'DELIVERY', 'NOT_RECEIVED',
  'RETURN_REQUEST', 'RETURN_DEFECT', 'RETURN_CONFIRM', 'EXCHANGE_REQUEST', 'RETURN_FEE_DISPUTE',
  'RETURN_PICKUP', 'REFUND_STATUS', 'PRODUCT_INFO', 'ORDER_OPTION', 'ADDRESS_CHANGE',
  'CONTACT_REQUEST', 'NO_ORDER_INFO', 'COMPLAINT', 'ACK', 'OTHER',
]
const REQUIRED_ACTIONS = ['CANCEL_ORDER', 'STOP_SHIPMENT', 'RETURN_REQUEST']

// ── 요청 오류 (HTTP 상태를 함께 들고 다닌다) ────────────────────────
class AiRequestError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}

// ══════════════════════════════════════════════════════════════════
// 규칙서 · 프롬프트
// ══════════════════════════════════════════════════════════════════

let guideCache = null
/** 규칙서 본문 (최초 1회 읽고 캐시 — 바꾸면 서버 재시작) */
function loadGuide() {
  if (guideCache === null) guideCache = fs.readFileSync(GUIDE_PATH, 'utf8')
  return guideCache
}

/** 오늘 날짜 yyyy-MM-dd (KST) — 지연 판정(가이드 3장) 기준 */
function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function buildSystemPrompt() {
  return [
    '당신은 쿠팡 판매자(안녕릴리) 고객문의 담당자의 답변 초안을 쓰는 보조자입니다.',
    '아래 규칙서를 따르고, 규칙서에 없는 사실은 지어내지 않습니다.',
    `오늘 날짜(KST): ${todayKst()}`,
    '',
    '=== 규칙서 시작 ===',
    loadGuide(),
    '=== 규칙서 끝 ===',
    '',
    '## 실행 지시',
    '- 입력은 문의 배열(JSON)입니다. 문의마다 초안 하나를 만들어 같은 inquiryId 로 돌려줍니다. 빠뜨리지 않습니다.',
    '- 규칙서의 그룹은 "이런 문의에는 이렇게"라는 안내입니다. 한 문의에 여러 상황이 섞였으면 템플릿을 합쳐 쓰고, category 에는 가장 중심이 되는 그룹을 적습니다.',
    '- reply 는 고객에게 보내는 본문 그대로(인사말·끝인사 포함, 줄바꿈 \\n). note 는 담당자용 한 줄입니다.',
    '- 담당자가 채워야 하는 자리는 reply 안에 [담당자: …] 형태로 남기고 needsHuman 을 true 로 합니다.',
    '- 답변이 "처리 도와드렸습니다"처럼 실제 처리를 전제하면 requiredAction 을 반드시 채웁니다.',
  ].join('\n')
}

// ══════════════════════════════════════════════════════════════════
// 입력 검증 (브라우저가 보낸 items)
// ══════════════════════════════════════════════════════════════════

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** items 배열을 검증·정리. 형식이 틀리면 AiRequestError(400) */
function sanitizeItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new AiRequestError(400, '문의 목록(items)이 비어 있습니다.')
  if (raw.length > MAX_ITEMS) throw new AiRequestError(400, `한 번에 ${MAX_ITEMS}건까지만 요청할 수 있습니다.`)

  return raw.map((it, idx) => {
    const inquiryId = Number(it && it.inquiryId)
    const content = str(it && it.content, MAX_CONTENT_LEN).trim()
    if (!Number.isFinite(inquiryId) || !content) {
      throw new AiRequestError(400, `${idx + 1}번째 문의에 inquiryId 또는 content 가 없습니다.`)
    }
    const product = it.product && typeof it.product === 'object'
      ? { name: str(it.product.name, 200), option: str(it.product.option, 200) }
      : null
    const order = it.order && typeof it.order === 'object'
      ? {
          orderId: str(it.order.orderId, 40),
          status: str(it.order.status, 40),
          statusLabel: str(it.order.statusLabel, 40),
          orderedAt: it.order.orderedAt ? str(it.order.orderedAt, 30) : null,
          estimatedShippingDate: it.order.estimatedShippingDate ? str(it.order.estimatedShippingDate, 30) : null,
          hasInvoice: Boolean(it.order.hasInvoice),
          shippingCount: Number(it.order.shippingCount) || 0,
        }
      : null
    const previousAnswers = (Array.isArray(it.previousAnswers) ? it.previousAnswers : [])
      .slice(0, MAX_ANSWERS).map((a) => str(a, MAX_CONTENT_LEN))
    const history = (Array.isArray(it.history) ? it.history : [])
      .slice(0, MAX_HISTORY_ITEMS)
      .map((h) => ({
        inquiryAt: str(h && h.inquiryAt, 30),
        content: str(h && h.content, MAX_CONTENT_LEN),
        answers: (Array.isArray(h && h.answers) ? h.answers : []).slice(0, MAX_ANSWERS).map((a) => str(a, MAX_CONTENT_LEN)),
      }))
    return { inquiryId, inquiryAt: str(it.inquiryAt, 30), content, product, order, previousAnswers, history }
  })
}

// ══════════════════════════════════════════════════════════════════
// OpenAI 호출 (Responses API · Structured Outputs — 가이드 4장 출력 형식)
// ══════════════════════════════════════════════════════════════════

/** text.format — JSON 스키마 (strict: 모든 필드 필수, 추가 필드 금지) */
function buildTextFormat() {
  return {
    type: 'json_schema',
    name: 'inquiry_reply_drafts',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          drafts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                inquiryId: { type: 'integer' },
                category: { type: 'string', enum: CATEGORY_KEYS },
                reply: { type: 'string' },
                requiredAction: { type: ['string', 'null'], enum: [...REQUIRED_ACTIONS, null] },
                needsHuman: { type: 'boolean' },
                note: { type: 'string' },
              },
              required: ['inquiryId', 'category', 'reply', 'requiredAction', 'needsHuman', 'note'],
            },
          },
        },
        required: ['drafts'],
    },
  }
}

/** Responses API 응답에서 본문 텍스트를 꺼낸다 (거부·미완성은 AiRequestError) */
function extractOutputText(json) {
  if (json && json.status === 'incomplete') {
    const reason = json.incomplete_details && json.incomplete_details.reason
    throw new AiRequestError(502, `OpenAI 응답이 중간에 끊겼습니다 (${reason || 'unknown'}). 문의 수를 줄여 다시 시도하세요.`)
  }
  const output = Array.isArray(json && json.output) ? json.output : []
  for (const item of output) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (part && part.type === 'refusal') throw new AiRequestError(502, `OpenAI 가 생성을 거부했습니다: ${part.refusal}`)
      if (part && part.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  throw new AiRequestError(502, 'OpenAI 응답에 본문이 없습니다.')
}

/** 한 묶음(≤ CHUNK_SIZE) 호출 → drafts 배열 */
async function callOpenAi({ apiKey, model, items, systemPrompt }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: JSON.stringify({ inquiries: items }),
        text: { format: buildTextFormat() },
        reasoning: { effort: REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false, // 고객 문의 본문을 OpenAI 쪽에 남기지 않는다
      }),
    })
  } catch (err) {
    if (err && err.name === 'AbortError') throw new AiRequestError(504, 'OpenAI 응답이 시간 안에 오지 않았습니다.')
    throw new AiRequestError(502, `OpenAI 연결 실패: ${err && err.message}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = null }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 300)
    // 401/429 등은 그대로 상태를 전달해 원인(키·한도)을 바로 알 수 있게 한다
    throw new AiRequestError(res.status === 401 ? 401 : 502, `OpenAI 오류 (${res.status}): ${msg}`)
  }

  const outputText = extractOutputText(json)
  let parsed
  try { parsed = JSON.parse(outputText) } catch {
    throw new AiRequestError(502, 'OpenAI 응답을 JSON 으로 읽을 수 없습니다.')
  }
  return Array.isArray(parsed && parsed.drafts) ? parsed.drafts : []
}

// ══════════════════════════════════════════════════════════════════
// 진입점
// ══════════════════════════════════════════════════════════════════

/**
 * 예상 답변 초안 생성
 * @param {{ apiKey?: string, model?: string, items: unknown }} params
 * @returns {Promise<Array<{inquiryId:number, category:string, reply:string, requiredAction:string|null, needsHuman:boolean, note:string}>>}
 *   요청 순서대로. 모델이 빠뜨린 문의는 결과에 없다 (브라우저가 "N건 못 받음"으로 안내).
 */
async function generateInquiryReplies({ apiKey, model, items }) {
  if (!apiKey) {
    throw new AiRequestError(503, 'OPENAI_API_KEY 가 설정되지 않았습니다. (Railway 환경변수 / 개발은 .env)')
  }
  const clean = sanitizeItems(items)
  const systemPrompt = buildSystemPrompt()
  const useModel = model || DEFAULT_MODEL

  // 묶음으로 나눠 병렬 호출 (묶음 수는 최대 MAX_ITEMS / CHUNK_SIZE = 5)
  const chunks = []
  for (let i = 0; i < clean.length; i += CHUNK_SIZE) chunks.push(clean.slice(i, i + CHUNK_SIZE))
  const results = await Promise.all(
    chunks.map((chunk) => callOpenAi({ apiKey, model: useModel, items: chunk, systemPrompt })),
  )

  // 요청한 inquiryId 만, 요청 순서대로, 중복은 첫 것만
  const byId = new Map()
  for (const d of results.flat()) {
    const id = Number(d && d.inquiryId)
    if (!byId.has(id) && typeof (d && d.reply) === 'string' && d.reply.trim()) {
      byId.set(id, {
        inquiryId: id,
        category: CATEGORY_KEYS.includes(d.category) ? d.category : 'OTHER',
        reply: d.reply.replace(/\r\n/g, '\n').trim(),
        requiredAction: REQUIRED_ACTIONS.includes(d.requiredAction) ? d.requiredAction : null,
        needsHuman: Boolean(d.needsHuman),
        note: typeof d.note === 'string' ? d.note.trim() : '',
      })
    }
  }
  return clean.map((it) => byId.get(it.inquiryId)).filter(Boolean)
}

module.exports = { generateInquiryReplies, AiRequestError, DEFAULT_MODEL }

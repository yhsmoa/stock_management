/* ================================================================
   inquiryReplyAi.js 타입 선언 — aiProxy.ts(Vite 플러그인)가 CJS 코어를 import 할 때 쓴다
   ================================================================ */

export interface InquiryReplyDraft {
  inquiryId: number
  category: string
  reply: string
  requiredAction: 'CANCEL_ORDER' | 'STOP_SHIPMENT' | 'RETURN_REQUEST' | null
  needsHuman: boolean
  note: string
}

export declare class AiRequestError extends Error {
  status: number
  constructor(status: number, message: string)
}

export declare const DEFAULT_MODEL: string

export declare function generateInquiryReplies(params: {
  apiKey?: string
  model?: string
  items: unknown
}): Promise<InquiryReplyDraft[]>

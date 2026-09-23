/* ================================================================
   라벨 템플릿 서비스 (label_templates · label_print_logs · si_users)
   - 라벨 설정 화면([라벨 설정])과 상품관리 [라벨출력] 모달이 같이 쓴다
   - 이 앱은 출처 'stock' 템플릿만 읽고 쓴다 (APP_LABEL_SOURCE).
     같은 표에 아이엠몽 로켓(label-service)의 'rocket' 템플릿도 있다 — 건드리지 않는다
   - 1000-row 페이지네이션 (CLAUDE.md 룰 5) — 템플릿은 수십 건 규모지만 규칙대로 루프

   권한 규칙 (label-service 의 /api/label-templates 에서 옮겨 옴)
     · 조회: "내 계정이 배정된 템플릿 + 공용(user_ids NULL)"
     · 저장: user_ids 는 공용(null) 아니면 [내 id] 로만 — 다른 계정에 배정하는 경로는 없다
     · 수정·삭제: 공용이거나 내 계정이 배정된 템플릿만
     · 기본 템플릿(is_default): 같은 그룹(공용끼리 / 겹치는 사용자) · 같은 종류 · 겹치는 대상에서 1개
       (배열 겹침이라 DB 유니크 인덱스로 표현이 안 돼 여기서 강제한다)
   ※ 이 앱의 다른 표처럼 anon 키 + RLS 없음 → 규칙은 화면 실수 방지 수준이다.
   ================================================================ */

import { supabase } from './supabase'
import {
  APP_LABEL_SOURCE,
  normalizePrinterLang,
  type LabelAudience,
  type LabelTemplate,
  type LabelType,
} from '../utils/label/labelTypes'

// ── 상수 ──────────────────────────────────────────────────────────
const TEMPLATE_TABLE = 'label_templates'
const LOG_TABLE = 'label_print_logs'
const PAGE_SIZE = 1000
const AUDIENCE_KEYS: LabelAudience[] = ['adult', 'kids']

/** 계정 정보 바인딩(acc_*)에 쓰는 si_users 컬럼 — 비밀번호·쿠팡 키는 읽지 않는다 */
const LABEL_USER_COLUMNS = 'id, username, name, seller_id, vendor_id, phone_number, email_address'

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

/** si_users 행 (민감 컬럼 제외) — 라벨의 계정 정보 필드(acc_*)에 바인딩된다 */
export interface LabelUser {
  id: string
  username: string
  name: string | null
  seller_id: string | null
  vendor_id?: string | null
  phone_number?: string | null
  email_address?: string | null
}

/** 저장 페이로드 — id 가 없으면 새 템플릿 */
export interface LabelTemplateInput {
  id?: string
  /** 공용이면 null. 값이 있으면 [내 id] 로 고정된다 (배열 안의 값은 무시) */
  user_ids: string[] | null
  name: string
  description: string | null
  audiences: LabelAudience[]
  label_type: LabelType
  printer_lang: string
  width_mm: number
  height_mm: number
  gap_mm: number
  media: string
  cutter: string
  dpi: number
  density: number | null
  speed: number | null
  layout: unknown
  is_default: boolean
}

/** 인쇄 기록 1행 */
export interface LabelPrintLogInput {
  template_id: string
  user_id: string | null
  barcode: string | null
  item_name: string | null
  qty: number
  label_type: LabelType
  printed_by: string | null
}

// ══════════════════════════════════════════════════════════════════
// 정규화 헬퍼
// ══════════════════════════════════════════════════════════════════

/** 대상 — 알 수 없는 값 제거, 비면 성인 */
function normalizeAudiences(value: unknown): LabelAudience[] {
  const list = Array.isArray(value)
    ? value.filter((v): v is LabelAudience => AUDIENCE_KEYS.includes(v as LabelAudience))
    : []
  return list.length > 0 ? Array.from(new Set(list)) : ['adult']
}

/** 설명 — 공백만 있으면 null */
function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return s ? s : null
}

/** 공용이면 null, 아니면 [내 id] — 다른 계정에 배정하는 건 불가 */
function ownedUserIds(raw: string[] | null, myId: string): string[] | null {
  return raw && raw.length > 0 ? [myId] : null
}

/** 공용이거나 내 계정이 배정된 템플릿인지 */
function isEditableBy(userIds: string[] | null, myId: string): boolean {
  const ids = userIds ?? []
  return ids.length === 0 || ids.includes(myId)
}

// ══════════════════════════════════════════════════════════════════
// 조회
// ══════════════════════════════════════════════════════════════════

/** 이 계정이 쓸 수 있는 stock 템플릿 전체 (내 것 + 공용), 만든 순 */
export async function fetchLabelTemplates(userId: string): Promise<LabelTemplate[]> {
  if (!userId) return []

  const result: LabelTemplate[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(TEMPLATE_TABLE)
      .select('*')
      .eq('source', APP_LABEL_SOURCE)
      .or(`user_ids.cs.{${userId}},user_ids.is.null`)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[fetchLabelTemplates]', error)
      throw error
    }
    const rows = (data ?? []) as LabelTemplate[]
    result.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return result
}

/** 라벨 계정 정보 — 로그인 계정 1명 (없으면 null) */
export async function fetchLabelUser(userId: string): Promise<LabelUser | null> {
  if (!userId) return null
  const { data, error } = await supabase
    .from('si_users')
    .select(LABEL_USER_COLUMNS)
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[fetchLabelUser]', error)
    throw error
  }
  return (data as LabelUser | null) ?? null
}

// ══════════════════════════════════════════════════════════════════
// 저장 · 삭제
// ══════════════════════════════════════════════════════════════════

/** 기본 템플릿 지정 시 같은 그룹(공용 또는 겹치는 사용자 · 같은 종류 · 겹치는 대상)의 기존 기본값 해제 */
async function clearDefault(
  userIds: string[] | null,
  labelType: LabelType,
  audiences: LabelAudience[],
  exceptId?: string
): Promise<void> {
  let q = supabase
    .from(TEMPLATE_TABLE)
    .update({ is_default: false })
    .eq('label_type', labelType)
    .eq('source', APP_LABEL_SOURCE)
    .eq('is_default', true)
    .overlaps('audiences', audiences)
  q = userIds && userIds.length > 0
    ? q.overlaps('user_ids', userIds)
    : q.or('user_ids.is.null,user_ids.eq.{}')
  if (exceptId) q = q.neq('id', exceptId)
  const { error } = await q
  if (error) {
    console.error('[clearDefault]', error)
    throw error
  }
}

/** 수정·삭제 전 권한 확인 — 공용이거나 내 것이 아니면 예외 */
async function assertEditable(id: string, myId: string): Promise<void> {
  const { data, error } = await supabase
    .from(TEMPLATE_TABLE)
    .select('user_ids, source')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[assertEditable]', error)
    throw error
  }
  if (!data) throw new Error('템플릿을 찾을 수 없습니다. 다른 곳에서 삭제됐을 수 있습니다.')
  if (data.source !== APP_LABEL_SOURCE || !isEditableBy(data.user_ids as string[] | null, myId)) {
    throw new Error('이 템플릿을 수정할 권한이 없습니다. (다른 계정 전용 템플릿)')
  }
}

/** 새로 만들거나(id 없음) 고친다 — 저장된 행을 돌려준다 */
export async function saveLabelTemplate(input: LabelTemplateInput, myId: string): Promise<LabelTemplate> {
  if (!myId) throw new Error('로그인 정보가 없습니다. 다시 로그인해주세요.')
  if (!input.name.trim()) throw new Error('템플릿 이름을 입력해주세요.')

  const { id, ...rest } = input
  const fields = {
    ...rest,
    source: APP_LABEL_SOURCE,
    user_ids: ownedUserIds(rest.user_ids, myId),
    audiences: normalizeAudiences(rest.audiences),
    description: normalizeDescription(rest.description),
    printer_lang: normalizePrinterLang(rest.printer_lang),
  }

  if (id) await assertEditable(id, myId)
  // 기본 템플릿이면 같은 그룹의 기존 기본값부터 해제 (해제 → 저장 순서, 원자적이지 않음)
  if (fields.is_default) await clearDefault(fields.user_ids, fields.label_type, fields.audiences, id)

  const query = id
    ? supabase
        .from(TEMPLATE_TABLE)
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
    : supabase.from(TEMPLATE_TABLE).insert(fields)
  const { data, error } = await query.select().single()
  if (error) {
    console.error('[saveLabelTemplate]', error)
    throw error
  }
  return data as LabelTemplate
}

export async function deleteLabelTemplate(id: string, myId: string): Promise<void> {
  if (!myId) throw new Error('로그인 정보가 없습니다. 다시 로그인해주세요.')
  await assertEditable(id, myId)
  const { error } = await supabase.from(TEMPLATE_TABLE).delete().eq('id', id)
  if (error) {
    console.error('[deleteLabelTemplate]', error)
    throw error
  }
}

// ══════════════════════════════════════════════════════════════════
// 인쇄 기록 — "무엇을 몇 장 뽑았나". 실패해도 인쇄 성공은 되돌리지 않는다 (호출 측이 무시)
// ══════════════════════════════════════════════════════════════════

export async function insertLabelPrintLogs(rows: LabelPrintLogInput[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from(LOG_TABLE)
    .insert(rows.map((r) => ({ ...r, source: APP_LABEL_SOURCE })))
  if (error) {
    console.error('[insertLabelPrintLogs]', error)
    throw error
  }
}

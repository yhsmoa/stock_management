import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// 사용자 타입 정의 - 새로운 테이블 스키마에 맞게 수정
export interface User {
  id?: string
  username: string
  index?: number
  password?: string
  seller_id: string
  name?: string
  phone_number?: string
  email_address?: string
  account_approval?: string
  created_at?: string
}

// 회원가입
export const registerUser = async (userData: {
  username: string
  password: string
  seller_id: string
  name: string
  phone_number: string
  email_address: string
}) => {
  // 현재 최대 index 값 조회
  const { data: maxIndexData } = await supabase
    .from('si_users')
    .select('index')
    .order('index', { ascending: false })
    .limit(1)

  const nextIndex = maxIndexData && maxIndexData[0] ? maxIndexData[0].index + 1 : 1

  const { data, error } = await supabase
    .from('si_users')
    .insert([
      {
        id: globalThis.crypto?.randomUUID?.()
          ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
              (+c ^ (globalThis.crypto?.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16)),
        username: userData.username,
        password: userData.password,
        seller_id: userData.seller_id,
        name: userData.name,
        phone_number: userData.phone_number,
        email_address: userData.email_address,
        index: nextIndex,
        account_approval: 'false', // 기본값: 승인 대기
      },
    ])
    .select()

  return { data, error }
}

// 로그인
export const loginUser = async (user_id: string, password: string) => {
  const { data, error } = await supabase
    .from('si_users')
    .select('*')
    .eq('username', user_id)
    .eq('password', password)
    .maybeSingle()

  return { data, error }
}

// 승인 여부 확인
export const checkApproval = async (user_id: string) => {
  const { data, error } = await supabase
    .from('si_users')
    .select('account_approval')
    .eq('username', user_id)
    .single()

  return { data, error }
}

// 쿠팡 아이템 인터페이스
export interface CoupangItem {
  barcode: string
  option_id: string
  item_name: string
  option_name: string
  season: string | null
  package_type: string | null
}

/**
 * si_coupang_returns 조회용 인터페이스
 * - Q바코드 스캔 시 메모리 lookup에 사용
 * - item_name / quality_grade / return_reason 은 테이블 직접 표시용
 */
export interface CoupangReturn {
  q_barcode: string
  option_id: string | null
  item_name: string | null
  quality_grade: string | null
  return_reason: string | null
}

/**
 * si_q_barcode 테이블 레코드 인터페이스
 * - 쿠팡 반품 XLSX 업로드 시 Q바코드 ↔ 옵션 매핑을 사용자별로 저장
 */
export interface QBarcodeRecord {
  barcode: string
  option_id: string
  user_id: string
}

// si_coupang_items 데이터 가져오기 (barcode가 존재하는 것만)
export const fetchCoupangItems = async (): Promise<CoupangItem[]> => {
  try {
    let allData: CoupangItem[] = []
    let from = 0
    const batchSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_coupang_items')
        .select('barcode, option_id, item_name, option_name, season, package_type')
        .not('barcode', 'is', null)
        .range(from, from + batchSize - 1)

      if (error) {
        console.error('Error fetching coupang items:', error)
        throw error
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data]
        from += batchSize

        if (data.length < batchSize) {
          hasMore = false
        }
      } else {
        hasMore = false
      }
    }

    console.log(`Fetched ${allData.length} coupang items`)
    return allData
  } catch (error) {
    console.error('Error in fetchCoupangItems:', error)
    return []
  }
}

// si_coupang_returns 데이터 가져오기 (최근 3개월)
export const fetchCoupangReturns = async (): Promise<CoupangReturn[]> => {
  try {
    // 오늘 기준 3개월 전 날짜 계산
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const threeMonthsAgoStr = threeMonthsAgo.toISOString()

    let allData: CoupangReturn[] = []
    let from = 0
    const batchSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_coupang_returns')
        .select('q_barcode, option_id, item_name, quality_grade, return_reason')
        .gte('apply_date', threeMonthsAgoStr)
        .range(from, from + batchSize - 1)

      if (error) {
        console.error('Error fetching coupang returns:', error)
        throw error
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data]
        from += batchSize

        if (data.length < batchSize) {
          hasMore = false
        }
      } else {
        hasMore = false
      }
    }

    console.log(`Fetched ${allData.length} coupang returns (last 3 months)`)
    return allData
  } catch (error) {
    console.error('Error in fetchCoupangReturns:', error)
    return []
  }
}

/**
 * si_q_barcode 테이블에서 사용자별 Q바코드-옵션 매핑 전체 조회
 * - 반출건관리 페이지 Q바코드 스캔 시 상품 식별용 lookup 데이터
 * @param userId - si_users.id (UUID)
 */
export const fetchQBarcodesByUser = async (userId: string): Promise<QBarcodeRecord[]> => {
  try {
    const allData: QBarcodeRecord[] = []
    const batchSize = 1000
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_q_barcode')
        .select('barcode, option_id')
        .eq('user_id', userId)
        .range(from, from + batchSize - 1)

      if (error) {
        console.error('Q바코드 조회 오류:', error)
        return allData
      }

      if (data && data.length > 0) {
        allData.push(...(data as QBarcodeRecord[]))
        from += batchSize
        if (data.length < batchSize) hasMore = false
      } else {
        hasMore = false
      }
    }

    console.log(`Fetched ${allData.length} Q barcodes for user ${userId}`)
    return allData
  } catch (error) {
    console.error('fetchQBarcodesByUser 오류:', error)
    return []
  }
}

/**
 * si_q_barcode 테이블에 Q바코드-옵션 매핑 일괄 저장 (upsert)
 * - 쿠팡 반품 XLSX 업로드 시 동기화
 * - q_barcode 단일키 기준으로 충돌 시 update
 * @param records - QBarcodeRecord 배열
 */
export const upsertQBarcodes = async (
  records: QBarcodeRecord[]
): Promise<{ success: boolean; error?: unknown }> => {
  if (!records.length) return { success: true }

  const { error } = await supabase
    .from('si_q_barcode')
    .upsert(records, { onConflict: 'barcode' })

  if (error) {
    console.error('Q바코드 저장 오류:', error)
    return { success: false, error }
  }

  console.log(`Upserted ${records.length} Q barcode records`)
  return { success: true }
}

/**
 * [정밀 Q 바코드 STEP 2]
 * si_coupang_items에서 option_id로 단건 조회
 * - user_id + barcode IS NOT NULL 필터로 최속 조회
 * - LIMIT 1: 첫 번째 매칭 상품만 반환
 * @param optionId - si_coupang_returns.option_id
 * @param userId   - si_users.id (UUID)
 */
export const fetchCoupangItemByOptionId = async (
  optionId: string,
  userId: string
): Promise<CoupangItem | null> => {
  const { data, error } = await supabase
    .from('si_coupang_items')
    .select('barcode, option_id, item_name, option_name, season, package_type')
    .eq('option_id', optionId)
    .eq('user_id', userId)
    .not('barcode', 'is', null)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('si_coupang_items option_id 조회 오류:', error)
    return null
  }
  return data ?? null
}

/**
 * [정밀 Q 바코드 STEP 3]
 * si_stocks에서 barcode + user_id로 location 조회
 * - location IS NOT NULL 필터로 null 위치 제외
 * - LIMIT 1: 첫 번째 재고 위치만 반환
 * @param barcode - si_coupang_items.barcode (STEP 2 결과)
 * @param userId  - si_users.id (UUID)
 */
export const fetchStockLocationByBarcode = async (
  barcode: string,
  userId: string
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('si_stocks')
    .select('location')
    .eq('barcode', barcode)
    .eq('user_id', userId)
    .not('location', 'is', null)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('si_stocks barcode 위치 조회 오류:', error)
    return null
  }
  return data?.location ?? null
}

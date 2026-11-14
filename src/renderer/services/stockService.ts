import { supabase } from './supabase'
import type { Stock, StockSearchFilters } from '../types/stock'
import {
  collectNewBarcodes,
  compareIdText,
  type CoupangStockName,
  type StockImportContext,
  type StockImportMode,
  type StockImportOps,
  type StockImportRow,
} from './stockImportService'

// ── 조회 · 일괄 작업 상수 (선택 삭제 · [엑셀 추가]) ─────────────────
const STOCK_PAGE_SIZE = 1000         // PostgREST 기본 반환 상한 — 조회 루프 단위
const IN_FILTER_CHUNK = 200          // .in() 한 번에 보낼 값 수 (1000건이면 URL 길이 초과로 요청이 멈춤)
const INSERT_BATCH_SIZE = 500        // 신규 삽입 배치
const UPDATE_BATCH_SIZE = 500        // 수량 갱신 병렬 배치

/** (로케이션 + 바코드) 재고 키 — 규칙은 stockImportService 한 곳 */
export { stockKeyOf } from './stockImportService'

/** [엑셀 추가] 실행 결과 — 배치마다 저장하므로 실패가 있어도 앞 배치는 이미 저장돼 있다 */
export interface StockImportApplyResult {
  created: number
  updated: number
  failedInserts: number
  failedUpdates: number
}

/**
 * 재고 관련 Supabase 서비스
 */
export class StockService {
  /**
   * 모든 재고 조회 (페이지네이션 루프 — 1000행 제한 해소)
   */
  static async getAllStocks(userId?: string): Promise<Stock[]> {
    try {
      let allData: Stock[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        // 정렬: 로케이션 → id. 로케이션만으로는 순서가 고정되지 않아 페이지 경계에서 행이 빠지거나 겹칠 수 있다
        let query = supabase
          .from('si_stocks')
          .select('*')
          .order('location', { ascending: true })
          .order('id', { ascending: true })
        if (userId) query = query.eq('user_id', userId)
        const { data, error } = await query.range(from, from + batchSize - 1)

        if (error) {
          console.error('재고 조회 오류:', error)
          throw error
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data]
          from += batchSize
          if (data.length < batchSize) hasMore = false
        } else {
          hasMore = false
        }
      }

      return allData
    } catch (error) {
      console.error('재고 조회 실패:', error)
      return []
    }
  }

  /**
   * 필터링된 재고 조회 (페이지네이션 루프 — 1000행 제한 해소)
   */
  static async getFilteredStocks(filters: Partial<StockSearchFilters>, userId?: string): Promise<Stock[]> {
    try {
      let allData: Stock[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        let query = supabase.from('si_stocks').select('*')

        // user_id 격리
        if (userId) query = query.eq('user_id', userId)

        // 키워드 검색 (바코드 또는 상품명)
        if (filters.searchKeyword) {
          if (filters.searchType === 'barcode') {
            query = query.ilike('barcode', `%${filters.searchKeyword}%`)
          } else {
            query = query.ilike('item_name', `%${filters.searchKeyword}%`)
          }
        }

        // 로케이션 필터
        if (filters.location) {
          query = query.ilike('location', `%${filters.location}%`)
        }

        // 시즌 필터
        if (filters.season) {
          query = query.ilike('season', `%${filters.season}%`)
        }

        // 비고 필터
        if (filters.note) {
          query = query.ilike('note', `%${filters.note}%`)
        }

        // 정렬: 로케이션 → id (페이지 경계에서 행이 빠지거나 겹치지 않도록 순서를 고정)
        query = query.order('location', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + batchSize - 1)

        const { data, error } = await query

        if (error) {
          console.error('필터링된 재고 조회 오류:', error)
          throw error
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data]
          from += batchSize
          if (data.length < batchSize) hasMore = false
        } else {
          hasMore = false
        }
      }

      return allData
    } catch (error) {
      console.error('필터링된 재고 조회 실패:', error)
      return []
    }
  }

  /**
   * 단일 재고 조회
   */
  static async getStock(id: string): Promise<Stock | null> {
    try {
      const { data, error } = await supabase
        .from('si_stocks')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('재고 조회 오류:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('재고 조회 실패:', error)
      return null
    }
  }

  /**
   * 재고 생성
   */
  static async createStock(stock: Omit<Stock, 'id'>): Promise<Stock | null> {
    try {
      const { data, error } = await supabase
        .from('si_stocks')
        .insert([stock])
        .select()
        .single()

      if (error) {
        console.error('재고 생성 오류:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('재고 생성 실패:', error)
      return null
    }
  }

  /**
   * 재고 upsert — 동일 (location + barcode + user_id) 존재 시 qty 합산, 없으면 신규 INSERT
   *
   * 흐름:
   *   STEP 1. getStockByLocationAndBarcode → 기존 행 조회
   *   STEP 2a. 기존 행 존재 → updateStockQty(id, additionalQty) 로 qty 누적
   *   STEP 2b. 기존 행 없음 → createStock(stock) 으로 신규 삽입
   *
   * @param stock  - 저장할 재고 데이터 (id 제외)
   * @param userId - 사용자 UUID (user_id 필터)
   * @returns 저장/업데이트된 Stock, 실패 시 null
   */
  static async upsertStock(
    stock: Omit<Stock, 'id'>,
    userId: string
  ): Promise<Stock | null> {
    try {
      // ── STEP 1: 동일 location + barcode 기존 행 조회 ─────────────
      const existing = await this.getStockByLocationAndBarcode(
        stock.location ?? null,
        stock.barcode,
        userId
      )

      if (existing) {
        // ── STEP 2a: 기존 행 존재 → qty 누적 합산 UPDATE ─────────────
        return await this.updateStockQty(existing.id, stock.qty ?? 0)
      } else {
        // ── STEP 2b: 기존 행 없음 → 신규 INSERT ──────────────────────
        return await this.createStock(stock)
      }
    } catch (error) {
      console.error('재고 upsert 실패:', error)
      return null
    }
  }

  /**
   * 재고 수정
   */
  static async updateStock(id: string, updates: Partial<Omit<Stock, 'id'>>): Promise<Stock | null> {
    try {
      const { data, error } = await supabase
        .from('si_stocks')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('재고 수정 오류:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('재고 수정 실패:', error)
      return null
    }
  }

  /**
   * 재고 삭제
   */
  static async deleteStock(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('si_stocks')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('재고 삭제 오류:', error)
        throw error
      }

      return true
    } catch (error) {
      console.error('재고 삭제 실패:', error)
      return false
    }
  }

  /**
   * 여러 재고 삭제
   */
  static async deleteMultipleStocks(ids: string[]): Promise<boolean> {
    try {
      // .in() 은 IN_FILTER_CHUNK 개씩 — UUID 수백 개를 한 URL 에 실으면 길이 초과로 요청이 멈춘다
      for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK) {
        const { error } = await supabase
          .from('si_stocks')
          .delete()
          .in('id', ids.slice(i, i + IN_FILTER_CHUNK))

        if (error) {
          console.error('재고 일괄 삭제 오류:', error)
          throw error
        }
      }

      return true
    } catch (error) {
      console.error('재고 일괄 삭제 실패:', error)
      return false
    }
  }

  /**
   * 사용자 재고 행 수 (검색 필터와 무관한 전체) — [전체 삭제] 확인 문구용
   */
  static async countStocksByUser(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('si_stocks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (error) throw error
    return count ?? 0
  }

  /**
   * 사용자 전체 재고 삭제 (user_id 격리)
   * - 필터(user_id)에 매칭되는 모든 행 삭제 (1000건 limit 무관)
   */
  static async deleteAllStocks(userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('si_stocks')
        .delete()
        .eq('user_id', userId)

      if (error) {
        console.error('재고 전체 삭제 오류:', error)
        throw error
      }
      return true
    } catch (error) {
      console.error('재고 전체 삭제 실패:', error)
      return false
    }
  }

  /**
   * location과 barcode로 기존 재고 조회
   */
  static async getStockByLocationAndBarcode(
    location: string | null,
    barcode: string,
    userId: string
  ): Promise<Stock | null> {
    try {
      let query = supabase
        .from('si_stocks')
        .select('*')
        .eq('barcode', barcode)
        .eq('user_id', userId)

      // location이 null인 경우와 값이 있는 경우를 구분
      if (location === null || location === '') {
        query = query.is('location', null)
      } else {
        query = query.eq('location', location)
      }

      const { data, error } = await query.single()

      if (error) {
        // 데이터가 없는 경우 null 반환
        if (error.code === 'PGRST116') {
          return null
        }
        console.error('재고 조회 오류:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('재고 조회 실패:', error)
      return null
    }
  }

  /**
   * 재고 수량 업데이트 (기존 수량에 추가)
   */
  static async updateStockQty(id: string, additionalQty: number): Promise<Stock | null> {
    try {
      // 먼저 현재 재고 조회
      const currentStock = await this.getStock(id)
      if (!currentStock) {
        return null
      }

      const newQty = (currentStock.qty || 0) + additionalQty

      const { data, error } = await supabase
        .from('si_stocks')
        .update({ qty: newQty })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('재고 수량 업데이트 오류:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('재고 수량 업데이트 실패:', error)
      return null
    }
  }

  /**
   * 바코드 기준 총재고 Map 조회 (barcode → 모든 로케이션 qty 합산)
   * - 같은 barcode 가 (location + barcode) 단위로 여러 행에 흩어져 있으므로 합산 필요
   * - barcode, qty 만 select 하고 1000행 배치 페이지네이션으로 전체 처리
   */
  static async getStockQtyByBarcode(userId: string): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (!userId) return map

    try {
      let from = 0
      const batchSize = 1000

      while (true) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('barcode, qty')
          .eq('user_id', userId)
          .range(from, from + batchSize - 1)

        if (error) {
          console.error('바코드별 재고 조회 오류:', error)
          break
        }
        if (!data || data.length === 0) break

        for (const s of data as { barcode: string | null; qty: number | null }[]) {
          const bc = (s.barcode ?? '').trim()
          if (!bc) continue
          map.set(bc, (map.get(bc) ?? 0) + (s.qty ?? 0))
        }

        if (data.length < batchSize) break
        from += batchSize
      }

      return map
    } catch (error) {
      console.error('바코드별 재고 조회 실패:', error)
      return map
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 엑셀 추가 (재고관리 [엑셀 추가] — 추가 · 차감)
  //   - 검사·계획은 services/stockImportService.ts (순수 로직), 여기는 DB 조회·쓰기만
  //   - 기존 재고 조회가 실패하면 반드시 throw — 빈 목록으로 진행하면
  //     추가가 기존 행을 모두 '신규'로 보고 중복 삽입한다
  // ═══════════════════════════════════════════════════════════════

  // ── 사용자 재고 전체 (실패 시 throw) ──────────────────────────────
  private static async fetchUserStocksStrict(userId: string): Promise<Stock[]> {
    const all: Stock[] = []
    for (let from = 0; ; from += STOCK_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('si_stocks')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, from + STOCK_PAGE_SIZE - 1)
      if (error) throw error
      const rows = (data ?? []) as Stock[]
      all.push(...rows)
      if (rows.length < STOCK_PAGE_SIZE) break
    }
    return all
  }

  // ── 바코드 → 쿠팡 상품명·옵션명 (이 계정 것만 · 실패 시 throw) ──────
  //    같은 바코드가 여러 옵션에 있으면 option_id 가 가장 작은 행 (늘 같은 결과)
  private static async fetchCoupangNamesByBarcode(
    userId: string,
    barcodes: string[],
  ): Promise<Map<string, CoupangStockName>> {
    const best = new Map<string, CoupangStockName & { option_id: string }>()
    for (let i = 0; i < barcodes.length; i += IN_FILTER_CHUNK) {
      const chunk = barcodes.slice(i, i + IN_FILTER_CHUNK)
      // 바코드 200개라도 한 바코드에 여러 행이 있을 수 있어 1000행 루프로 받는다
      for (let from = 0; ; from += STOCK_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('si_coupang_items')
          .select('barcode, item_name, option_name, option_id')
          .eq('user_id', userId)
          .in('barcode', chunk)
          .order('option_id', { ascending: true })
          .range(from, from + STOCK_PAGE_SIZE - 1)
        if (error) throw error
        const rows = (data ?? []) as { barcode: string | null; item_name: string | null; option_name: string | null; option_id: string | number }[]
        for (const item of rows) {
          const barcode = (item.barcode ?? '').trim()
          if (!barcode || !(item.item_name ?? '').trim()) continue
          const optionId = String(item.option_id)
          const prev = best.get(barcode)
          if (prev && compareIdText(prev.option_id, optionId) <= 0) continue
          best.set(barcode, { item_name: item.item_name as string, option_name: item.option_name ?? null, option_id: optionId })
        }
        if (rows.length < STOCK_PAGE_SIZE) break
      }
    }
    const map = new Map<string, CoupangStockName>()
    for (const [barcode, { item_name, option_name }] of best) map.set(barcode, { item_name, option_name })
    return map
  }

  /**
   * [엑셀 추가] 계획에 필요한 DB 값 — 재고 전체 + (추가 모드) 신규 행 바코드의 쿠팡 이름
   *   - nameCache: 같은 창에서 검사를 다시 돌릴 때 이미 물어본 바코드를 다시 묻지 않도록
   *     (찾지 못한 바코드는 null 로 기억). 재고는 매번 새로 읽는다.
   */
  static async loadStockImportContext(
    userId: string,
    rows: readonly StockImportRow[],
    mode: StockImportMode,
    nameCache?: Map<string, CoupangStockName | null>,
  ): Promise<StockImportContext> {
    const stocks = await this.fetchUserStocksStrict(userId)
    const coupangNames = new Map<string, CoupangStockName>()
    if (mode !== 'add') return { stocks, coupangNames }

    const barcodes = collectNewBarcodes(rows, stocks)
    const missing = nameCache ? barcodes.filter(b => !nameCache.has(b)) : barcodes
    const fetched = await this.fetchCoupangNamesByBarcode(userId, missing)
    for (const barcode of missing) nameCache?.set(barcode, fetched.get(barcode) ?? null)
    for (const barcode of barcodes) {
      const name = fetched.get(barcode) ?? nameCache?.get(barcode)
      if (name) coupangNames.set(barcode, name)
    }
    return { stocks, coupangNames }
  }

  /**
   * [엑셀 추가] 계획 실행 — 신규 INSERT_BATCH_SIZE 개씩, 수량 수정 UPDATE_BATCH_SIZE 개씩 병렬
   *   - 원자적이지 않다: 배치가 실패해도 앞 배치는 이미 저장돼 있다 (결과에 실패 건수)
   *   - 수정은 user_id 로 한 번 더 거르고, 0행이 바뀌면(그사이 삭제) 실패로 센다
   *   - onProgress(처리한 작업 수, 전체 작업 수)
   */
  static async applyStockImport(
    userId: string,
    ops: StockImportOps,
    onProgress?: (done: number, total: number) => void,
  ): Promise<StockImportApplyResult> {
    const result: StockImportApplyResult = { created: 0, updated: 0, failedInserts: 0, failedUpdates: 0 }
    const total = ops.inserts.length + ops.updates.length
    let done = 0
    onProgress?.(done, total)

    // ── 신규 ──
    const newRows: Omit<Stock, 'id'>[] = ops.inserts.map(op => ({
      location: op.location,
      barcode: op.barcode,
      item_name: op.item_name,
      option_name: op.option_name,
      qty: op.qty,
      season: null,
      note: null,
      user_id: userId,
    }))
    for (let i = 0; i < newRows.length; i += INSERT_BATCH_SIZE) {
      const batch = newRows.slice(i, i + INSERT_BATCH_SIZE)
      const { error } = await supabase.from('si_stocks').insert(batch)
      if (error) {
        console.error('재고 일괄 삽입 오류:', error)
        result.failedInserts += batch.length
      } else {
        result.created += batch.length
      }
      done += batch.length
      onProgress?.(done, total)
    }

    // ── 수량 수정 ──
    for (let i = 0; i < ops.updates.length; i += UPDATE_BATCH_SIZE) {
      const batch = ops.updates.slice(i, i + UPDATE_BATCH_SIZE)
      const responses = await Promise.all(
        batch.map(op =>
          supabase.from('si_stocks').update({ qty: op.nextQty }).eq('id', op.id).eq('user_id', userId).select('id'),
        ),
      )
      for (const { data, error } of responses) {
        if (error || !data || data.length === 0) {
          if (error) console.error('재고 수량 업데이트 오류:', error)
          result.failedUpdates++
        } else {
          result.updated++
        }
      }
      done += batch.length
      onProgress?.(done, total)
    }

    return result
  }
}

import { supabase } from './supabase'
import type { Stock, StockSearchFilters } from '../types/stock'

/**
 * 재고 관련 Supabase 서비스
 */
export class StockService {
  /**
   * 모든 재고 조회 (페이지네이션 루프 — 1000행 제한 해소)
   */
  static async getAllStocks(): Promise<Stock[]> {
    try {
      let allData: Stock[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('*')
          .order('location', { ascending: true })
          .range(from, from + batchSize - 1)

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
  static async getFilteredStocks(filters: Partial<StockSearchFilters>): Promise<Stock[]> {
    try {
      let allData: Stock[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        let query = supabase.from('si_stocks').select('*')

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

        query = query.order('location', { ascending: true })
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
      const { error } = await supabase
        .from('si_stocks')
        .delete()
        .in('id', ids)

      if (error) {
        console.error('재고 일괄 삭제 오류:', error)
        throw error
      }

      return true
    } catch (error) {
      console.error('재고 일괄 삭제 실패:', error)
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
   * 바코드 배열로 si_coupang_items에서 상품 정보 조회
   */
  static async getCoupangItemsByBarcodes(barcodes: string[]): Promise<Map<string, {
    item_name: string
    option_name: string
  }>> {
    try {
      const barcodeMap = new Map<string, { item_name: string; option_name: string }>()

      // 바코드가 없으면 빈 Map 반환
      if (!barcodes || barcodes.length === 0) {
        return barcodeMap
      }

      // 중복 제거
      const uniqueBarcodes = Array.from(new Set(barcodes))

      // .in() 배치는 200건씩 — 1000건 이상이면 URL 길이 초과로 요청이 멈춤
      const batchSize = 200

      for (let i = 0; i < uniqueBarcodes.length; i += batchSize) {
        const batch = uniqueBarcodes.slice(i, i + batchSize)

        const { data, error } = await supabase
          .from('si_coupang_items')
          .select('barcode, item_name, option_name')
          .in('barcode', batch)
          .not('barcode', 'is', null)

        if (error) {
          console.error('쿠팡 아이템 조회 오류:', error)
          continue
        }

        // Map에 저장
        if (data) {
          data.forEach(item => {
            if (item.barcode && item.item_name && item.option_name) {
              barcodeMap.set(item.barcode, {
                item_name: item.item_name,
                option_name: item.option_name
              })
            }
          })
        }
      }

      console.log(`바코드 매칭: ${barcodeMap.size}/${uniqueBarcodes.length}개 매칭됨`)
      return barcodeMap
    } catch (error) {
      console.error('쿠팡 아이템 조회 실패:', error)
      return new Map()
    }
  }

  /**
   * 사용자별 전체 재고 조회 (페이지네이션 루프)
   */
  static async getAllStocksByUser(userId: string): Promise<Stock[]> {
    try {
      let allData: Stock[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('*')
          .eq('user_id', userId)
          .range(from, from + batchSize - 1)

        if (error) {
          console.error('사용자별 재고 조회 오류:', error)
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
      console.error('사용자별 재고 조회 실패:', error)
      return []
    }
  }

  /**
   * 재고 일괄 삽입 (500건씩 배치)
   */
  static async batchCreateStocks(stocks: Omit<Stock, 'id'>[]): Promise<{ created: number; errors: number }> {
    let created = 0
    let errors = 0
    const batchSize = 500

    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize)
      const { error } = await supabase
        .from('si_stocks')
        .insert(batch)

      if (error) {
        console.error(`재고 일괄 삽입 오류 (batch ${i / batchSize + 1}):`, error)
        errors += batch.length
      } else {
        created += batch.length
      }
    }

    return { created, errors }
  }

  /**
   * 재고 수량 일괄 업데이트 (개별 update를 500건 단위로 병렬 처리)
   */
  static async batchUpdateStockQtys(
    updates: { id: string; qty: number }[]
  ): Promise<{ updated: number; errors: number }> {
    let updated = 0
    let errors = 0
    const batchSize = 500

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(({ id, qty }) =>
          supabase.from('si_stocks').update({ qty }).eq('id', id)
        )
      )

      for (const { error } of results) {
        if (error) {
          console.error('재고 수량 업데이트 오류:', error)
          errors++
        } else {
          updated++
        }
      }
    }

    return { updated, errors }
  }
}
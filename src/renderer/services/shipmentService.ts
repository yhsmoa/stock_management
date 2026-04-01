import { supabase } from './supabase'
import type { Stock } from '../types/stock'
import type { Shipment, ShipmentScan, ShipmentRow, StockLocationInfo } from '../types/shipment'

export class ShipmentService {
  // ═══════════════════════════════════════════════════════════════════
  // ── 출고 리스트 로드 (3-query 조합) ────────────────────────────────
  // 1. si_shipment_list → 바코드별 요청개수
  // 2. si_stocks → 위치별 재고수량 (실시간)
  // 3. si_shipment_scan → 위치별 스캔수량
  // ═══════════════════════════════════════════════════════════════════
  static async fetchShipmentList(userId: string): Promise<ShipmentRow[]> {
    // ── 1단계: si_shipment_list 조회 (요청개수) ─────────────────────
    const listRecords: Shipment[] = []
    let from = 0
    let hasMore = true
    const batchSize = 1000

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_shipment_list')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .range(from, from + batchSize - 1)

      if (error) { console.error('출고 리스트 조회 오류:', error); break }
      if (data && data.length > 0) listRecords.push(...data)
      hasMore = (data?.length ?? 0) === batchSize
      from += batchSize
    }

    if (listRecords.length === 0) return []

    // 바코드 목록 추출
    const barcodes = [...new Set(
      listRecords.map(r => r.barcode).filter((b): b is string => !!b)
    )]

    // ── 2단계: si_stocks 일괄 조회 (재고 위치) ──────────────────────
    const allStocks: Stock[] = []
    // Supabase .in() 은 한번에 최대 수백개 처리 가능, 100개씩 분할
    const CHUNK_SIZE = 100
    for (let i = 0; i < barcodes.length; i += CHUNK_SIZE) {
      const chunk = barcodes.slice(i, i + CHUNK_SIZE)
      let sfrom = 0
      let sHasMore = true

      while (sHasMore) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('*')
          .in('barcode', chunk)
          .eq('user_id', userId)
          .range(sfrom, sfrom + batchSize - 1)

        if (error) { console.error('재고 일괄 조회 오류:', error); break }
        if (data && data.length > 0) allStocks.push(...data)
        sHasMore = (data?.length ?? 0) === batchSize
        sfrom += batchSize
      }
    }

    // ── 3단계: si_shipment_scan 조회 (스캔 수량) ────────────────────
    const scanRecords: ShipmentScan[] = []
    from = 0
    hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_shipment_scan')
        .select('*')
        .eq('user_id', userId)
        .range(from, from + batchSize - 1)

      if (error) { console.error('스캔 데이터 조회 오류:', error); break }
      if (data && data.length > 0) scanRecords.push(...data)
      hasMore = (data?.length ?? 0) === batchSize
      from += batchSize
    }

    // ── 4단계: 3개 데이터 조합 → ShipmentRow[] ─────────────────────

    // 재고 위치 그룹핑: barcode → StockLocationInfo[]
    const stockMap = new Map<string, StockLocationInfo[]>()
    for (const stock of allStocks) {
      const bc = stock.barcode
      if (!bc) continue
      const list = stockMap.get(bc) || []
      list.push({
        location: stock.location ?? '',
        qty: stock.qty ?? 0,
        scannedQty: 0,
        shipmentBox: null,
      })
      stockMap.set(bc, list)
    }

    // 스캔 수량 그룹핑: "barcode|location" → { scannedQty, shipmentBox }
    const scanMap = new Map<string, { scannedQty: number; shipmentBox: string | null }>()
    for (const scan of scanRecords) {
      const key = `${scan.barcode}|${scan.location}`
      const existing = scanMap.get(key)
      if (existing) {
        existing.scannedQty += scan.qty ?? 0
      } else {
        scanMap.set(key, {
          scannedQty: scan.qty ?? 0,
          shipmentBox: scan.shipment_box,
        })
      }
    }

    // ShipmentRow[] 생성
    return listRecords
      .filter(r => r.barcode)
      .map(record => {
        const barcode = record.barcode!
        const locations = (stockMap.get(barcode) || []).map(loc => {
          const scanKey = `${barcode}|${loc.location}`
          const scanInfo = scanMap.get(scanKey)
          return {
            ...loc,
            scannedQty: scanInfo?.scannedQty ?? 0,
            shipmentBox: scanInfo?.shipmentBox ?? null,
          }
        })

        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          barcode,
          item_name: record.item_name ?? '',
          option_name: record.option_name ?? '',
          shipmentQty: record.qty ?? 0,          // 요청개수 그대로
          coupangShipmentSize: record.coupang_shipment_size ?? '',
          stockLocations: locations,
        }
      })
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 바코드로 사용자 재고 조회 (단건, ShipmentAddPanel 전용) ────────
  // ═══════════════════════════════════════════════════════════════════
  static async getStocksByBarcode(barcode: string, userId: string): Promise<Stock[]> {
    const allStocks: Stock[] = []
    const batchSize = 1000
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_stocks')
        .select('*')
        .eq('barcode', barcode)
        .eq('user_id', userId)
        .range(from, from + batchSize - 1)

      if (error) { console.error('재고 바코드 조회 오류:', error); break }
      if (data && data.length > 0) allStocks.push(...data)
      hasMore = (data?.length ?? 0) === batchSize
      from += batchSize
    }

    return allStocks
  }

  // ── 쿠팡 사이즈(package_type) 조회 ───────────────────────────────
  static async getCoupangShipmentSize(barcode: string): Promise<string> {
    const { data, error } = await supabase
      .from('si_coupang_items')
      .select('package_type')
      .eq('barcode', barcode)
      .limit(1)
      .single()

    if (error || !data) return ''
    return data.package_type ?? ''
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 리스트 저장 (si_shipment_list) ─────────────────────────────────
  // Replace 전략: 기존 데이터 DELETE → 새 데이터 INSERT
  // qty = 요청개수 (shipmentQty), 바코드별 1건
  // ═══════════════════════════════════════════════════════════════════
  static async saveShipmentList(
    items: Omit<Shipment, 'id' | 'created_at'>[],
    userId: string
  ): Promise<{ created: number; errors: number }> {
    // 1. 기존 데이터 삭제
    const { error: deleteError } = await supabase
      .from('si_shipment_list')
      .delete()
      .eq('user_id', userId)

    if (deleteError) {
      console.error('리스트 삭제 오류:', deleteError)
      return { created: 0, errors: items.length }
    }

    // 2. 새 데이터 배치 INSERT
    let created = 0
    let errors = 0
    const batchSize = 500

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const { error } = await supabase
        .from('si_shipment_list')
        .insert(batch)

      if (error) {
        console.error('리스트 저장 오류:', error)
        errors += batch.length
      } else {
        created += batch.length
      }
    }

    return { created, errors }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 저장 (si_shipment_scan) ──────────────────────────────────
  // Replace 전략: 기존 데이터 DELETE → 새 데이터 INSERT (중복 방지)
  // ═══════════════════════════════════════════════════════════════════
  static async saveShipmentScan(
    items: Omit<ShipmentScan, 'id' | 'created_at'>[],
    userId: string
  ): Promise<{ created: number; errors: number }> {
    // 1. 기존 스캔 데이터 삭제
    const { error: deleteError } = await supabase
      .from('si_shipment_scan')
      .delete()
      .eq('user_id', userId)

    if (deleteError) {
      console.error('스캔 데이터 삭제 오류:', deleteError)
      return { created: 0, errors: items.length }
    }

    // 2. 새 데이터 배치 INSERT
    let created = 0
    let errors = 0
    const batchSize = 500

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const { error } = await supabase
        .from('si_shipment_scan')
        .insert(batch)

      if (error) {
        console.error('스캔 저장 오류:', error)
        errors += batch.length
      } else {
        created += batch.length
      }
    }

    return { created, errors }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 기록 조회 (si_shipment_scan 원본 데이터) ──────────────────
  // 스캔기록 테이블 뷰에서 사용
  // ═══════════════════════════════════════════════════════════════════
  static async fetchShipmentScanRecords(userId: string): Promise<ShipmentScan[]> {
    const allRecords: ShipmentScan[] = []
    const batchSize = 1000
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('si_shipment_scan')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, from + batchSize - 1)

      if (error) { console.error('스캔 기록 조회 오류:', error); break }
      if (data && data.length > 0) allRecords.push(...data)
      hasMore = (data?.length ?? 0) === batchSize
      from += batchSize
    }

    return allRecords
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 레코드 단건 삭제 (si_shipment_scan) ─────────────────────
  // ═══════════════════════════════════════════════════════════════════
  static async deleteScanRecord(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('si_shipment_scan')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('스캔 레코드 삭제 오류:', error)
      return false
    }
    return true
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 레코드 수량 수정 (si_shipment_scan) ─────────────────────
  // qty = 0이면 삭제, 그 외 UPDATE
  // ═══════════════════════════════════════════════════════════════════
  static async updateScanRecordQty(id: string, qty: number): Promise<boolean> {
    if (qty <= 0) return this.deleteScanRecord(id)

    const { error } = await supabase
      .from('si_shipment_scan')
      .update({ qty })
      .eq('id', id)

    if (error) {
      console.error('스캔 수량 수정 오류:', error)
      return false
    }
    return true
  }

  // ═══════════════════════════════════════════════════════════════════
  // ── 리스트 초기화 (si_shipment_list + si_shipment_scan 전체 삭제) ─
  // 해당 사용자의 출고 리스트와 스캔 데이터를 모두 삭제
  // ═══════════════════════════════════════════════════════════════════
  static async resetShipmentData(userId: string): Promise<{ success: boolean }> {
    const { error: listError } = await supabase
      .from('si_shipment_list')
      .delete()
      .eq('user_id', userId)

    if (listError) {
      console.error('리스트 초기화 오류:', listError)
      return { success: false }
    }

    const { error: scanError } = await supabase
      .from('si_shipment_scan')
      .delete()
      .eq('user_id', userId)

    if (scanError) {
      console.error('스캔 초기화 오류:', scanError)
      return { success: false }
    }

    return { success: true }
  }
}

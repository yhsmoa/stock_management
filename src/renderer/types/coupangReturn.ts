// si_coupang_returns 테이블 타입 정의 (새로운 구조)
export interface CoupangReturn {
  type: string
  return_id: string | null
  order_id: string // primary key, not null
  option_id: string | null
  item_name: string | null
  return_reason: string | null
  q_barcode: string | null
  quality_grade: string | null
  status: string | null
  apply_date: string | null
  user_id?: string | null
}

// 엑셀 파일에서 읽어온 원시 데이터 타입
export interface CoupangReturnExcelRow {
  [key: string]: any
  // B열: apply_date
  // C열: type
  // D열: return_id
  // E열: order_id
  // F열: option_id
  // G열: item_name
  // H열: return_reason
  // I열: q_barcode
  // J열: quality_grade
  // K열: status
}
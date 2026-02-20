// 반출건관리 테이블 행 타입
export interface Export {
  id: string
  packageType: string | null   // si_coupang_items.package_type → '분류' 열 (정밀 Q바코드 전용)
  location: string | null
  barcode: string | null       // Q바코드 값 (스캔한 Q바코드 그대로 저장)
  itemName: string | null      // si_coupang_returns.item_name
  qty: number
  qualityGrade: string | null  // si_coupang_returns.quality_grade → '상태' 열
  returnReason: string | null  // si_coupang_returns.return_reason → '사유' 열
}

// 테이블 헤더 정의
export const EXPORT_TABLE_HEADERS = [
  { key: 'checkbox',     label: '',      width: '3%'  },
  { key: 'packageType',  label: '분류',   width: '10%' },
  { key: 'location',     label: '로케이션', width: '10%' },
  { key: 'barcode',      label: '바코드',  width: '13%' },
  { key: 'itemName',     label: '상품명',  width: '30%' },
  { key: 'qty',          label: '개수',   width: '6%'  },
  { key: 'qualityGrade', label: '상태',   width: '11%' },
  { key: 'returnReason', label: '사유',   width: '17%' },
] as const

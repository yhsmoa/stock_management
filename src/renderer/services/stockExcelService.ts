import ExcelJS from 'exceljs'
import type { Stock } from '../types/stock'

// ── 재고관리 [엑셀 다운] — 올리기([엑셀 추가])는 services/stockImportService.ts ──

/**
 * 재고 데이터를 엑셀 파일로 다운로드
 * 헤더: 로케이션, 바코드, 상품명, 옵션명, 개수
 */
export const exportStocksToExcel = async (stocks: Stock[], filename: string = '재고목록.xlsx') => {
  try {
    // ExcelJS 워크북 생성
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('재고목록')

    // 헤더 설정
    worksheet.columns = [
      { header: '로케이션', key: 'location', width: 15 },
      { header: '바코드', key: 'barcode', width: 15 },
      { header: '상품명', key: 'item_name', width: 45 },
      { header: '옵션명', key: 'option_name', width: 30 },
      { header: '개수', key: 'qty', width: 10 },
    ]

    // 헤더 행 스타일 설정 (회색 배경)
    worksheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // 회색 배경
      }
      cell.font = {
        bold: true
      }
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }
    })

    // 데이터 추가
    stocks.forEach(stock => {
      worksheet.addRow({
        location: stock.location || '',
        barcode: stock.barcode || '',
        item_name: stock.item_name || '',
        option_name: stock.option_name || '',
        qty: stock.qty || 0,
      })
    })

    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)

    return true
  } catch (error) {
    console.error('Error exporting to Excel:', error)
    return false
  }
}

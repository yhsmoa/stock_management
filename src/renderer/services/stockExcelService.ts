import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import type { Stock } from '../types/stock'

/**
 * 엑셀에서 읽은 재고 데이터 인터페이스
 */
export interface ExcelStockRow {
  location: string | null
  barcode: string
  item_name: string | null
  option_name: string | null
  qty: number | null
}

/**
 * 엑셀 파일을 읽고 재고 데이터로 파싱
 * 1행: header (스킵)
 * 2행부터: 데이터
 * A열: location, B열: barcode, C열: item_name, D열: option_name, E열: qty
 */
export const parseStockExcelFile = async (file: File): Promise<ExcelStockRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })

        // 첫 번째 시트 가져오기
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]

        // 데이터를 JSON으로 변환 (header: 1 옵션으로 배열 형태로 가져옴)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: null,
          raw: false,
        }) as any[][]

        // 2행부터 데이터 시작 (인덱스는 1, 0은 헤더)
        const dataRows = jsonData.slice(1)

        // ExcelStockRow 형식으로 변환
        const stockRows: ExcelStockRow[] = dataRows
          .filter(row => row && row.length > 0 && row[1]) // B열(barcode)이 있는 행만 필터링
          .map(row => ({
            location: row[0] || null, // A열
            barcode: String(row[1] || '').trim(), // B열
            item_name: row[2] || null, // C열
            option_name: row[3] || null, // D열
            qty: row[4] ? parseInt(String(row[4]), 10) : null, // E열
          }))
          .filter(row => row.barcode) // barcode가 빈 문자열이 아닌 것만

        resolve(stockRows)
      } catch (error) {
        console.error('Error parsing Excel file:', error)
        reject(error)
      }
    }

    reader.onerror = (error) => {
      reject(error)
    }

    reader.readAsBinaryString(file)
  })
}

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

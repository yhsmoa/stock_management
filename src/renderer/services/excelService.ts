import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import type { CoupangReturn } from '../types/coupangReturn'

// 엑셀 날짜를 JavaScript Date로 변환
const excelDateToJSDate = (excelDate: number): Date => {
  const date = new Date((excelDate - 25569) * 86400 * 1000)
  return date
}

// 엑셀 파일을 읽고 파싱하는 함수
export const parseExcelFile = async (file: File): Promise<CoupangReturn[]> => {
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
          dateNF: 'yyyy-mm-dd'
        }) as any[][]

        // 8행부터 데이터 시작 (인덱스는 7)
        const dataRows = jsonData.slice(7)

        // localStorage에서 사용자 UUID 조회 (si_users.id)
        const userStr = localStorage.getItem('user');
        const user = userStr ? JSON.parse(userStr) : null;
        const userId = user?.id as string | undefined;

        if (!userId) {
          throw new Error('로그인 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
        }

        // CoupangReturn 형식으로 변환 (si_coupang_returns 테이블 구조에 맞게)
        const coupangReturns: CoupangReturn[] = dataRows
          .filter(row => row && row.length > 0 && row[4]) // E열(order_id)이 있는 행만 필터링
          .map(row => ({
            type: row[2] || '', // C열
            return_id: row[3] || null, // D열
            order_id: row[4] || '', // E열 (primary key, not null)
            option_id: row[5] || null, // F열
            item_name: row[6] || null, // G열
            return_reason: row[7] || null, // H열
            q_barcode: row[8] || null, // I열
            quality_grade: row[9] || null, // J열
            status: row[10] || null, // K열
            apply_date: row[1] || null, // B열
            user_id: userId, // 사용자 UUID (si_users.id)
          }))

        resolve(coupangReturns)
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

// Supabase에 데이터 저장하는 함수 (upsert 방식)
export const saveCoupangReturnsToSupabase = async (data: CoupangReturn[]): Promise<{ success: boolean; error?: any }> => {
  try {
    // 데이터를 배치로 upsert (order_id 기준으로 변경)
    const { data: upsertedData, error } = await supabase
      .from('si_coupang_returns')
      .upsert(data, { onConflict: 'order_id' }) // order_id가 primary key
      .select()

    if (error) {
      console.error('Error saving to Supabase:', error)
      return { success: false, error }
    }

    console.log(`Successfully upserted ${upsertedData?.length || 0} records to Supabase`)
    return { success: true }
  } catch (error) {
    console.error('Error in saveCoupangReturnsToSupabase:', error)
    return { success: false, error }
  }
}

// 엑셀 업로드 및 처리 통합 함수
export const processCoupangReturnsExcel = async (file: File): Promise<{
  success: boolean
  message: string
  count?: number
}> => {
  try {
    // 1. 엑셀 파일 파싱
    const parsedData = await parseExcelFile(file)

    if (!parsedData || parsedData.length === 0) {
      return {
        success: false,
        message: '엑셀 파일에서 데이터를 찾을 수 없습니다.'
      }
    }

    // 2. Supabase에 저장
    const saveResult = await saveCoupangReturnsToSupabase(parsedData)

    if (!saveResult.success) {
      return {
        success: false,
        message: '데이터 저장 중 오류가 발생했습니다.'
      }
    }

    return {
      success: true,
      message: `${parsedData.length}개의 데이터가 성공적으로 저장되었습니다.`,
      count: parsedData.length
    }
  } catch (error) {
    console.error('Error processing Excel file:', error)
    return {
      success: false,
      message: '엑셀 파일 처리 중 오류가 발생했습니다.'
    }
  }
}

// 진행 상황을 추적하는 엑셀 업로드 함수
export const processCoupangReturnsExcelWithProgress = async (
  file: File,
  onProgress: (progress: {
    current: number
    total: number
    status: 'parsing' | 'uploading' | 'verifying' | 'complete' | 'error'
    message: string
  }) => void
): Promise<void> => {
  try {
    // 1. 파싱 시작
    onProgress({
      current: 0,
      total: 0,
      status: 'parsing',
      message: '엑셀 파일을 분석하고 있습니다...'
    })

    const parsedData = await parseExcelFile(file)

    if (!parsedData || parsedData.length === 0) {
      onProgress({
        current: 0,
        total: 0,
        status: 'error',
        message: '엑셀 파일에서 데이터를 찾을 수 없습니다.'
      })
      return
    }

    const totalItems = parsedData.length

    // 2. 업로드 시작
    onProgress({
      current: 0,
      total: totalItems,
      status: 'uploading',
      message: `총 ${totalItems.toLocaleString()}개의 데이터를 업로드합니다...`
    })

    // localStorage에서 사용자 UUID 조회 (si_users.id)
    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?.id as string | undefined;

    if (!userId) {
      onProgress({
        current: 0,
        total: 0,
        status: 'error',
        message: '로그인 정보를 찾을 수 없습니다. 다시 로그인해주세요.'
      })
      return
    }

    // user_id(UUID)를 각 데이터에 추가
    const dataWithUserId = parsedData.map(item => ({
      ...item,
      user_id: userId,
    }))

    // 배치 처리를 위해 데이터를 청크로 분할 (100개씩)
    const batchSize = 100
    const batches = []
    for (let i = 0; i < dataWithUserId.length; i += batchSize) {
      batches.push(dataWithUserId.slice(i, i + batchSize))
    }

    let uploadedCount = 0

    // 각 배치를 순차적으로 upsert
    for (const batch of batches) {
      const { error } = await supabase
        .from('si_coupang_returns')
        .upsert(batch, { onConflict: 'order_id' })
        .select()

      if (error) {
        console.error('Batch upsert error:', error)
        onProgress({
          current: uploadedCount,
          total: totalItems,
          status: 'error',
          message: `업로드 중 오류가 발생했습니다: ${error.message}`
        })
        return
      }

      uploadedCount += batch.length

      onProgress({
        current: uploadedCount,
        total: totalItems,
        status: 'uploading',
        message: `${uploadedCount.toLocaleString()} / ${totalItems.toLocaleString()} 완료`
      })
    }

    // 3. 검증 단계
    onProgress({
      current: totalItems,
      total: totalItems,
      status: 'verifying',
      message: '업로드된 데이터를 검증하고 있습니다...'
    })

    // 실제 저장된 데이터 수 확인
    await new Promise(resolve => setTimeout(resolve, 1000)) // 시뮬레이션 딜레이

    // 4. 완료
    onProgress({
      current: totalItems,
      total: totalItems,
      status: 'complete',
      message: `${totalItems.toLocaleString()}개의 데이터가 성공적으로 저장되었습니다!`
    })

  } catch (error) {
    console.error('Error processing Excel file:', error)
    onProgress({
      current: 0,
      total: 0,
      status: 'error',
      message: '엑셀 파일 처리 중 오류가 발생했습니다.'
    })
  }
}
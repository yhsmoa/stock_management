import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabase';
import UploadProgressModal from '../components/UploadProgressModal';
import './CoupangManagement.css';

// ── 분류 드롭박스 옵션 목록 ────────────────────────────────────────
const PACKAGE_TYPE_OPTIONS = ['출고', '렉', '박스', '시즌오프', '폐기', '기타'] as const

// ── 분류별 뱃지 색상 맵 (배경색 + 텍스트색) ─────────────────────────
const PACKAGE_TYPE_COLORS: Record<string, { background: string; color: string }> = {
  '출고':    { background: '#f3f4f6', color: '#374151' },  // 회색
  '렉':      { background: '#dbeafe', color: '#1d4ed8' },  // 파랑
  '박스':    { background: '#fed7aa', color: '#c2410c' },  // 주황
  '시즌오프': { background: '#ede9fe', color: '#6d28d9' }, // 보라
  '폐기':    { background: '#fee2e2', color: '#991b1b' },  // 빨강
  '기타':    { background: '#1f2937', color: '#ffffff' },  // 검정 배경 + 흰색 폰트
}

// Types
export interface CoupangItem {
  option_id: string;
  item_id: string;
  barcode: string;
  item_name: string;
  option_name: string;
  price: number;
  regular_price: number;
  sales_status: string;
  item_status: string;
  product_id?: string;
  item_code?: string;
  product_name?: string;
  stock?: number;
  sales_data?: number;
  coupang_approval?: string;
  edit_price?: number;
  edit_regular_price?: number;
  edit_sales_status?: string;
  edit_stock?: number;
  package_type?: string;  // 분류 열
  note?: string;          // 비고 열
}

const CoupangManagement: React.FC = () => {
  const [items, setItems] = useState<CoupangItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [totalCount, setTotalCount] = useState(0);

  // ── 체크박스 선택 상태 — option_id(PK) 기준 ──────────────────────
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set())

  // ── 비고 인라인 편집 상태 ────────────────────────────────────────
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')

  // ── 일괄 분류 변경 모달 상태 ─────────────────────────────────────
  const [isBulkClassifyModalOpen, setIsBulkClassifyModalOpen] = useState(false)
  const [bulkPackageType, setBulkPackageType] = useState<string>('출고')
  const [bulkNote, setBulkNote] = useState('')

  // ── 엑셀 분류 업로드 결과 모달 상태 ──────────────────────────────
  const [isExcelClassifyResultOpen, setIsExcelClassifyResultOpen] = useState(false)
  const [excelClassifyResult, setExcelClassifyResult] = useState<{
    successCount: number
    notFoundBarcodes: string[]                           // 오류사유 1: DB 미조회 바코드
    invalidTypeBarcodes: { barcode: string; inputType: string }[]  // 오류사유 2: 유효하지 않은 분류값
  } | null>(null)

  // Search states
  const [searchType, setSearchType] = useState<'상품명' | '바코드'>('상품명');
  const [searchValue, setSearchValue] = useState('');
  const [deliveryType, setDeliveryType] = useState<'전체' | '로켓그로스' | '일반'>('전체');
  const [salesStatus, setSalesStatus] = useState<'전체' | '판매중' | '판매중지'>('판매중');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // Fetch data from Supabase with server-side pagination
  const fetchItems = async (
    page: number = 1,
    search?: string,
    searchBy?: '상품명' | '바코드',
    delivery?: '전체' | '로켓그로스' | '일반',
    sales?: '전체' | '판매중' | '판매중지'
  ) => {
    setLoading(true);
    try {
      // Get user UUID from localStorage
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;
      const userId = user?.id;

      if (!userId) {
        console.error('No user id found');
        setItems([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      const from = (page - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      // Build query with user_id filter
      let query = supabase
        .from('si_coupang_items')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);

      // Apply search filter
      if (search && search.trim()) {
        if (searchBy === '상품명') {
          query = query.ilike('item_name', `%${search}%`);
        } else if (searchBy === '바코드') {
          query = query.eq('barcode', search);
        }
      }

      // Apply delivery type filter (로켓그로스/일반)
      const currentDelivery = delivery || deliveryType;
      if (currentDelivery === '로켓그로스') {
        // 로켓그로스: barcode 데이터가 존재하는 것
        query = query.not('barcode', 'is', null).neq('barcode', '');
      } else if (currentDelivery === '일반') {
        // 일반: barcode 데이터가 없는 것
        query = query.or('barcode.is.null,barcode.eq.');
      }

      // Apply sales status filter
      const currentSalesStatus = sales || salesStatus;
      if (currentSalesStatus === '판매중') {
        query = query.eq('sales_status', '판매중');
      } else if (currentSalesStatus === '판매중지') {
        query = query.eq('sales_status', '판매중지');
      }

      // Apply pagination
      query = query.range(from, to).order('item_id', { ascending: false });

      const { data, error, count } = await query;

      if (error) throw error;

      console.log(`Fetched ${data?.length || 0} items from Supabase (Page ${page})`);
      setItems(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching items:', error);
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems(currentPage, searchValue, searchType, deliveryType, salesStatus);
  }, [currentPage]);

  // 페이지 이동/검색으로 items 변경 시 체크박스 선택 초기화
  useEffect(() => {
    setSelectedOptionIds(new Set())
  }, [items])

  // ── 체크박스 핸들러 ───────────────────────────────────────────────

  /** 전체 선택/해제 */
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOptionIds(new Set(currentItems.map(item => item.option_id)))
    } else {
      setSelectedOptionIds(new Set())
    }
  }

  /** 개별 행 선택/해제 */
  const handleSelectItem = (optionId: string, checked: boolean) => {
    const next = new Set(selectedOptionIds)
    if (checked) {
      next.add(optionId)
    } else {
      next.delete(optionId)
    }
    setSelectedOptionIds(next)
  }

  // ── 분류 드롭박스 변경 핸들러 ────────────────────────────────────

  /**
   * 분류(package_type) 드롭박스 선택 변경
   * - 낙관적 UI: DB 응답 전에 로컬 state 먼저 반영
   * - DB: si_coupang_items.package_type 업데이트
   */
  const handlePackageTypeChange = async (optionId: string, newType: string) => {
    setItems(prev =>
      prev.map(item => item.option_id === optionId ? { ...item, package_type: newType } : item)
    )
    const userStr = localStorage.getItem('user')
    const userId = userStr ? JSON.parse(userStr)?.id : null
    if (!userId) return

    const { error } = await supabase
      .from('si_coupang_items')
      .update({ package_type: newType })
      .eq('option_id', optionId)
      .eq('user_id', userId)

    if (error) console.error('분류 업데이트 오류:', error)
  }

  // ── 비고 인라인 편집 핸들러 ──────────────────────────────────────

  /** 비고 셀 클릭 → 편집 모드 진입 */
  const handleNoteClick = (optionId: string, currentNote: string | undefined) => {
    setEditingNoteId(optionId)
    setEditingNoteValue(currentNote || '')
  }

  /**
   * 비고 편집 완료 (blur) → DB 저장
   * - 변경사항 없으면 DB 호출 생략 (불필요한 네트워크 요청 방지)
   * - 낙관적 UI: setItems 먼저 반영
   */
  const handleNoteBlur = async (optionId: string, originalNote: string | undefined) => {
    const trimmed = editingNoteValue.trim()
    const original = (originalNote || '').trim()

    setEditingNoteId(null)
    if (trimmed === original) return  // 변경 없음 → DB 호출 생략

    setItems(prev =>
      prev.map(item => item.option_id === optionId ? { ...item, note: trimmed } : item)
    )

    const userStr = localStorage.getItem('user')
    const userId = userStr ? JSON.parse(userStr)?.id : null
    if (!userId) return

    const { error } = await supabase
      .from('si_coupang_items')
      .update({ note: trimmed })
      .eq('option_id', optionId)
      .eq('user_id', userId)

    if (error) console.error('비고 업데이트 오류:', error)
  }

  // ── 일괄 분류 변경 핸들러 ────────────────────────────────────────

  /**
   * 체크박스로 선택된 항목들의 package_type, note를 일괄 업데이트
   * - package_type: 항상 선택한 값으로 변경
   * - note: 입력값이 있을 때만 반영, 비워두면 기존 값 유지
   * - Supabase .in() 필터로 단일 쿼리 처리
   * - 낙관적 UI: DB 응답 전에 로컬 state 먼저 반영
   */
  const handleBulkClassify = async () => {
    const userStr = localStorage.getItem('user')
    const userId = userStr ? JSON.parse(userStr)?.id : null
    if (!userId || selectedOptionIds.size === 0) return

    const ids = Array.from(selectedOptionIds)
    const noteValue = bulkNote.trim()

    // note가 입력된 경우에만 payload에 포함 (빈 값이면 기존 비고 유지)
    const updatePayload: { package_type: string; note?: string } = {
      package_type: bulkPackageType,
    }
    if (noteValue) updatePayload.note = noteValue

    const { error } = await supabase
      .from('si_coupang_items')
      .update(updatePayload)
      .in('option_id', ids)
      .eq('user_id', userId)

    if (error) {
      console.error('일괄 분류 변경 오류:', error)
      return
    }

    // 낙관적 UI: 선택된 항목만 로컬 state 업데이트
    setItems(prev => prev.map(item => {
      if (!selectedOptionIds.has(item.option_id)) return item
      return {
        ...item,
        package_type: bulkPackageType,
        ...(noteValue ? { note: noteValue } : {}),
      }
    }))

    // 모달 닫기 + 상태 초기화
    setIsBulkClassifyModalOpen(false)
    setBulkPackageType('출고')
    setBulkNote('')
  }

  // ── 엑셀 분류 업로드 핸들러 ──────────────────────────────────────

  /**
   * 엑셀 파일로 si_coupang_items의 package_type / note 일괄 업데이트
   *
   * 엑셀 포맷:
   *   1행: 헤더 (건너뜀)
   *   A열: 바코드 (필수)
   *   B열: 분류 (package_type) — PACKAGE_TYPE_OPTIONS 값 중 하나
   *   C열: 비고 (note) — 선택
   *
   * 처리 흐름:
   *   STEP 1. 엑셀 파싱 + B열 분류값 유효성 사전 검사 (오류사유 2 수집)
   *   STEP 2. 유효 바코드 목록을 si_coupang_items에서 일괄 조회 (오류사유 1 수집)
   *   STEP 3. 조회된 행만 package_type / note 업데이트
   *   STEP 4. 결과 모달 표시 + 테이블 새로고침
   */
  const handleExcelClassifyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // input 초기화 (동일 파일 재업로드 허용)
    if (!file) return

    const userStr = localStorage.getItem('user')
    const userId = userStr ? JSON.parse(userStr)?.id : null
    if (!userId) return

    // ── STEP 1: 엑셀 파싱 + 분류값 유효성 사전 검사 ─────────────────
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer)
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    // header: 1 → 배열 기반 파싱, 인덱스 0이 1행(헤더)
    const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
    const dataRows = allRows.slice(1).filter(row => row[0])  // 헤더 제외, 바코드 필수

    const VALID_TYPES = new Set<string>(PACKAGE_TYPE_OPTIONS)

    type ParsedRow = { barcode: string; packageType: string | null; note: string | null }
    const parsed: ParsedRow[] = []
    const invalidTypeBarcodes: { barcode: string; inputType: string }[] = []

    for (const row of dataRows) {
      const barcode    = String(row[0]).trim()
      const rawType    = row[1] ? String(row[1]).trim() : null
      const note       = row[2] ? String(row[2]).trim() : null

      // 분류값이 있고 허용 목록에 없으면 → 오류사유 2
      if (rawType && !VALID_TYPES.has(rawType)) {
        invalidTypeBarcodes.push({ barcode, inputType: rawType })
        continue
      }
      parsed.push({ barcode, packageType: rawType, note })
    }

    const notFoundBarcodes: string[] = []

    if (parsed.length === 0) {
      setExcelClassifyResult({ successCount: 0, notFoundBarcodes, invalidTypeBarcodes })
      setIsExcelClassifyResultOpen(true)
      return
    }

    // ── STEP 2: si_coupang_items에서 바코드 일괄 존재 확인 ────────────
    const barcodes = parsed.map(r => r.barcode)
    const { data: foundItems } = await supabase
      .from('si_coupang_items')
      .select('barcode')
      .eq('user_id', userId)
      .in('barcode', barcodes)

    const foundBarcodeSet = new Set((foundItems || []).map((r: { barcode: string }) => r.barcode))

    // 조회 안된 바코드 → 오류사유 1, 조회된 바코드만 업데이트 대상으로 분리
    const validRows = parsed.filter(r => {
      if (!foundBarcodeSet.has(r.barcode)) {
        notFoundBarcodes.push(r.barcode)
        return false
      }
      return true
    })

    // ── STEP 3: 유효한 행 package_type / note 업데이트 ──────────────
    let successCount = 0

    for (const row of validRows) {
      const updatePayload: { package_type?: string; note?: string } = {}
      if (row.packageType) updatePayload.package_type = row.packageType
      if (row.note)        updatePayload.note          = row.note

      // 업데이트할 값이 없어도 바코드 자체는 유효하므로 성공 카운트
      if (Object.keys(updatePayload).length === 0) {
        successCount++
        continue
      }

      const { error } = await supabase
        .from('si_coupang_items')
        .update(updatePayload)
        .eq('barcode', row.barcode)
        .eq('user_id', userId)

      if (!error) successCount++
    }

    // ── STEP 4: 결과 모달 표시 + 테이블 새로고침 ─────────────────────
    setExcelClassifyResult({ successCount, notFoundBarcodes, invalidTypeBarcodes })
    setIsExcelClassifyResultOpen(true)
    fetchItems(currentPage, searchValue, searchType, deliveryType, salesStatus)
  }

  // Handle search
  const handleSearch = () => {
    setCurrentPage(1); // Reset to first page when searching
    fetchItems(1, searchValue, searchType, deliveryType, salesStatus);
  };

  // Handle Excel upload
  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('파일을 읽는 중...');

    try {
      // Get user UUID from localStorage
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;
      const userId = user?.id;

      if (!userId) {
        console.error('No user id found for current user');
        setUploadStatus('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
        setTimeout(() => {
          setIsUploading(false);
          setUploadProgress(0);
          setUploadStatus('');
        }, 3000);
        return;
      }

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      console.log('Total rows in Excel:', jsonData.length);
      console.log('First 5 rows:', jsonData.slice(0, 5));
      console.log('Using user_id:', userId);

      // Skip first 3 rows (headers), data starts from row 4
      const dataRows = jsonData.slice(3) as any[][];
      const totalRows = dataRows.length;

      console.log('Data rows to process:', totalRows);
      console.log('First data row:', dataRows[0]);

      setUploadStatus(`총 ${totalRows}개 데이터 처리 중...`);

      let totalInserted = 0;
      let totalErrors = 0;

      // Process in batches
      const batchSize = 100;
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = dataRows.slice(i, Math.min(i + batchSize, dataRows.length));

        const items = batch
          .filter(row => row[2]) // option_id (column C) must exist
          .map(row => ({
            item_id: row[0] || null,
            product_id: row[1] || null,
            option_id: row[2],
            item_status: row[3] || null,
            barcode: row[4] || null,
            item_code: row[5] || null,
            product_name: row[6] || null,
            item_name: row[7] || null,
            option_name: row[8] || null,
            price: row[9] ? parseInt(String(row[9]).replace(/,/g, '')) : null,
            regular_price: row[10] ? parseInt(String(row[10]).replace(/,/g, '')) : null,
            sales_status: row[11] || null,
            stock: row[12] ? parseInt(String(row[12])) : null,
            sales_data: row[13] ? parseInt(String(row[13])) : null,
            coupang_approval: row[14] || null,
            edit_price: row[15] ? parseInt(String(row[15]).replace(/,/g, '')) : null,
            edit_regular_price: row[16] ? parseInt(String(row[16]).replace(/,/g, '')) : null,
            edit_sales_status: row[17] || null,
            edit_stock: row[18] ? parseInt(String(row[18])) : null,
            package_type: '출고',  // xlsx 업로드 시 분류 기본값 (이후 드롭박스로 수동 변경 가능)
            user_id: userId,
          }));

        console.log(`Batch ${i / batchSize + 1}: ${items.length} items`);
        if (items.length > 0) {
          console.log('First item in batch:', items[0]);
        }

        if (items.length > 0) {
          const { data: insertedData, error } = await supabase
            .from('si_coupang_items')
            .upsert(items, { onConflict: 'option_id' });

          if (error) {
            console.error('Error upserting batch:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
            totalErrors++;
          } else {
            console.log('Successfully inserted/updated batch');
            totalInserted += items.length;
          }
        }

        const progress = Math.round(((i + batch.length) / totalRows) * 100);
        setUploadProgress(progress);
        setUploadStatus(`처리 중... ${i + batch.length} / ${totalRows} (성공: ${totalInserted}, 실패: ${totalErrors})`);
      }

      console.log(`Upload complete. Total inserted: ${totalInserted}, Total errors: ${totalErrors}`);
      setUploadStatus(`업로드 완료! (성공: ${totalInserted}, 실패: ${totalErrors})`);
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadStatus('');
        fetchItems(currentPage, searchValue, searchType, deliveryType, salesStatus);
      }, 2000);

    } catch (error) {
      console.error('Error processing file:', error);
      setUploadStatus('업로드 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadStatus('');
      }, 3000);
    }

    event.target.value = '';
  };

  // Export to Excel
  const exportToExcel = () => {
    const worksheetData = items.map(item => ({
      ID: item.item_id,
      바코드: item.barcode,
      상품명: item.item_name,
      옵션명: item.option_name,
      가격: item.price,
      정가: item.regular_price,
      상태: item.sales_status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '쿠팡관리');

    const fileName = `쿠팡관리_${new Date().toLocaleDateString('ko-KR').replace(/\. /g, '-').replace('.', '')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  // Delete item
  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('si_coupang_items')
        .delete()
        .eq('option_id', id);

      if (error) throw error;
      fetchItems(currentPage, searchValue, searchType, deliveryType, salesStatus);
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  // Pagination calculations (now using server-side total count)
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalCount);
  const currentItems = items; // No need to slice anymore, server already paginated

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div className="coupang-management-container">
      <h1 className="coupang-management-title">쿠팡관리</h1>

      {/* Action Buttons */}
      <div className="coupang-action-buttons-top">
        {/* xlsx 업로드 — 초록 */}
        <label className="coupang-btn coupang-btn-upload">
          쿠팡 xlsx
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelUpload}
            style={{ display: 'none' }}
          />
        </label>
        {/* 엑셀 저장 — 초록 */}
        <button onClick={exportToExcel} className="coupang-btn coupang-btn-export">
          엑셀 저장하기
        </button>

        {/* 구분선 */}
        <div className="coupang-btn-divider" />

        {/* 분류 일괄 변경 — 체크박스 선택 시에만 활성화 */}
        <button
          onClick={() => setIsBulkClassifyModalOpen(true)}
          disabled={selectedOptionIds.size === 0}
          className="coupang-btn coupang-btn-classify"
        >
          분류 {selectedOptionIds.size > 0 && `(${selectedOptionIds.size})`}
        </button>

        {/* 엑셀 분류 업로드 — 바코드 기준 package_type/note 일괄 설정 */}
        <label className="coupang-btn coupang-btn-excel-classify">
          엑셀분류
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelClassifyUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* Search Section */}
      <div className="coupang-search-section">
        {/* Filter Buttons Container */}
        <div className="coupang-filters-container" style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
          {/* Delivery Type Filter */}
          <div className="coupang-filter-buttons">
            {(['전체', '로켓그로스', '일반'] as const).map((type) => (
              <button
                key={type}
                onClick={() => {
                  setDeliveryType(type);
                  setCurrentPage(1);
                  fetchItems(1, searchValue, searchType, type, salesStatus);
                }}
                className={`coupang-filter-btn ${deliveryType === type ? 'active' : ''}`}
              >
                {type}
              </button>
            ))}
          </div>

          <div style={{ borderLeft: '1px solid #ddd', height: '32px' }}></div>

          {/* Sales Status Filter */}
          <div className="coupang-filter-buttons">
            {(['전체', '판매중', '판매중지'] as const).map((status) => (
              <button
                key={status}
                onClick={() => {
                  setSalesStatus(status);
                  setCurrentPage(1);
                  fetchItems(1, searchValue, searchType, deliveryType, status);
                }}
                className={`coupang-filter-btn ${salesStatus === status ? 'active' : ''}`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Search Form */}
        <div className="coupang-search-form">
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as '상품명' | '바코드')}
            className="coupang-search-select"
          >
            <option value="상품명">상품명</option>
            <option value="바코드">바코드</option>
          </select>

          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={`${searchType}을(를) 입력하세요`}
            className="coupang-search-input"
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />

          <button onClick={handleSearch} className="coupang-btn coupang-btn-search">
            검색
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="coupang-table-section">
        {loading ? (
          <div className="coupang-loading">데이터를 불러오는 중...</div>
        ) : (
          <div className="coupang-table-wrapper">
            <table className="coupang-table">
              {/* 분류 2배, 비고 3배 확대 → 상품정보 너비 축소로 균형 유지 */}
              {/* colgroup: 체크박스 3% | 상품정보 43% | 가격 8% | 분류 14% | 비고 23% | 작업 9% */}
              <colgroup>
                <col style={{ width: '3%' }}/>
                <col style={{ width: '43%' }}/>
                <col style={{ width: '8%' }}/>
                <col style={{ width: '14%' }}/>
                <col style={{ width: '23%' }}/>
                <col style={{ width: '9%' }}/>
              </colgroup>
              <thead>
                <tr>
                  {/* 전체 선택 체크박스 */}
                  <th style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={currentItems.length > 0 && selectedOptionIds.size === currentItems.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                    />
                  </th>
                  {/* 상품명 + 옵션명 + 판매상태 dot + option_id/barcode 통합 */}
                  <th>상품정보</th>
                  <th>가격</th>
                  {/* 분류: package_type 드롭박스 */}
                  <th>분류</th>
                  {/* 비고: note 인라인 편집 */}
                  <th>비고</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="coupang-table-empty">
                      데이터가 없습니다
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item) => (
                    <tr key={item.option_id}>
                      {/* 개별 선택 체크박스 */}
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedOptionIds.has(item.option_id)}
                          onChange={(e) => handleSelectItem(item.option_id, e.target.checked)}
                          style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                        />
                      </td>
                      {/*
                        상품정보 (2행 레이아웃):
                        - 1행: item_name, option_name + 판매상태 dot (● 초록/빨강)
                        - 2행: option_id / barcode — 바코드 존재 시 🚀 이모지 추가
                      */}
                      <td>
                        <div>
                          {item.item_name || '-'}, {item.option_name || '-'}
                          {' '}
                          {item.sales_status === '판매중' && (
                            <span style={{ color: '#16a34a', fontSize: '16px' }}>●</span>
                          )}
                          {item.sales_status === '판매중지' && (
                            <span style={{ color: '#dc2626', fontSize: '16px' }}>●</span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '4px' }}>
                          {item.barcode
                            ? `${item.option_id || '-'} / ${item.barcode} 🚀`
                            : (item.option_id || '-')
                          }
                        </div>
                      </td>
                      <td>{item.price ? `${item.price.toLocaleString()}원` : '-'}</td>
                      {/* 분류: package_type 드롭박스 — 선택값에 따라 뱃지 색상 변경 */}
                      <td>
                        {(() => {
                          const pkgType = item.package_type || '정규'
                          const pkgColor = PACKAGE_TYPE_COLORS[pkgType] ?? PACKAGE_TYPE_COLORS['기타']
                          return (
                            <select
                              value={pkgType}
                              onChange={(e) => handlePackageTypeChange(item.option_id, e.target.value)}
                              style={{
                                border: 'none',
                                borderRadius: '12px',
                                padding: '3px 10px',
                                background: pkgColor.background,
                                color: pkgColor.color,
                                cursor: 'pointer',
                                fontSize: 'inherit',
                              }}
                            >
                              {PACKAGE_TYPE_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          )
                        })()}
                      </td>
                      {/*
                        비고: note 인라인 편집
                        - 셀 클릭 → textarea 전환 (border 없는 미니멀 스타일)
                        - blur 시 변경사항이 있을 때만 DB 저장
                        - whiteSpace: pre-wrap 으로 줄바꿈 표시
                      */}
                      <td
                        onClick={() => editingNoteId !== item.option_id && handleNoteClick(item.option_id, item.note)}
                        style={{ cursor: 'text', verticalAlign: 'top' }}
                      >
                        {editingNoteId === item.option_id ? (
                          <textarea
                            autoFocus
                            value={editingNoteValue}
                            onChange={(e) => setEditingNoteValue(e.target.value)}
                            onBlur={() => handleNoteBlur(item.option_id, item.note)}
                            rows={2}
                            style={{
                              border: 'none',
                              outline: 'none',
                              background: 'transparent',
                              resize: 'none',
                              width: '100%',
                              fontSize: 'inherit',
                              fontFamily: 'inherit',
                              color: 'inherit',
                              padding: 0,
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                            }}
                          />
                        ) : (
                          <span style={{ whiteSpace: 'pre-wrap' }}>
                            {item.note || ''}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          onClick={() => handleDelete(item.option_id)}
                          className="coupang-btn-small coupang-btn-delete"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="coupang-pagination">
            <div className="coupang-pagination-info">
              전체 {totalCount.toLocaleString()}개 중 {startIndex + 1} - {Math.min(endIndex, totalCount)} 표시
            </div>
            <div className="coupang-pagination-controls">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="coupang-pagination-btn"
              >
                이전
              </button>
              {getPageNumbers().map((page, index) => (
                typeof page === 'number' ? (
                  <button
                    key={index}
                    onClick={() => handlePageChange(page)}
                    className={`coupang-pagination-btn ${currentPage === page ? 'active' : ''}`}
                  >
                    {page}
                  </button>
                ) : (
                  <span key={index} className="coupang-pagination-ellipsis">
                    {page}
                  </span>
                )
              ))}
              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="coupang-pagination-btn"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/*
        ── 일괄 분류 변경 모달 ──────────────────────────────────────────
        - 체크박스 선택된 항목들의 package_type / note를 한 번에 변경
        - note 입력이 없으면 기존 비고 유지 (package_type만 업데이트)
      */}
      {isBulkClassifyModalOpen && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: 'white', borderRadius: '10px',
            padding: '28px 32px', minWidth: '380px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            {/* 모달 헤더 */}
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: '#111827' }}>
              분류 일괄 변경
              <span style={{ marginLeft: '8px', fontSize: '13px', color: '#6b7280', fontWeight: 400 }}>
                {selectedOptionIds.size}개 선택됨
              </span>
            </h3>

            {/* 분류 드롭박스 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '6px' }}>
                분류
              </label>
              {(() => {
                const pkgColor = PACKAGE_TYPE_COLORS[bulkPackageType] ?? PACKAGE_TYPE_COLORS['기타']
                return (
                  <select
                    value={bulkPackageType}
                    onChange={(e) => setBulkPackageType(e.target.value)}
                    style={{
                      border: 'none',
                      borderRadius: '12px',
                      padding: '5px 14px',
                      background: pkgColor.background,
                      color: pkgColor.color,
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    {PACKAGE_TYPE_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )
              })()}
            </div>

            {/* 비고 입력 */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '6px' }}>
                비고
                <span style={{ marginLeft: '6px', fontSize: '11px', color: '#9ca3af' }}>
                  (비워두면 기존 비고 유지)
                </span>
              </label>
              <textarea
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                placeholder="비고를 입력하세요..."
                rows={3}
                style={{
                  width: '100%',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '14px',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  color: '#111827',
                }}
              />
            </div>

            {/* 액션 버튼 */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setIsBulkClassifyModalOpen(false)
                  setBulkPackageType('정규')
                  setBulkNote('')
                }}
                style={{
                  padding: '8px 20px', border: '1px solid #d1d5db',
                  borderRadius: '6px', background: 'white', color: '#374151',
                  cursor: 'pointer', fontSize: '14px',
                }}
              >
                취소
              </button>
              <button
                onClick={handleBulkClassify}
                style={{
                  padding: '8px 20px', border: 'none',
                  borderRadius: '6px', background: '#6366f1', color: 'white',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        ── 엑셀 분류 업로드 결과 모달 ────────────────────────────────
        - 정상처리 건수
        - 오류사유 1: 바코드 조회 안됨 (리스트)
        - 오류사유 2: 허용되지 않은 분류값 (바코드 - 입력값 쌍)
      */}
      {isExcelClassifyResultOpen && excelClassifyResult && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: 'white', borderRadius: '10px',
            padding: '28px 32px', minWidth: '440px', maxWidth: '600px',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            {/* 헤더 */}
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: '#111827' }}>
              엑셀 분류 업로드 결과
            </h3>

            {/* 정상처리 */}
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '6px', padding: '12px 16px', marginBottom: '16px',
            }}>
              <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '14px' }}>
                ✓ 정상처리: {excelClassifyResult.successCount}건
              </span>
            </div>

            {/* 오류사유 1: 바코드 조회 안됨 */}
            {excelClassifyResult.notFoundBarcodes.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626', marginBottom: '8px' }}>
                  오류사유 1 &nbsp;·&nbsp; 바코드 조회되지 않음&nbsp;
                  <span style={{ fontWeight: 400, color: '#6b7280' }}>
                    ({excelClassifyResult.notFoundBarcodes.length}건)
                  </span>
                </div>
                <div style={{
                  background: '#fef2f2', borderRadius: '6px',
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {excelClassifyResult.notFoundBarcodes.map((barcode, i) => (
                    <div key={i} style={{
                      fontSize: '13px', color: '#374151', padding: '4px 0',
                      borderBottom: i < excelClassifyResult.notFoundBarcodes.length - 1
                        ? '1px solid #fee2e2' : 'none',
                    }}>
                      {barcode}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 오류사유 2: 허용되지 않은 분류값 */}
            {excelClassifyResult.invalidTypeBarcodes.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#d97706', marginBottom: '8px' }}>
                  오류사유 2 &nbsp;·&nbsp; 분류 타입이 맞지 않습니다&nbsp;
                  <span style={{ fontWeight: 400, color: '#6b7280' }}>
                    ({excelClassifyResult.invalidTypeBarcodes.length}건)
                  </span>
                </div>
                <div style={{
                  background: '#fffbeb', borderRadius: '6px',
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {/* 헤더 */}
                  <div style={{
                    display: 'flex', gap: '8px', fontSize: '12px',
                    color: '#9ca3af', paddingBottom: '6px',
                    borderBottom: '1px solid #fde68a', marginBottom: '4px',
                  }}>
                    <span style={{ flex: 1 }}>바코드</span>
                    <span style={{ width: '100px' }}>입력된 분류</span>
                  </div>
                  {excelClassifyResult.invalidTypeBarcodes.map(({ barcode, inputType }, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '8px', fontSize: '13px',
                      color: '#374151', padding: '4px 0',
                      borderBottom: i < excelClassifyResult.invalidTypeBarcodes.length - 1
                        ? '1px solid #fde68a' : 'none',
                    }}>
                      <span style={{ flex: 1 }}>{barcode}</span>
                      <span style={{ width: '100px', color: '#dc2626' }}>{inputType}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 확인 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                onClick={() => { setIsExcelClassifyResultOpen(false); setExcelClassifyResult(null) }}
                style={{
                  padding: '8px 24px', border: 'none', borderRadius: '6px',
                  background: '#6366f1', color: 'white',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      <UploadProgressModal
        isOpen={isUploading}
        progress={uploadProgress}
        status={uploadStatus}
        title="쿠팡 엑셀 업로드 중"
      />
    </div>
  );
};

export default CoupangManagement;
/* ================================================================
   UploadProgressModal — 엑셀 업로드 전용 래퍼
   - 공용 ProgressModal 을 엑셀 업로드 기본 타이틀로 감쌈
   - 기존 호출부 하위 호환 유지
   ================================================================ */

import React from 'react'
import ProgressModal from './common/ProgressModal'

interface UploadProgressModalProps {
  isOpen: boolean
  progress: number
  status: string
  title?: string
}

const UploadProgressModal: React.FC<UploadProgressModalProps> = ({
  isOpen,
  progress,
  status,
  title = '엑셀 업로드 중',
}) => (
  <ProgressModal
    isOpen={isOpen}
    title={title}
    progress={progress}
    status={status}
  />
)

export default UploadProgressModal

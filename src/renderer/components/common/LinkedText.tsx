/* ================================================================
   LinkedText — 텍스트 안의 http(s) URL 을 자동으로 클릭 가능한
   링크(새 탭)로 렌더링. 줄바꿈 보존은 부모의 whiteSpace: pre-wrap 사용.
   - CS 문의/답변 본문에 포함된 링크를 복사 없이 바로 열기 위함
   ================================================================ */

import React from 'react'
import { theme } from '../../styles/theme'

// http/https URL — 공백·괄호·꺾쇠는 제외 (뒤따르는 ')' 등이 링크에 포함되지 않도록)
const URL_RE = /(https?:\/\/[^\s<>()]+)/g

const LinkedText: React.FC<{ text?: string | null }> = ({ text }) => {
  if (!text) return null
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: theme.colors.primary, textDecoration: 'underline', wordBreak: 'break-all' }}
          >
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  )
}

export default LinkedText

import React from 'react'

const Index: React.FC = () => {
  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px', fontSize: '28px', color: '#333' }}>공지사항</h1>
      <div
        style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
          환영합니다! 이곳은 공지사항 페이지입니다.
        </p>
        <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginTop: '10px' }}>
          왼쪽 상단의 메뉴 버튼을 클릭하여 다른 페이지로 이동할 수 있습니다.
        </p>
      </div>
    </div>
  )
}

export default Index

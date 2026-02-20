# Stock Management System

Electron 기반 재고관리 프로그램

## 프로젝트 구조

```
immong-stocks/
├── src/
│   ├── main/              # Electron 메인 프로세스
│   │   └── main.ts
│   ├── preload/           # Electron 프리로드 스크립트
│   │   └── preload.ts
│   └── renderer/          # React 애플리케이션
│       ├── components/    # 공통 컴포넌트
│       │   ├── Layout.tsx
│       │   ├── Sidebar.tsx
│       │   └── ProtectedRoute.tsx
│       ├── pages/         # 페이지 컴포넌트
│       │   ├── Login.tsx
│       │   ├── Register.tsx
│       │   ├── Index.tsx
│       │   ├── Inventory.tsx
│       │   ├── InOut.tsx
│       │   └── Export.tsx
│       ├── services/      # API 서비스
│       │   └── supabase.ts
│       ├── types/         # TypeScript 타입 정의
│       │   └── auth.ts
│       ├── styles/        # 글로벌 스타일
│       │   └── global.css
│       ├── App.tsx
│       └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── supabase-setup.sql     # Supabase 데이터베이스 설정 SQL
```

## 주요 기능

### 1. 인증 시스템
- **로그인**: 아이디/패스워드 인증
- **회원가입**: 관리자 승인 방식
  - 필수 정보: 아이디, 패스워드, 사업자ID, 이름, 연락처, 이메일
  - 승인 대기: `approved = false` (기본값)
  - 승인 후 로그인 가능: `approved = true`

### 2. 페이지 구성
- **로그인 페이지** (`/login`): 중앙 정렬 로그인 폼
- **회원가입 페이지** (`/register`): 7개 필드 입력 폼
- **홈/공지사항** (`/`): 로그인 후 첫 화면
- **재고관리** (`/inventory`): 빈 템플릿
- **입출고관리** (`/inout`): 빈 템플릿
- **반출건관리** (`/export`): 빈 템플릿

### 3. UI 구성
- **슬라이드 사이드바**: 왼쪽에서 나타나는 메뉴
- **메뉴 토글 버튼**: 왼쪽 상단 네모 버튼 (☰)
- **보호된 라우트**: 로그인 & 승인 확인 후 접근 가능

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. Supabase 데이터베이스 설정
1. Supabase 프로젝트에 접속
2. SQL Editor에서 `supabase-setup.sql` 파일 내용 실행
3. `SI_users` 테이블이 생성됩니다

### 3. 개발 모드 실행
```bash
npm run dev
```

### 4. 프로덕션 빌드
```bash
npm run build
```

## Supabase 설정

- **Project ID**: `bzufmxzjanhihxahyvhb`
- **Project URL**: `https://bzufmxzjanhihxahyvhb.supabase.co`
- **테이블**: `SI_users`

### SI_users 테이블 스키마

| 컬럼명 | 타입 | 설명 | 기본값 |
|--------|------|------|--------|
| id | UUID | 고유 ID | auto |
| user_id | TEXT | 로그인 아이디 (UNIQUE) | - |
| password | TEXT | 비밀번호 | - |
| business_id | TEXT | 사업자 등록번호 | - |
| name | TEXT | 사용자 이름 | - |
| phone | TEXT | 연락처 | - |
| email | TEXT | 이메일 주소 | - |
| approved | BOOLEAN | 승인 여부 | false |
| created_at | TIMESTAMP | 생성일시 | NOW() |

## 보안 참고사항

⚠️ **현재 구현은 개발 단계입니다. 프로덕션 배포 전 다음 사항을 개선해야 합니다:**

1. **비밀번호 해싱**: 현재는 평문으로 저장됩니다. bcrypt 등을 사용해 해싱 처리 필요
2. **Service Role Key**: 현재 클라이언트에 노출되어 있습니다. 백엔드 API로 분리 권장
3. **SQL Injection 방지**: Supabase가 기본적으로 제공하지만, 추가 검증 필요
4. **JWT 토큰**: localStorage 대신 보안 토큰 방식 권장

## 다음 단계

나머지 페이지(재고관리, 입출고관리, 반출건관리)의 템플릿과 내용을 알려주시면 계속 구현하겠습니다.

## 기술 스택

- **Frontend**: React 18 + TypeScript
- **Desktop**: Electron 28
- **Build Tool**: Vite 5
- **Backend**: Supabase
- **Router**: React Router v6
- **Styling**: Inline Styles (CSS-in-JS)

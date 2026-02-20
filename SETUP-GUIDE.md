# 🚀 Stock Management 설정 가이드

## 1️⃣ Supabase 데이터베이스 설정

### 방법 1: Supabase Dashboard에서 직접 실행

1. **Supabase 프로젝트 접속**
   - URL: https://supabase.com/dashboard/project/bzufmxzjanhihxahyvhb

2. **SQL Editor 열기**
   - 좌측 메뉴에서 `SQL Editor` 클릭
   - 또는 직접 접속: https://supabase.com/dashboard/project/bzufmxzjanhihxahyvhb/sql

3. **SQL 실행**
   - `New query` 버튼 클릭
   - 아래 SQL 코드를 복사하여 붙여넣기
   - `RUN` 버튼 클릭

```sql
-- SI_users 테이블 생성
CREATE TABLE IF NOT EXISTS SI_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- user_id에 인덱스 생성 (로그인 성능 향상)
CREATE INDEX IF NOT EXISTS idx_si_users_user_id ON SI_users(user_id);

-- approved에 인덱스 생성 (승인 여부 확인 성능 향상)
CREATE INDEX IF NOT EXISTS idx_si_users_approved ON SI_users(approved);

-- 테이블 설명 추가
COMMENT ON TABLE SI_users IS '재고관리 시스템 사용자 테이블';
COMMENT ON COLUMN SI_users.id IS '사용자 고유 ID (UUID)';
COMMENT ON COLUMN SI_users.user_id IS '로그인 아이디';
COMMENT ON COLUMN SI_users.password IS '비밀번호 (해싱 필요)';
COMMENT ON COLUMN SI_users.business_id IS '사업자 등록번호';
COMMENT ON COLUMN SI_users.name IS '사용자 이름';
COMMENT ON COLUMN SI_users.phone IS '연락처';
COMMENT ON COLUMN SI_users.email IS '이메일 주소';
COMMENT ON COLUMN SI_users.approved IS '관리자 승인 여부 (기본값: false)';
COMMENT ON COLUMN SI_users.created_at IS '생성일시';
```

4. **테이블 확인**
   - 좌측 메뉴에서 `Table Editor` 클릭
   - `SI_users` 테이블이 생성되었는지 확인

### 방법 2: 테스트 데이터 추가 (선택적)

관리자 계정 테스트용 데이터를 추가하려면:

```sql
-- 테스트 관리자 계정 추가 (승인된 상태)
INSERT INTO SI_users (user_id, password, business_id, name, phone, email, approved)
VALUES ('admin', 'admin123', '123-45-67890', '관리자', '010-1234-5678', 'admin@example.com', true);

-- 테스트 일반 사용자 (승인 대기 상태)
INSERT INTO SI_users (user_id, password, business_id, name, phone, email, approved)
VALUES ('user1', 'user123', '987-65-43210', '홍길동', '010-9876-5432', 'user1@example.com', false);
```

⚠️ **주의**: 프로덕션 환경에서는 비밀번호를 해싱하여 저장해야 합니다!

---

## 2️⃣ 애플리케이션 실행

### 개발 모드 실행

```bash
npm run dev
```

- Vite 개발 서버가 `http://localhost:5173`에서 실행됩니다
- Electron 창이 자동으로 열립니다
- 코드 변경 시 자동으로 새로고침됩니다

### 프로덕션 빌드

```bash
npm run build
```

- `release/` 폴더에 설치 파일이 생성됩니다
- Windows: `.exe` 설치 파일

---

## 3️⃣ 사용자 승인 프로세스

### 회원가입 후 승인 방법

1. **사용자가 회원가입**
   - 앱에서 회원가입 버튼 클릭
   - 정보 입력 후 가입
   - `approved = false` 상태로 저장됨

2. **관리자가 Supabase에서 승인**
   - Supabase Dashboard → Table Editor → SI_users
   - 승인할 사용자 찾기
   - `approved` 컬럼을 `false`에서 `true`로 변경
   - 저장

3. **사용자 로그인 가능**
   - 승인 후 로그인 가능
   - 승인 전에는 "관리자의 승인을 기다리고 있습니다" 메시지 표시

### SQL로 일괄 승인

```sql
-- 특정 사용자 승인
UPDATE SI_users
SET approved = true
WHERE user_id = '사용자ID';

-- 모든 대기 중인 사용자 승인
UPDATE SI_users
SET approved = true
WHERE approved = false;

-- 승인 대기 목록 조회
SELECT user_id, name, email, phone, created_at
FROM SI_users
WHERE approved = false
ORDER BY created_at DESC;
```

---

## 4️⃣ 문제 해결

### Supabase 연결 오류

**증상**: 로그인/회원가입 시 오류 발생

**해결방법**:
1. Supabase 프로젝트 URL 확인: `https://bzufmxzjanhihxahyvhb.supabase.co`
2. Service Role Key 확인 (src/renderer/services/supabase.ts)
3. 인터넷 연결 확인
4. Supabase 프로젝트가 활성 상태인지 확인

### Electron 창이 안 열릴 때

```bash
# 캐시 삭제 후 재실행
rm -rf node_modules dist dist-electron
npm install
npm run dev
```

### 빌드 오류

**Windows에서 빌드 실패 시**:
- Node.js 버전 확인 (v18 이상 권장)
- `node_modules` 삭제 후 재설치
- 관리자 권한으로 실행

---

## 5️⃣ 다음 단계

✅ 현재까지 완료:
- [x] 프로젝트 구조 생성
- [x] 로그인/회원가입 기능
- [x] Supabase 연동
- [x] 기본 페이지 템플릿

🔜 다음 작업:
- [ ] 재고관리 페이지 구현
- [ ] 입출고관리 페이지 구현
- [ ] 반출건관리 페이지 구현
- [ ] 사용자 관리 페이지 (관리자용)
- [ ] 비밀번호 해싱 적용

---

## 📞 참고 링크

- **Supabase Dashboard**: https://supabase.com/dashboard/project/bzufmxzjanhihxahyvhb
- **Electron 문서**: https://www.electronjs.org/docs
- **React Router**: https://reactrouter.com/
- **Vite 문서**: https://vitejs.dev/

---

## 🔐 보안 참고사항

⚠️ **프로덕션 배포 전 반드시 적용해야 할 사항**:

1. **비밀번호 해싱**
   - 현재: 평문 저장 (개발 단계)
   - 개선: bcrypt 또는 argon2 사용

2. **API Key 보호**
   - 현재: Service Role Key가 클라이언트에 노출
   - 개선: Anon Key 사용 + Row Level Security (RLS) 정책 설정

3. **환경변수 분리**
   - Supabase URL/Key를 `.env` 파일로 이동
   - Git에 커밋하지 않기

4. **입력값 검증**
   - 프론트엔드 + 백엔드 이중 검증
   - SQL Injection 방지

5. **HTTPS 사용**
   - 프로덕션 환경에서 HTTPS 필수

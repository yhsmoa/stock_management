-- SI_users 테이블 생성
CREATE TABLE IF NOT EXISTS public."SI_users" (
  user_id TEXT NOT NULL,
  index INTEGER NULL,
  password TEXT NULL,
  seller_id TEXT NOT NULL,
  name TEXT NULL,
  phone_number TEXT NULL,
  email_address TEXT NULL,
  account_approval TEXT NULL DEFAULT 'false',
  created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT SI_users_pkey PRIMARY KEY (user_id)
) TABLESPACE pg_default;

-- 인덱스 생성 (검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_si_users_seller_id ON public."SI_users"(seller_id);
CREATE INDEX IF NOT EXISTS idx_si_users_account_approval ON public."SI_users"(account_approval);

-- 테이블 설명 추가
COMMENT ON TABLE public."SI_users" IS '재고관리 시스템 사용자 테이블';
COMMENT ON COLUMN public."SI_users".user_id IS '아이디';
COMMENT ON COLUMN public."SI_users".index IS '회원가입 순서';
COMMENT ON COLUMN public."SI_users".password IS '패스워드';
COMMENT ON COLUMN public."SI_users".seller_id IS '사업자코드(아이디)';
COMMENT ON COLUMN public."SI_users".name IS '이름';
COMMENT ON COLUMN public."SI_users".phone_number IS '연락처';
COMMENT ON COLUMN public."SI_users".email_address IS '이메일주소';
COMMENT ON COLUMN public."SI_users".account_approval IS '승인여부 (기본값: false)';
COMMENT ON COLUMN public."SI_users".created_at IS '회원가입요청일자';

-- 테스트 데이터 (선택사항)
-- INSERT INTO public."SI_users" (user_id, password, seller_id, name, phone_number, email_address, account_approval)
-- VALUES ('admin', 'admin123', '123-45-67890', '관리자', '010-1234-5678', 'admin@example.com', 'true');

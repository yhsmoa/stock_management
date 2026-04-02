export interface AuthUser {
  id?: string
  username: string
  name: string
  email_address: string
  account_approval: string
  seller_id: string
  // ── 쿠팡 로켓그로스 API 인증 (si_users 테이블 컬럼) ──
  vendor_id: string | null
  coupang_access_key: string | null
  coupang_secret_key: string | null
}

export interface LoginFormData {
  user_id: string
  password: string
}

export interface RegisterFormData {
  user_id: string
  password: string
  passwordConfirm: string
  seller_id: string  // business_id를 seller_id로 변경
  name: string
  phone_number: string  // phone을 phone_number로 변경
  email_address: string  // email을 email_address로 변경
}

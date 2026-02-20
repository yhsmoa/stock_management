export interface AuthUser {
  id?: string
  username: string
  name: string
  email_address: string
  account_approval: string
  seller_id: string
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

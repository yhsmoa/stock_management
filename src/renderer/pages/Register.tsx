import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerUser } from '../services/supabase'
import { theme } from '../styles/theme'
import type { RegisterFormData } from '../types/auth'

const Register: React.FC = () => {
  const navigate = useNavigate()
  const [formData, setFormData] = useState<RegisterFormData>({
    user_id: '',
    password: '',
    passwordConfirm: '',
    seller_id: '',
    name: '',
    phone_number: '',
    email_address: '',
  })
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    // 비밀번호 확인
    if (formData.password !== formData.passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.')
      setIsLoading(false)
      return
    }

    // 간단한 유효성 검사
    if (formData.password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.')
      setIsLoading(false)
      return
    }

    try {
      const { user_id, password, seller_id, name, phone_number, email_address } = formData
      const { data, error } = await registerUser({
        username: user_id,
        password,
        seller_id,
        name,
        phone_number,
        email_address,
      })

      if (error) {
        if (error.message.includes('duplicate') || error.code === '23505') {
          setError('이미 사용 중인 아이디입니다.')
        } else {
          setError('회원가입 중 오류가 발생했습니다.')
        }
        console.error('Register error:', error)
        setIsLoading(false)
        return
      }

      // 회원가입 성공
      alert('회원가입이 완료되었습니다. 관리자의 승인을 기다려주세요.')
      navigate('/login')
    } catch (err) {
      setError('회원가입 중 오류가 발생했습니다.')
      console.error('Register error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: theme.colors.bgPage,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: theme.radius.xl,
          boxShadow: theme.shadows.lg,
          width: '450px',
          maxWidth: '100%',
        }}
      >
        <h1 style={{ textAlign: 'center', marginBottom: '10px', fontSize: '24px', color: theme.colors.textPrimary }}>
          stock-management
        </h1>
        <h2 style={{ textAlign: 'center', marginBottom: '30px', fontSize: '18px', color: theme.colors.textSecondary }}>
          회원가입
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="user_id"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              아이디 *
            </label>
            <input
              type="text"
              id="user_id"
              name="user_id"
              value={formData.user_id}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="password"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              패스워드 *
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="passwordConfirm"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              패스워드 확인 *
            </label>
            <input
              type="password"
              id="passwordConfirm"
              name="passwordConfirm"
              value={formData.passwordConfirm}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="seller_id"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              사업자ID *
            </label>
            <input
              type="text"
              id="seller_id"
              name="seller_id"
              value={formData.seller_id}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="name"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              이름 *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="phone_number"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              연락처 *
            </label>
            <input
              type="tel"
              id="phone_number"
              name="phone_number"
              value={formData.phone_number}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="email_address"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: theme.colors.textPrimary }}
            >
              메일주소 *
            </label>
            <input
              type="email"
              id="email_address"
              name="email_address"
              value={formData.email_address}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: '20px',
                padding: '10px',
                backgroundColor: theme.colors.dangerLight,
                color: theme.colors.danger,
                borderRadius: theme.radius.md,
                fontSize: '14px',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: theme.colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: theme.radius.md,
              fontWeight: '600',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              marginBottom: '10px',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? '가입 중...' : '회원가입'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: theme.colors.secondary,
              color: 'white',
              border: 'none',
              borderRadius: theme.radius.md,
              fontWeight: '500',
              fontSize: '16px',
              cursor: 'pointer',
            }}
          >
            로그인으로 돌아가기
          </button>
        </form>
      </div>
    </div>
  )
}

export default Register

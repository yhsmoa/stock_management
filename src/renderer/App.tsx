import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Index from './pages/Index'
import Inventory from './pages/Inventory'
import InManagement from './pages/InManagement'
import InOut from './pages/InOut'
import Export from './pages/Export'
import CoupangManagement from './pages/CoupangManagement'

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* 로그인 & 회원가입 (인증 불필요) */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* 보호된 라우트 (인증 필요) */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Index />} />
          <Route path="/coupang" element={<CoupangManagement />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/in-management" element={<InManagement />} />
          <Route path="/inout" element={<InOut />} />
          <Route path="/coupang-return" element={<Export />} />
        </Route>

        {/* 기본 리다이렉트 */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  )
}

export default App

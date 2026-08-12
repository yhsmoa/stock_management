import React from 'react'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Index from './pages/Index'
import Inventory from './pages/Inventory'
import InManagement from './pages/InManagement'
import ShipmentList from './pages/ShipmentList'
import RocketShipment from './pages/RocketShipment'
import Export from './pages/Export'
import CoupangManagement from './pages/CoupangManagement'
import PurchaseManagement from './pages/PurchaseManagement'
import OutboundManagement from './pages/OutboundManagement'
import PersonalOrder from './pages/PersonalOrder'
import ItemInfo from './pages/ItemInfo'
import AnalysisManagement from './pages/AnalysisManagement'
import CustomerInquiry from './pages/CustomerInquiry'
import CoupangInquiry from './pages/CoupangInquiry'

/* ================================================================
   라우터 (react-router v6 데이터 라우터)
   - createBrowserRouter 를 쓰는 이유: 저장되지 않은 변경이 있을 때
     페이지 이탈을 막는 useBlocker(UnsavedChangesGuard)가 데이터 라우터
     에서만 동작한다. 라우트 구성 자체는 기존 <Routes> 트리와 동일하다.
   ================================================================ */
const router = createBrowserRouter([
  // 로그인 & 회원가입 (인증 불필요)
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },

  // 보호된 라우트 (인증 필요)
  {
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <Index /> },
      { path: '/cs/customer-inquiry', element: <CustomerInquiry /> },
      { path: '/cs/coupang-inquiry', element: <CoupangInquiry /> },
      { path: '/coupang', element: <CoupangManagement /> },
      { path: '/personal-order', element: <PersonalOrder /> },
      { path: '/purchase-management', element: <PurchaseManagement /> },
      { path: '/outbound-management', element: <OutboundManagement /> },
      { path: '/analysis-management', element: <AnalysisManagement /> },
      { path: '/item-info', element: <ItemInfo /> },
      { path: '/inventory', element: <Inventory /> },
      { path: '/in-management', element: <InManagement /> },
      { path: '/shipment-list', element: <ShipmentList /> },
      { path: '/rocket-shipment', element: <RocketShipment /> },
      { path: '/coupang-return', element: <Export /> },
    ],
  },

  // 기본 리다이렉트
  { path: '*', element: <Navigate to="/login" replace /> },
])

const App: React.FC = () => <RouterProvider router={router} />

export default App

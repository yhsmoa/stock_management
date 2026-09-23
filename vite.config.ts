import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { coupangProxyPlugin } from './src/server/coupangProxy'
import { qzSignProxyPlugin } from './src/server/qzSignProxy'

// React 애플리케이션용 설정
export default defineConfig({
  plugins: [
    react(),
    coupangProxyPlugin(),
    qzSignProxyPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  base: '/'
})
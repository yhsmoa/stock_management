import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// React 애플리케이션용 설정
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  base: '/'
})
import { contextBridge } from 'electron'

// Electron API를 렌더러 프로세스에 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 필요한 경우 여기에 API 추가
  platform: process.platform,
})

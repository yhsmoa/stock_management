import { spawn } from 'child_process'
import { build } from 'vite'
import electronPath from 'electron'

// Electron 빌드
async function buildElectron() {
  await build({
    configFile: 'electron.vite.config.mjs',
    mode: 'development'
  })
}

// Vite 개발 서버 시작
const viteProcess = spawn('npx', ['vite', '--host'], {
  stdio: 'inherit',
  shell: true
})

// Electron 빌드 후 실행
buildElectron().then(() => {
  setTimeout(() => {
    const electronProcess = spawn(electronPath, ['.'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: 'http://localhost:5173'
      }
    })

    electronProcess.on('close', () => {
      viteProcess.kill()
      process.exit()
    })
  }, 2000)
})

// 프로세스 종료 처리
process.on('SIGINT', () => {
  viteProcess.kill()
  process.exit()
})
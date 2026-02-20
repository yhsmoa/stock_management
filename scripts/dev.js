const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

// 포트가 사용 가능한지 확인하는 함수
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

// 사용 가능한 포트 찾기
async function findAvailablePort(startPort) {
  let port = startPort;
  while (!(await isPortAvailable(port))) {
    console.log(`Port ${port} is in use, trying ${port + 1}...`);
    port++;
  }
  return port;
}

// 서버가 준비되었는지 확인
function waitForServer(url, maxRetries = 20, interval = 500) {
  return new Promise((resolve, reject) => {
    let retries = 0;

    const check = () => {
      fetch(url)
        .then(() => {
          console.log(`Server is ready at ${url}`);
          resolve();
        })
        .catch(() => {
          retries++;
          if (retries >= maxRetries) {
            reject(new Error('Server failed to start'));
          } else {
            setTimeout(check, interval);
          }
        });
    };

    check();
  });
}

async function startDev() {
  console.log('Starting development server...');

  // 사용 가능한 포트 찾기
  const port = await findAvailablePort(5173);
  const serverUrl = `http://localhost:${port}`;

  // Vite 서버 시작
  const vite = spawn('npx', ['vite', '--port', port.toString()], {
    stdio: 'inherit',
    shell: true
  });

  vite.on('error', (err) => {
    console.error('Failed to start Vite:', err);
    process.exit(1);
  });

  // 서버가 준비될 때까지 대기
  try {
    await waitForServer(serverUrl);
    console.log('Launching Electron...');

    // 환경 변수 준비 (ELECTRON_RUN_AS_NODE 제거)
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electronEnv.VITE_DEV_SERVER_URL = serverUrl;

    // Windows에서는 npx를 통해 실행
    console.log('VITE_DEV_SERVER_URL:', serverUrl);

    const electron = spawn('npx', ['electron', '.'], {
      env: electronEnv,
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });

    electron.on('close', (code) => {
      console.log(`Electron exited with code ${code}`);
      vite.kill();
      process.exit(code);
    });

    electron.on('error', (err) => {
      console.error('Failed to start Electron:', err);
      vite.kill();
      process.exit(1);
    });

  } catch (err) {
    console.error('Error:', err.message);
    vite.kill();
    process.exit(1);
  }
}

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  process.exit();
});

// 시작
startDev().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
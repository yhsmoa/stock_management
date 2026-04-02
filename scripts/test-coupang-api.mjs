import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 파일에서 키 읽기
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+?)\s*=\s*(.+)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const ACCESS_KEY = env.COUPANG_ACCESS_KEY;
const SECRET_KEY = env.COUPANG_SECRET_KEY;
const VENDOR_CODE = env.VENDOR_CODE;

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('COUPANG_ACCESS_KEY 또는 COUPANG_SECRET_KEY가 .env에 없습니다.');
  process.exit(1);
}

console.log('ACCESS_KEY:', ACCESS_KEY);
console.log('SECRET_KEY:', SECRET_KEY.slice(0, 8) + '...');

// HMAC-SHA256 서명 생성
function generateAuth(method, apiPath, queryString) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datetime = String(now.getUTCFullYear()).slice(2)
    + pad(now.getUTCMonth() + 1)
    + pad(now.getUTCDate())
    + 'T'
    + pad(now.getUTCHours())
    + pad(now.getUTCMinutes())
    + pad(now.getUTCSeconds())
    + 'Z';

  // 서명 메시지: datetime + method + path + query (? 없이 바로 이어붙임)
  const message = datetime + method + apiPath + (queryString || '');

  console.log('DEBUG signed-date:', datetime);
  console.log('DEBUG message:', message);

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(message)
    .digest('hex');

  const authorization = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;

  return { authorization, datetime };
}

// API 호출
async function callCoupangAPI(method, apiPath, queryParams) {
  const baseUrl = 'https://api-gateway.coupang.com';
  const queryString = queryParams ? new URLSearchParams(queryParams).toString() : '';
  const { authorization } = generateAuth(method, apiPath, queryString);
  const fullUrl = baseUrl + apiPath + (queryString ? '?' + queryString : '');

  console.log('\n--- 요청 정보 ---');
  console.log('URL:', fullUrl);
  console.log('Method:', method);
  console.log('Authorization:', authorization.slice(0, 80) + '...');

  const response = await fetch(fullUrl, {
    method,
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json;charset=UTF-8',
    },
  });

  console.log('\n--- 응답 ---');
  console.log('Status:', response.status, response.statusText);

  const data = await response.json();
  return data;
}

// 로켓그로스 상품 목록 조회 (첫 페이지, 최대 10개)
async function main() {
  try {
    const apiPath = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products';
    const queryParams = {
      vendorId: VENDOR_CODE,
      businessTypes: 'rocketGrowth',
      pageNum: '1',
      pageSize: '10',
    };

    const result = await callCoupangAPI('GET', apiPath, queryParams);

    console.log('\n--- 전체 응답 (JSON) ---');
    console.log(JSON.stringify(result, null, 2));

    if (result.code === 'SUCCESS' && result.data) {
      console.log('\n--- 요약 ---');
      const products = Array.isArray(result.data) ? result.data : [result.data];
      console.log(`총 ${products.length}개 상품 조회됨`);
      for (const p of products.slice(0, 3)) {
        console.log(`  - [${p.sellerProductId}] ${p.sellerProductName || p.displayProductName || 'N/A'}`);
      }
    }
  } catch (err) {
    console.error('API 호출 실패:', err.message);
  }
}

main();

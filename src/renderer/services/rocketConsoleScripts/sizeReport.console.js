/* ===========================================================
 *  쿠팡윙 로켓그로스 입고 - 상품 사이즈 분류 리포트 콘솔
 *  동작: 2단계(입고 정보 입력) 화면의 각 상품에 표시된 사이즈(극소형/소형/중형…)를 읽어서
 *        사이즈별 탭(시트)으로 나눈 .xlsx 파일을 다운로드합니다. (외부 라이브러리 불필요)
 *  시트: [요약] 사이즈별 개수/수량  [전체] @@COUNT@@개 전부  [사이즈명]… 사이즈별  [측정전] 사이즈 측정 안 된 상품  [누락] 화면에 없는 엑셀 상품
 *  사용법: 2단계 화면에서 F12 > Console 에 붙여넣고 Enter → 파일 다운로드
 *  (파일: @@FILE_NAME@@)
 * =========================================================== */
(async () => {
  // ---- 엑셀 No. / 옵션ID / 상품명 / 옵션명 / 입고수량 / 바코드 / 엑셀사이즈 ----
  const EXCEL = [
    /*@@EXCEL_ROWS@@*/
  ];
  const FILE_TAG = @@FILE_TAG@@;

  const vis = el => !!el && el.offsetParent !== null;
  const $v = s => [...document.querySelectorAll(s)].filter(vis);
  const hr = (t, c = 'color:#0a84ff') => console.log(`%c${t}`, c + ';font-weight:bold;font-size:13px');

  /* ---------- 1. 화면에서 사이즈 읽기 ---------- */
  const rows = $v('table.sku-table tbody tr').filter(tr => tr.querySelector('a'));
  if (!rows.length) { alert('2단계(입고 정보 입력) 화면이 아닙니다.'); return; }

  const page = new Map();
  for (const tr of rows) {
    const id = tr.querySelector('a').textContent.trim();
    const cbm = (tr.querySelector('.cbm-revamp')?.innerText || '').replace(/\s+/g, ' ').trim();   // 예: "극소형 - 266*356*47(mm), 170g" / "극소형 - 사이즈 측정전"
    const sizeCls = (tr.querySelector('.cbm-revamp .size')?.childNodes[0]?.textContent || '').trim() || (cbm.split('-')[0] || '').trim();
    const dim = (cbm.match(/(\d+\s*\*\s*\d+\s*\*\s*\d+)\s*\(mm\)/) || [])[1]?.replace(/\s/g, '') || '';
    const wt = (cbm.match(/,\s*([\d.]+)\s*g/) || [])[1] || '';
    const unmeasured = /측정전/.test(cbm) || (!dim && !wt);
    const qty = tr.querySelector('input[type=number]')?.value ?? tr.querySelector('.col-quantity__readonly-value')?.textContent.trim() ?? '';
    const barcode = [...tr.querySelectorAll('.tag-value')].map(e => e.textContent.trim()).find(t => /^S\d{6,}$/.test(t)) || '';
    const name = tr.querySelector('.col-sku div')?.textContent.trim() || '';
    page.set(id, { id, name, sizeCls, cbm, dim, wt, unmeasured, qty, barcode });
  }

  /* ---------- 2. 엑셀과 결합 ---------- */
  const HEAD = ['No.', '옵션 ID', '등록상품명', '옵션명', '윙 사이즈', '측정 상태', '가로*세로*높이(mm)', '무게(g)', '윙 표시 원문', '입고수량(화면)', '입고수량(엑셀)', '엑셀 사이즈', '바코드(엑셀)', '바코드(윙)', '비고'];
  const all = [], missing = [];
  for (const [no, id, name, opt, qty, bc, exSize] of EXCEL) {
    const p = page.get(id);
    if (!p) { missing.push([no, id, name, opt, '', '', '', '', '', '', qty, exSize, bc, '', '화면에 없음']); continue; }
    const notes = [];
    if (p.unmeasured) notes.push('사이즈 측정전');
    if (String(p.qty) !== String(qty)) notes.push(`수량 다름(화면 ${p.qty} / 엑셀 ${qty})`);
    if (p.barcode && bc && p.barcode !== bc) notes.push('바코드 다름');
    all.push([no, id, name, opt, p.sizeCls || '(없음)', p.unmeasured ? '측정전' : '측정완료', p.dim, p.wt, p.cbm, p.qty, qty, exSize, bc, p.barcode, notes.join(', ')]);
  }
  const extra = [...page.values()].filter(p => !EXCEL.some(r => r[1] === p.id))
    .map(p => ['', p.id, p.name, '', p.sizeCls, p.unmeasured ? '측정전' : '측정완료', p.dim, p.wt, p.cbm, p.qty, '', '', '', p.barcode, '엑셀에 없음(화면에만 있음)']);

  // 사이즈별 그룹 (측정전은 별도 탭)
  const SIZE_ORDER = ['극소형', '소형', '중형', '대형', '특대형', '이형'];
  const groups = new Map();
  for (const r of all) {
    const key = r[5] === '측정전' ? '측정전' : (r[4] || '(없음)');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
    if (a === '측정전') return 1; if (b === '측정전') return -1;
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  // 요약
  const summary = [['윙 사이즈', '상품 수', '입고수량 합계(화면)', '입고수량 합계(엑셀)']];
  for (const k of groupKeys) {
    const g = groups.get(k);
    summary.push([k, g.length, g.reduce((s, r) => s + (parseInt(r[9]) || 0), 0), g.reduce((s, r) => s + (parseInt(r[10]) || 0), 0)]);
  }
  summary.push(['합계', all.length, all.reduce((s, r) => s + (parseInt(r[9]) || 0), 0), all.reduce((s, r) => s + (parseInt(r[10]) || 0), 0)]);
  if (missing.length) summary.push(['(화면에 없음)', missing.length, '', missing.reduce((s, r) => s + (parseInt(r[10]) || 0), 0)]);
  if (extra.length) summary.push(['(엑셀에 없음)', extra.length, extra.reduce((s, r) => s + (parseInt(r[9]) || 0), 0), '']);

  /* ---------- 3. 콘솔 출력 ---------- */
  hr(`사이즈 분류 결과 — 화면 ${rows.length}개 / 엑셀 ${EXCEL.length}개`);
  console.table(summary.slice(1).map(r => ({ '윙 사이즈': r[0], '상품 수': r[1], '수량합계(화면)': r[2], '수량합계(엑셀)': r[3] })));
  for (const k of groupKeys) {
    if (k === groupKeys[0] && groups.get(k).length > 10) continue; // 가장 큰 그룹은 파일에서 확인
    console.log(`%c[${k}] ${groups.get(k).length}개`, 'font-weight:bold');
    console.table(groups.get(k).map(r => ({ No: r[0], 옵션ID: r[1], 상품명: r[2], 옵션: r[3], 사이즈: r[4], 규격: r[6] ? `${r[6]}mm ${r[7]}g` : r[8], 수량: r[9] })));
  }
  if (missing.length) console.warn(`화면에 없는 엑셀 상품 ${missing.length}개:`, missing.map(r => `No.${r[0]} ${r[1]}`));
  if (extra.length) console.warn(`엑셀에 없는 화면 상품 ${extra.length}개:`, extra.map(r => r[1]));

  /* ---------- 4. .xlsx 생성 (외부 라이브러리 없이) ---------- */
  const sheets = [['요약', summary], ['전체', [HEAD, ...all]]];
  for (const k of groupKeys) sheets.push([k, [HEAD, ...groups.get(k)]]);
  if (missing.length) sheets.push(['누락(화면에없음)', [HEAD, ...missing]]);
  if (extra.length) sheets.push(['엑셀외(화면에만)', [HEAD, ...extra]]);

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colRef = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const sheetXml = (rows) => {
    const widths = rows[0].map((_, c) => Math.min(60, Math.max(8, ...rows.map(r => String(r[c] ?? '').length * 1.6 + 2))));
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>';
    widths.forEach((w, i) => x += `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`);
    x += '</cols><sheetData>';
    rows.forEach((r, ri) => {
      x += `<row r="${ri + 1}">`;
      r.forEach((v, ci) => {
        const ref = colRef(ci) + (ri + 1);
        const st = ri === 0 ? ' s="1"' : '';
        if (v === '' || v == null) return;
        // 옵션ID/바코드는 문자열 유지 (지수표기 방지). 그 외 숫자는 숫자로.
        if (typeof v === 'number' || (/^\d+$/.test(String(v)) && String(v).length < 10 && ![1, 12, 13].includes(ci))) x += `<c r="${ref}"${st}><v>${v}</v></c>`;
        else x += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
      x += '</row>';
    });
    x += `</sheetData><autoFilter ref="A1:${colRef(rows[0].length - 1)}${rows.length}"/></worksheet>`;
    return x;
  };
  const safeName = n => n.replace(/[\\/?*\[\]:]/g, '_').slice(0, 31);
  const files = {};
  files['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>';
  files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  files['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map(([n], i) => `<sheet name="${esc(safeName(n))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
  files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
  sheets.forEach(([, rows], i) => files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(rows));

  // ZIP (무압축 store) — CRC32
  const CRC = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c; }
  const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const enc = new TextEncoder();
  const parts = [], central = []; let offset = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, content] of Object.entries(files)) {
    const nb = enc.encode(name), cb = enc.encode(content), crc = crc32(cb);
    const local = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(cb.length), ...u32(cb.length), ...u16(nb.length), ...u16(0), ...nb]);
    parts.push(local, cb);
    central.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(cb.length), ...u32(cb.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nb]));
    offset += local.length + cb.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const blob = new Blob([...parts, ...central, eocd], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  /* ---------- 5. 다운로드 ---------- */
  const fname = `${FILE_TAG} - 사이즈분류.xlsx`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  hr(`✅ "${fname}" 다운로드 — 시트: ${sheets.map(s => s[0]).join(' / ')}`, 'color:green');
})();

/* ===========================================================
 *  쿠팡윙 로켓그로스 입고 - 2단계 "입고 정보 입력" 콘솔
 *  동작:  ① 엑셀 @@COUNT@@개 상품이 화면에 전부 추가됐는지 검사
 *         ② 누락/엑셀외/중복 상품이 하나라도 있으면 → 목록 출력 + 알림창 → 정지 (아무것도 입력 안 함)
 *         ③ 전부 정상이면 → 수량 입력 → 입력 결과 재검증
 *  사용법: 입고 생성하기 > 2. 입고 정보 입력 화면에서 F12 > Console 에 붙여넣고 Enter
 *  (파일: @@FILE_NAME@@)
 * =========================================================== */
(async () => {
  // ---- 엑셀 No. / 옵션ID / 상품명 / 옵션명 / 입고수량 ----
  const EXCEL = [
    /*@@EXCEL_ROWS@@*/
  ];
  const TOTAL_QTY = EXCEL.reduce((s, r) => s + r[4], 0);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = el => !!el && el.offsetParent !== null;
  const $v = s => [...document.querySelectorAll(s)].filter(vis);
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const hr = (t, c = 'color:#0a84ff') => console.log(`%c${t}`, c + ';font-weight:bold;font-size:13px');

  if (!$v('table.sku-table').length) {
    alert('2단계(입고 정보 입력) 화면이 아닙니다.\n상품 선택 후 "다음"을 눌러 2단계 화면에서 실행하세요.');
    console.error('2단계(입고 정보 입력) 화면이 아닙니다.');
    return;
  }

  /* ===================== ① 추가 여부 검사 ===================== */
  hr('① 상품 추가 여부 검사 (엑셀 @@COUNT@@개 ↔ 화면)');
  const rows = $v('table.sku-table tbody tr').filter(tr => tr.querySelector('a') && tr.querySelector('input[type=number]'));
  const pageIds = rows.map(tr => tr.querySelector('a').textContent.trim());
  const page = new Map(rows.map((tr, i) => [pageIds[i], tr]));
  const excelIds = new Set(EXCEL.map(r => r[1]));

  const missing = EXCEL.filter(r => !page.has(r[1]));                       // 엑셀에 있는데 화면에 없음
  const extra   = pageIds.filter(id => !excelIds.has(id))                   // 화면에 있는데 엑셀에 없음
                    .map(id => `${id} :: ${page.get(id).innerText.replace(/\s+/g, ' ').slice(0, 60)}`);
  const dup     = [...new Set(pageIds.filter((v, i, a) => a.indexOf(v) !== i))]; // 중복

  console.log(`엑셀 ${EXCEL.length}개 / 화면 ${rows.length}개  →  누락 ${missing.length}, 엑셀외 ${extra.length}, 중복 ${dup.length}`);

  if (missing.length || extra.length || dup.length) {
    hr('❌ 검사 실패 — 입력을 진행하지 않고 정지합니다', 'color:red');
    if (missing.length) {
      console.warn(`[누락] 엑셀에 있는데 화면에 추가되지 않은 상품 ${missing.length}개:`);
      console.table(missing.map(([no, id, name, opt, qty]) => ({ No: no, 옵션ID: id, 상품명: name, 옵션: opt, 수량: qty })));
      console.log('누락 옵션ID (1단계 검색창에 그대로 붙여넣기용):\n' + missing.map(r => r[1]).join(','));
    }
    if (extra.length) { console.warn(`[엑셀외] 화면에만 있는 상품 ${extra.length}개 (잘못 선택됨):`); extra.forEach(e => console.warn('   ' + e)); }
    if (dup.length)   { console.warn(`[중복] 옵션ID ${dup.length}개:`, dup); }

    const msg = [
      '❌ 상품 추가 검사 실패 — 수량 입력을 진행하지 않았습니다.',
      `엑셀 ${EXCEL.length}개 / 화면 ${rows.length}개`,
      missing.length ? `\n[누락 ${missing.length}개]\n` + missing.map(r => `No.${r[0]} ${r[1]} ${r[2]} / ${r[3]}`).join('\n') : '',
      extra.length   ? `\n[엑셀에 없는 상품 ${extra.length}개]\n` + extra.join('\n') : '',
      dup.length     ? `\n[중복 ${dup.length}개]\n` + dup.join('\n') : '',
      '\n"이전"으로 돌아가 1단계에서 수정한 뒤 다시 실행하세요. (콘솔에 상세 표 있음)',
    ].filter(Boolean).join('\n');
    alert(msg);
    return;
  }

  hr(`✅ 검사 통과 — ${EXCEL.length}개 모두 정확히 추가됨. 수량 입력을 시작합니다.`, 'color:green');

  /* ===================== ② 수량 입력 ===================== */
  const failed = [];
  for (const [no, id, name, opt, qty] of EXCEL) {
    const inp = page.get(id).querySelector('input[type=number]');
    for (let attempt = 0; attempt < 3; attempt++) {
      setVal.call(inp, String(qty));
      for (const t of ['input', 'change', 'blur']) inp.dispatchEvent(new Event(t, { bubbles: true }));
      await sleep(attempt ? 300 : 80);
      if (inp.value === String(qty)) break;
    }
    if (inp.value !== String(qty)) failed.push(`No.${no} ${id} (엑셀 ${qty} / 현재 "${inp.value}")`);
  }

  /* ===================== ③ 입력 결과 재검증 ===================== */
  await sleep(800);
  hr('③ 입력 결과 재검증');
  const report = EXCEL.map(([no, id, name, opt, qty]) => {
    const tr = page.get(id);
    const cur = tr.querySelector('input[type=number]').value;
    const err = /1개 이상의 수량|수량을 입력/.test(tr.innerText);
    return { No: no, 옵션ID: id, 상품명: name.slice(0, 30), 옵션: opt, 엑셀수량: qty, 입력값: cur,
             상태: cur === String(qty) && !err ? '✅' : (cur !== String(qty) ? '❌ 불일치' : '❌ 오류표시') };
  });
  const bad = report.filter(r => r.상태 !== '✅');
  const pageSum = rows.reduce((s, tr) => s + (parseInt(tr.querySelector('input[type=number]').value) || 0), 0);
  console.table(report);
  console.log(`입력 일치 ${report.length - bad.length}/${EXCEL.length}  |  화면 총수량 ${pageSum} / 엑셀 총수량 ${TOTAL_QTY}`);

  if (bad.length || pageSum !== TOTAL_QTY) {
    hr('❌ 수량 입력 검증 실패', 'color:red');
    bad.forEach(r => console.warn(`   No.${r.No} ${r.옵션ID} ${r.상태} (엑셀 ${r.엑셀수량} / 입력 "${r.입력값}")`));
    alert(`❌ 수량 입력 검증 실패 ${bad.length}건\n` + bad.map(r => `No.${r.No} ${r.옵션ID}: 엑셀 ${r.엑셀수량} / 입력 "${r.입력값}"`).join('\n') + '\n\n"다음"을 누르지 마세요. 콘솔을 확인하세요.');
  } else {
    hr(`✅ 완료 — ${EXCEL.length}개 수량 모두 엑셀과 일치 (총 ${TOTAL_QTY}개). "다음"으로 진행하세요.`, 'color:green');
    alert(`✅ 완료\n${EXCEL.length}개 상품 수량이 엑셀과 모두 일치합니다. (총 ${TOTAL_QTY}개)\n화면을 한 번 훑어본 뒤 "다음"을 눌러주세요.`);
  }
})();

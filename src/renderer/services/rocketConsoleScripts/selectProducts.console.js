/* ===========================================================
 *  쿠팡윙 로켓그로스 입고 - 1단계 "상품 선택" 자동화 콘솔
 *  사용법: 입고 생성하기 > 1. 상품 선택 화면에서 F12 > Console 탭에 붙여넣고 Enter
 *  (파일: @@FILE_NAME@@ / 옵션ID @@COUNT@@개)
 * =========================================================== */
(async () => {
  // ---- 엑셀 "옵션 ID" 컬럼 ----
  const OPTION_IDS = [
    /*@@OPTION_IDS@@*/
  ];

  const BATCH = 20;          // 한 번에 검색할 옵션ID 수
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $all = s => [...document.querySelectorAll(s)];
  const footer = () => $all('button').find(b => b.innerText.startsWith('선택 상품'))?.innerText.replace(/\s+/g, ' ');
  const expandBtn = () => $all('button').find(b => /전체 옵션/.test(b.innerText));

  async function search(ids) {
    const sel = document.querySelector('select.search-type-select');
    if (sel.value !== 'vendorItemIds') { sel.value = 'vendorItemIds'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300); }
    const inp = document.querySelector('input.search-text-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ids.join(','));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    for (const t of ['keydown', 'keyup']) inp.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(3000);
  }

  async function expandAll() {
    // 검색 후엔 버튼이 "닫기" 상태로 남아있어도 실제론 접혀있으므로 닫기→보기 순서로 토글
    if (/닫기/.test(expandBtn()?.innerText)) { expandBtn().click(); await sleep(700); }
    expandBtn()?.click();
    await sleep(2500);
  }

  const result = { selected: [], already: [], notFound: [], disabled: [] };

  for (let i = 0; i < OPTION_IDS.length; i += BATCH) {
    const batch = OPTION_IDS.slice(i, i + BATCH);
    console.log(`%c[${i / BATCH + 1}/${Math.ceil(OPTION_IDS.length / BATCH)}] 검색 중... (${batch.length}개)`, 'color:#0a84ff');
    await search(batch);
    await expandAll();

    for (const id of batch) {
      const row = $all('.option-item').find(o => o.querySelector('.option-id')?.textContent.trim() === id);
      if (!row) { result.notFound.push(id); continue; }
      let cb = row.querySelector('input[type=checkbox]');
      // "입고 가능 확인 중..." 이면 최대 10초 대기
      for (let t = 0; t < 20 && cb.disabled; t++) { await sleep(500); cb = row.querySelector('input[type=checkbox]'); }
      if (cb.disabled) { result.disabled.push(id + ' :: ' + row.innerText.replace(/\s+/g, ' ').slice(0, 80)); continue; }
      if (cb.checked) { result.already.push(id); continue; }
      cb.click();
      await sleep(150);
      (cb.checked ? result.selected : result.disabled).push(id);
    }
    console.log(`  → 현재 ${footer()}`);
  }

  console.log('%c===== 완료 =====', 'color:green;font-weight:bold');
  console.log(`새로 선택: ${result.selected.length}개`, result.selected);
  console.log(`이미 선택됨: ${result.already.length}개`, result.already);
  if (result.notFound.length) console.warn(`검색 결과 없음: ${result.notFound.length}개`, result.notFound);
  if (result.disabled.length) console.warn(`선택 불가(입고불가/확인중): ${result.disabled.length}개`, result.disabled);
  console.log(`%c하단 ${footer()} → 확인 후 "다음" 버튼을 눌러주세요.`, 'font-weight:bold');
})();

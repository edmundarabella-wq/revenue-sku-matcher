const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const XLSX = require('../vendor/shipping/xlsx.full.min.js');
const artifacts = path.join(__dirname, 'artifacts');
const target = process.env.TOOLBOX_TEST_URL || pathToFileURL(path.join(__dirname, '../docs/index.html')).href;
const browserOptions = process.env.TOOL_BROWSER_EXECUTABLE ? { executablePath: process.env.TOOL_BROWSER_EXECUTABLE } : {};

function file(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [label, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), label);
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })) };
}
function grid(wb, name = wb.SheetNames[0]) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true });
}
async function download(page, button) {
  const [result] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), button.click()]);
  return XLSX.read(fs.readFileSync(await result.path()), { type: 'buffer' });
}
(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...browserOptions });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  if (target.startsWith('https:')) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(target).origin });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !(request.method() === 'GET' && request.url() === target)) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(target);
    const select = view => page.locator('[data-view="' + view + '"]').click();
    const frame = page.frameLocator('#shipping-frame');
    const get = id => frame.locator('#' + id);
    assert.equal(await page.locator('#shipping-frame').getAttribute('srcdoc'), null);
    await select('packing');
    await get('packingDrop').waitFor({ timeout: 12000 });
    const packingRows = [
      ['序号','SKU','品名','发货数量','已装箱数','第1箱','第2箱'],
      [1,'DEMO-A','示例甲',17,4,4,0], [2,'DEMO-B','示例乙',172,0,0,0],
      [3,'DEMO-C','',2,0,0,0], ['合计','','',191]
    ];
    await get('packingFile').setInputFiles(file('packing-demo.xlsx', [['装箱模板',packingRows],['保留页',[['标识','不变']]]]));
    await frame.getByText('已读取 3 行 SKU，共 191 双。', { exact: true }).waitFor();
    assert.equal(await get('packingBoxes').textContent(), '10');
    assert.equal(await get('packingLast').textContent(), '11');
    const lingxing = await download(page, get('packingExport')), rows = grid(lingxing);
    assert.deepEqual(lingxing.SheetNames, ['装箱模板','保留页']);
    assert.equal(rows[0][14], '第10箱');
    assert.deepEqual(rows.slice(1,4).map(r => r[4]), [17,172,2]);
    assert.deepEqual(rows.slice(1,4).map(r => r[5]), [17,3,'']);
    assert.deepEqual(rows.slice(1,4).map(r => r[14]), ['',9,2]);
    assert.equal(rows[4][3], 191);
    assert.deepEqual(grid(lingxing, '保留页'), [['标识','不变']]);
    const factory = grid(await download(page, get('packingFactory')));
    assert.deepEqual(factory[0].slice(0,4), ['品名','发货数量','B1','B2']);
    assert.deepEqual(factory[3].slice(0,3), ['品名','发货数量','B10']);
    assert.deepEqual([factory[1][1],factory[2][1],factory[4][1],factory[5][1],factory[6][1]], [17,163,9,2,191]);
    assert.equal(factory[5][0], 'DEMO-C');
    await get('packingCapacity').fill('0');
    assert.equal(await get('packingExport').isDisabled(), true);
    await get('packingCapacity').fill('20');
    await page.screenshot({ path: path.join(artifacts, 'packing-desktop.png') });

    await select('shipping');
    await get('supplyFile').setInputFiles(file('supply-demo.xlsx', [['明细',[['货号','数量'],['DEMO-X',2],['DEMO-Y',1]]],['其他',[['无关']]]]));
    await get('sheetDialog').waitFor();
    await get('sheetSelect').selectOption('明细');
    await get('applySheet').click();
    await get('nextOrders').click();
    const longId = '0'.repeat(6) + '123456789012';
    await get('focusOrders').click();
    await get('ordersPasteText').fill(['订单编号\t采购货号', longId+'\tDEMO-X', '\t', 'DEMO-2\tDEMO-X', 'DEMO-3\tDEMO-X'].join('\n'));
    await get('applyOrdersPaste').click();
    await get('runMatch').click();
    await get('resultBody').waitFor();
    assert.equal(await get('statTotal').textContent(), '3');
    assert.equal(await get('statMatched').textContent(), '2');
    assert.equal(await get('statUnmatched').textContent(), '1');
    const output = await download(page, get('exportAll'));
    const orderRows = grid(output, '采购匹配结果');
    assert.deepEqual(orderRows.slice(1).map(r => r[0]), [longId,'','DEMO-2','DEMO-3']);
    assert.match(orderRows[1][2], /^\d{4}\/\d{2}\/\d{2}$/);
    assert.deepEqual(orderRows.slice(1).map(r => r[4]), [1,'',1,0]);
    assert.equal(orderRows[4][2], '');
    await get('copyAllC').click();
    await frame.getByText(/已按原序复制全部 C 列/).waitFor();
    if (target.startsWith('https:')) {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied.replace(/\r/g,''), ['回填值',orderRows[1][2],'',orderRows[3][2],''].join('\n'));
    }
    await get('viewInventory').click();
    assert.equal(grid(await download(page, get('exportCurrent'))).length, 3);
    await select('packing');
    assert.equal(await get('packingTotal').textContent(), '191');
    await select('metadata');
    await select('shipping');
    assert.equal(await get('statMatched').textContent(), '2');
    await page.screenshot({ path: path.join(artifacts, 'shipping-desktop.png') });
    for (const width of [768,390,320]) {
      await page.setViewportSize({ width, height: 850 });
      for (const view of ['shipping','packing']) {
        await select(view);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'toolbox overflow at ' + width);
        assert.equal(await page.locator('#shipping-frame').evaluate(f => f.contentDocument.documentElement.scrollWidth > f.clientWidth), false, view + ' overflow at ' + width);
        await page.screenshot({ path: path.join(artifacts, view+'-'+width+'.png') });
      }
    }
    await get('packingReset').click();
    assert.equal(await get('packingExport').isDisabled(), true);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log('PASS: packing workbook and factory groups, shipping import and matching, clipboard, downloads, tab state, responsive layout and no network requests.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

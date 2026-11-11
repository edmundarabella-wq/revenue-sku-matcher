const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseOrders, parseText, match} = require('../src/shipping/core.js');

test('preserves existing values and allocates only to later blank C rows', () => {
  const input = parseText('订单编号\t商品中文名称\t出货日期\nDEMO-OLD_1\tDEMO-A\t2026/11/10\nDEMO-NEW\tDEMO-A\t\n\t\t\nDEMO-NEXT\tDEMO-A\t');
  const orders = parseOrders(input);
  assert.deepEqual(orders.errors, []);
  const result = match([{sku:'DEMO-A',qty:1}],orders.records,'date','2026/11/11');
  assert.deepEqual(result.rows.map(r=>r.value), ['2026/11/10','2026/11/11','','']);
  assert.deepEqual([result.matched,result.skipped,result.unmatched,result.left], [1,1,1,0]);
  assert.deepEqual(result.rows.map(r=>r.sourceRow), [1,2,3,4]);
});

test('does not alter text in C, including zero or non-date values', () => {
  const orders = parseOrders([['DEMO-1','DEMO-A',' 2026-11-10 '],['DEMO-2','DEMO-A',0],['DEMO-3','DEMO-A','确认出货'],['DEMO-4','DEMO-A']]);
  const result = match([{sku:'DEMO-A',qty:2}],orders.records,'one');
  assert.deepEqual(result.rows.map(r=>r.value), [' 2026-11-10 ','0','确认出货',1]);
  assert.deepEqual([result.matched,result.skipped,result.unmatched,result.left], [1,3,0,1]);
});

test('keeps two-column inputs and the original validation for unshipped orders', () => {
  assert.equal(parseOrders([['订单编号','采购货号'],['DEMO','DEMO-A']]).records[0].shipDate,'');
  assert.equal(parseOrders([['1e+17','DEMO-A','']]).errors.length,1);
  assert.equal(parseOrders([['DEMO','','']]).errors.length,1);
});

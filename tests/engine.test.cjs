const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const r = (row, order, asin, amount, activity = 'SALES') => ({row, order, asin, amount, activity, kind: E.kind(activity), account: 'ACC', market: 'amazon.com', currency: 'USD', originalSku: ''});
const b = (row, order, sku, gross, qty = 1, type = 'Order') => ({row, order, sku, gross, qty, kind: E.kind(type), market: 'amazon.com', valid: true});
const run = (revenue, backend, mappings = [], overrides = []) => E.match({revenue, backend}, mappings, overrides);
test('unique amount mismatch does not block identity', async () => {
  const x = await run([r(2,'O','A',-34.41,'RETURNS')],[b(10,'O','S',-35.41,1,'Refund')]);
  assert.equal(x.results[0].sku,'S'); assert.equal(x.results[0].difference,1);
});
test('equal-price different SKU is not guessed', async () => {
  const x = await run([r(2,'O','A',10)], [b(10,'O','S1',10),b(11,'O','S2',10)]);
  assert.equal(x.stats.review,1);
});
test('explicit catalog resolves equal prices', async () => {
  const x = await run([r(2,'O','A',10)], [b(10,'O','S1',10),b(11,'O','S2',10)], [{account:'ACC',market:'amazon.com',asin:'A',sku:'S2'}]);
  assert.equal(x.results[0].sku,'S2');
});
test('multiple exact learned SKUs retain identity intersection', async () => {
  const x = await run([r(2,'seed1','A',10),r(3,'seed2','A',10),r(4,'O','A',10)],
    [b(10,'seed1','ALIAS1',10),b(11,'seed2','ALIAS2',10),b(12,'O','ALIAS1',10),b(13,'O','OTHER',10)]);
  assert.equal(x.results[2].sku,'ALIAS1');
});
test('identity aliases present together stay ambiguous', async () => {
  const x = await run([r(2,'seed1','A',10),r(3,'seed2','A',10),r(4,'O','A',10)],
    [b(10,'seed1','ALIAS1',10),b(11,'seed2','ALIAS2',10),b(12,'O','ALIAS1',10),b(13,'O','ALIAS2',10)]);
  assert.equal(x.results[2].status,'review');
});
test('same-SKU two rows aggregate quantity', async () => {
  const x = await run([r(2,'O','A',66.1)], [b(10,'O','S',33.05),b(11,'O','S',33.05)]);
  assert.equal(x.results[0].qty,2); assert.equal(x.results[0].refs.length,2);
});
test('combined backend quantity split without reuse', async () => {
  const x = await run([r(2,'O','A',10),r(3,'O','A',10),r(4,'O','A',10)], [b(10,'O','S',20,2)]);
  assert.equal(x.stats.matched,2); assert.equal(x.stats.review,1); assert.equal(x.results[0].qty,1);
});
test('zero is a valid transaction', async () => {
  const x = await run([r(2,'O','A',0)], [b(10,'O','S',0)]);
  assert.equal(x.results[0].sku,'S'); assert.equal(x.results[0].qty,1);
});
test('refund cannot match sale', async () => {
  const x = await run([r(2,'O','A',-10,'RETURNS')], [b(10,'O','S',10)]); assert.equal(x.stats.review,1);
});
test('marketplace isolates candidates', async () => {
  const backend=b(10,'O','S',10);backend.market='amazon.ca';const x=await run([r(2,'O','A',10)],[backend]);assert.equal(x.stats.review,1);
});
test('ASIN evidence resolves two refund amount differences independently', async () => {
  const x = await run([r(2,'seed1','A',10),r(3,'seed2','B',10),r(4,'O','A',-8,'RETURNS'),r(5,'O','B',-7,'RETURNS')],
    [b(10,'seed1','S1',10),b(11,'seed2','S2',10),b(12,'O','S1',-10,1,'Refund'),b(13,'O','S2',-10,1,'Refund')]);
  assert.equal(x.results[2].sku,'S1'); assert.equal(x.results[3].sku,'S2');
});
test('invalid backend data does not silently become zero', async () => {
  const backend=b(10,'O','S',10);backend.valid=false;const x=await run([r(2,'O','A',10)],[backend]);assert.equal(x.stats.review,1);
});
test('manual sources reserve capacity before automatic rows', async () => {
  const x=await run([r(2,'O','A',10),r(3,'O','B',10)],[b(10,'O','S1',10),b(11,'O','S2',10)],[],[{row:3,allocations:[{row:10,qty:1}],note:'verified'}]);
  assert.equal(x.results[1].status,'manual'); assert.equal(x.results[0].sku,'S2');
});
test('manual duplicate source consumption rejected', async () => {
  await assert.rejects(run([r(2,'O','A',10),r(3,'O','B',10)],[b(10,'O','S',10)],[],
    [{row:2,allocations:[{row:10,qty:1}]},{row:3,allocations:[{row:10,qty:1}]}]),/已被其他记录占用/);
});
test('manual cross-type or mixed-SKU corrections rejected', async () => {
  await assert.rejects(run([r(2,'O','A',10)],[b(10,'O','S1',-10,1,'Refund')],[],[{row:2,allocations:[{row:10,qty:1}]}]),/不属于/);
  await assert.rejects(run([r(2,'O','A',20)],[b(10,'O','S1',10),b(11,'O','S2',10)],[],[{row:2,allocations:[{row:10,qty:1},{row:11,qty:1}]}]),/不同SKU/);
});
test('confirmed account mapping does not leak across accounts', async () => {
  const x=await run([r(2,'O','A',10)],[b(10,'O','S1',10),b(11,'O','S2',10)],[{account:'OTHER',market:'amazon.com',asin:'A',sku:'S2'}]); assert.equal(x.stats.review,1);
});
test('confirmed contradictory mapping does not fall back to order-only', async () => {
  const x=await run([r(2,'O','A',10)],[b(10,'O','S1',10)],[{account:'ACC',market:'amazon.com',asin:'A',sku:'WRONG'}]); assert.equal(x.stats.review,1);
});
test('cancellation leaves no partial success', async () => {
  await assert.rejects(E.match({revenue:[r(2,'O','A',10)],backend:[b(10,'O','S',10)]},[],[],()=>{}, {aborted:true}),/已取消/);
});
test('numeric validation distinguishes blank, invalid and zero', () => {
  assert.equal(E.number(''),null); assert.equal(E.number('1,23'),null);assert.equal(E.number(false),null);assert.equal(E.number(0),0);
});

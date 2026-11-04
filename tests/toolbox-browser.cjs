const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const JSZip = require('../vendor/jszip.min.js');
const root = path.resolve(__dirname, '..'), artifacts = path.join(__dirname, 'artifacts');
const target = process.env.TOOLBOX_TEST_URL || pathToFileURL(path.join(root, 'docs/index.html')).href;
const crcTable = Uint32Array.from({length: 256}, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c >>> 1 ^ ((c & 1) ? 0xedb88320 : 0); return c >>> 0; });
function crc(bytes) { let c = 0xffffffff; for (const b of bytes) c = c >>> 8 ^ crcTable[(c ^ b) & 255]; return (c ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out; }
function withoutXmp(bytes, format) {
  if (format === 'png') {
    const parts = [bytes.subarray(0, 8)]; let offset = 8;
    while (offset + 12 <= bytes.length) { const end = offset + 12 + bytes.readUInt32BE(offset); if (!(bytes.toString('ascii', offset + 4, offset + 8) === 'iTXt' && bytes.toString('utf8', offset + 8, end - 4).startsWith('XML:com.adobe.xmp\0'))) parts.push(bytes.subarray(offset, end)); offset = end; }
    return Buffer.concat(parts);
  }
  const parts = [bytes.subarray(0, 2)]; let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset + 1] === 218) { parts.push(bytes.subarray(offset)); break; }
    const end = offset + 2 + bytes.readUInt16BE(offset + 2);
    if (!(bytes[offset + 1] === 225 && bytes.toString('utf8', offset + 4, offset + 33) === 'http://ns.adobe.com/xap/1.0/\0')) parts.push(bytes.subarray(offset, end)); offset = end;
  }
  return Buffer.concat(parts);
}
(async () => {
  fs.mkdirSync(artifacts, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.TOOL_BROWSER_EXECUTABLE ? {executablePath: process.env.TOOL_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1450, height: 940}, acceptDownloads: true});
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !(request.url() === target && request.method() === 'GET')) unexpected.push([request.method(), request.url()]); });
  try {
    await page.goto(target); await page.waitForFunction(() => window.SkuApp && window.ImageTool);
    const fixtures = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#edf2f3'; ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = '#256d65'; ctx.fillRect(30, 40, 150, 70); ctx.fillStyle = '#d89c45'; ctx.fillRect(145, 70, 65, 45);
      return {png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1]};
    });
    let checks = 0;
    const apply = source => page.evaluate(values => { const result = ImageMetadata.applyTag(new Uint8Array(values)); return {...result, bytes: Array.from(result.bytes)}; }, [...source]);
    const outputs = {};
    for (const format of ['png', 'jpeg']) {
      const original = Buffer.from(fixtures[format], 'base64'), result = await apply(original), output = Buffer.from(result.bytes); outputs[format] = output;
      assert.equal(result.format, format); assert.equal(result.alreadyTagged, false);
      assert.deepEqual(withoutXmp(output, format), original, format + ' image payload changed');
      assert.equal(await page.evaluate(values => ImageMetadata.hasTag(new Uint8Array(values)), [...output]), true);
      const repeated = await apply(output); assert.equal(repeated.alreadyTagged, true); assert.deepEqual(Buffer.from(repeated.bytes), output);
      const samePixels = await page.evaluate(async ({before, after}) => {
        async function pixels(values) { const bitmap = await createImageBitmap(new Blob([new Uint8Array(values)])); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data); }
        return JSON.stringify(await pixels(before)) === JSON.stringify(await pixels(after));
      }, {before: [...original], after: [...output]}); assert.equal(samePixels, true); checks += 5;
    }
    // Alternate prefixes and pre-existing metadata must survive an update.
    const xml = '<m:xmpmeta xmlns:m="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description xmlns:d="http://purl.org/dc/elements/1.1/"><d:subject><r:Bag><r:li>contains-synthetic-performer-extra</r:li><r:li>original-keyword</r:li></r:Bag></d:subject><d:creator>Original creator</d:creator></r:Description></r:RDF></m:xmpmeta>';
    const png = Buffer.from(fixtures.png, 'base64');
    const existing = Buffer.concat([png.subarray(0, -12), chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0' + xml)), png.subarray(-12)]);
    assert.equal(await page.evaluate(v => ImageMetadata.hasTag(new Uint8Array(v)), [...existing]), false);
    const updated = Buffer.from((await apply(existing)).bytes);
    assert(updated.includes(Buffer.from('Original creator'))); assert(updated.includes(Buffer.from('original-keyword')));
    assert.deepEqual(withoutXmp(updated, 'png'), png); checks += 4;
    const damaged = Buffer.from(png); damaged[45] ^= 1;
    for (const bytes of [damaged, Buffer.from([255, 216, 255]), Buffer.from('not an image')]) {
      const message = await page.evaluate(v => { try { ImageMetadata.applyTag(new Uint8Array(v)); return ''; } catch (e) { return e.message; } }, [...bytes]); assert(message); checks++;
    }
    await page.locator('[data-view="metadata"]').click();
    await page.screenshot({path: path.join(artifacts, 'toolbox-image-empty.png'), fullPage: true});
    const files = [{name: 'product.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtures.jpeg, 'base64')}, {name: 'product.jpeg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtures.jpeg, 'base64')}, {name: 'product.png', mimeType: 'image/png', buffer: png}, {name: 'damaged.png', mimeType: 'image/png', buffer: damaged}, {name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image')}];
    await page.locator('#image-files').setInputFiles(files);
    await page.locator('[data-view="records"]').click(); assert.equal(await page.locator('#metadata-view').isHidden(), true);
    await page.locator('[data-view="metadata"]').click(); assert.equal(await page.locator('.image-row').count(), 5);
    await page.locator('[data-view="records"]').click(); await page.locator('#search').fill('preserved search');
    await page.locator('[data-view="metadata"]').click(); await page.locator('#image-process').click();
    await page.waitForFunction(() => !ImageTool.getState().processing && ImageTool.getState().items.some(i => i.output));
    assert.deepEqual(await page.evaluate(() => ImageTool.getState().items.map(i => i.status)), ['success', 'success', 'success', 'error', 'error']);
    assert.equal(await page.locator('#image-progress-text').textContent(), '100%'); assert.equal(await page.locator('.image-row-actions a').count(), 3);
    await page.locator('#image-zip').click(); await page.locator('#image-zip-ready').waitFor({state: 'visible'});
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#image-zip-ready').click()]);
    assert.equal(download.suggestedFilename(), 'amazon-ai-tagged-images.zip');
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    assert.deepEqual(Object.keys(zip.files).sort(), ['product_amazon-ai-tagged (2).jpg', 'product_amazon-ai-tagged.jpg', 'product_amazon-ai-tagged.png']);
    assert.deepEqual(await zip.file('product_amazon-ai-tagged.jpg').async('nodebuffer'), outputs.jpeg); assert.deepEqual(await zip.file('product_amazon-ai-tagged.png').async('nodebuffer'), outputs.png);
    const [individual] = await Promise.all([page.waitForEvent('download'), page.locator('.image-row-actions a').first().click()]);
    assert.deepEqual(fs.readFileSync(await individual.path()), outputs.jpeg); checks += 9;
    for (const width of [1450, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow at ' + width);
      assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.nav')).some(e => e.scrollWidth > e.clientWidth)), false, 'navigation text overflow');
      await page.screenshot({path: path.join(artifacts, 'toolbox-images-' + width + '.png'), fullPage: true});
    }
    await page.locator('[data-view="records"]').click(); assert.equal(await page.locator('#search').inputValue(), 'preserved search');
    await page.locator('[data-view="metadata"]').click(); await page.locator('.image-row-actions button').first().click();
    assert.equal(await page.locator('#image-zip-ready').isHidden(), true); assert.equal(await page.locator('.image-row').count(), 4);
    await page.locator('#image-clear').click(); assert.equal(await page.locator('#image-queue').isHidden(), true);
    assert.equal(await page.evaluate(() => localStorage.length), 0); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(JSON.stringify({status: 'PASS', checks, viewports: [1450,768,390,320], pixelEquality: true, zipFiles: 3, noExternalRequests: true, errors}));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

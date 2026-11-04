(function (root) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const pause = () => new Promise(r => setTimeout(r, 0));
  function parser() {
    const p = sax.parser(true, {trim: false, normalize: false, position: false});
    p.ondoctype = () => { throw new Error('不支持包含DTD的XML文件'); };
    p.onerror = e => { throw new Error('Excel XML格式异常：' + e.message.slice(0, 180)); };
    return p;
  }
  const local = name => name.split(':').pop();
  async function feed(p, xml, progress = () => {}, signal) {
    if (xml.length > 180 * 1024 * 1024) throw new Error('单个工作表超过180MB，请拆分文件。');
    for (let i = 0; i < xml.length; i += 196608) {
      if (signal && signal.aborted) throw new Error('已取消');
      p.write(xml.slice(i, i + 196608)); progress(Math.min(1, (i + 196608) / xml.length)); await pause();
    }
    p.close();
  }
  function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
  function colName(index) { let s = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  async function sheetRows(xml, shared, progress, signal) {
    const rows = [], p = parser(); let row = null, cell = null, inValue = false, inText = false, phonetic = 0;
    p.onopentag = node => {
      const tag = local(node.name), a = node.attributes;
      if (tag === 'row') row = {row: Number(a.r) || rows.length + 1, cells: []};
      else if (tag === 'c' && row) cell = {index: a.r ? colIndex(a.r) : row.cells.length, type: a.t || '', value: '', inline: ''};
      else if (tag === 'rPh') phonetic++;
      else if (tag === 'v' && cell) inValue = true;
      else if (tag === 't' && cell && !phonetic) inText = true;
    };
    p.ontext = value => { if (cell && inValue) cell.value += value; if (cell && inText && !phonetic) cell.inline += value; };
    p.oncdata = p.ontext;
    p.onclosetag = name => {
      const tag = local(name);
      if (tag === 'rPh') phonetic--;
      if (tag === 'v') inValue = false;
      if (tag === 't') inText = false;
      if (tag === 'c' && cell && row) {
        let value = cell.value;
        if (cell.type === 's') { const index = Number(value); if (!Number.isInteger(index) || index < 0 || index >= shared.length) throw new Error('共享字符串引用无效'); value = shared[index]; }
        else if (cell.type === 'inlineStr') value = cell.inline;
        else if (cell.type === 'b') value = value === '1';
        else if (cell.type === 'e') value = '#Excel错误:' + value;
        else if (cell.type !== 'str' && cell.type !== 'd' && value !== '') {
          const n = Number(value);
          if (Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n))) value = n;
        }
        row.cells[cell.index] = value; cell = null;
      }
      if (tag === 'row' && row) { if (row.cells.some(v => v !== '' && v != null)) rows.push(row); row = null; }
    };
    await feed(p, xml, progress, signal); return rows;
  }
  async function open(file, progress = () => {}, signal) {
    if (file.size > 64 * 1024 * 1024) throw new Error('单个文件不能超过64MB。');
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw new Error('请选择.xlsx或.xlsm文件；旧版.xls请先另存为.xlsx。');
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch (_) { throw new Error('无法打开Excel文件；请检查是否加密或文件损坏。'); }
    if (Object.keys(zip.files).length > 4000) throw new Error('工作簿内部文件数量过多。');
    const read = async path => {
      const f = zip.file(path); if (!f) throw new Error('工作簿缺少文件：' + path);
      const s = await f.async('string'); if (s.length > 180 * 1024 * 1024) throw new Error('Excel解压内容过大。'); return s;
    };
    const rels = new Map(), sheets = [], p = parser();
    p.onopentag = n => { if (local(n.name) === 'Relationship' && n.attributes.TargetMode !== 'External') rels.set(n.attributes.Id, n.attributes.Target); };
    p.write(await read('xl/_rels/workbook.xml.rels')).close();
    const w = parser();
    w.onopentag = n => {
      if (local(n.name) === 'sheet') {
        const target = rels.get(n.attributes['r:id']); if (!target) return;
        const parts = (target.startsWith('/') ? target.slice(1) : 'xl/' + target).split('/'), normalized = [];
        for (const part of parts) { if (part === '..') normalized.pop(); else if (part && part !== '.') normalized.push(part); }
        const path = normalized.join('/'); if (!path.startsWith('xl/')) throw new Error('工作表路径无效');
        sheets.push({name: n.attributes.name, path});
      }
    };
    w.write(await read('xl/workbook.xml')).close();
    if (!sheets.length) throw new Error('工作簿没有可读取的工作表。');
    const shared = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const sp = parser(); let current = '', inText = false, phonetic = 0;
      sp.onopentag = n => { const t = local(n.name); if (t === 'si') current = ''; if (t === 'rPh') phonetic++; if (t === 't' && !phonetic) inText = true; };
      sp.ontext = v => { if (inText && !phonetic) current += v; }; sp.oncdata = sp.ontext;
      sp.onclosetag = name => { const t = local(name); if (t === 'rPh') phonetic--; if (t === 't') inText = false; if (t === 'si') shared.push(current); };
      await feed(sp, await read('xl/sharedStrings.xml'), v => progress(.1 + .15 * v), signal);
    }
    return {file, zip, sheets, shared, read, async rows(sheet, onProgress = () => {}) { return sheetRows(await read(sheet.path), shared, onProgress, signal); }};
  }
  async function report(file, progress, signal) {
    const book = await open(file, v => progress(v, '读取工作簿'), signal);
    const revenueSheet = book.sheets.find(s => s.name.toLowerCase() === 'revenue');
    const backendSheet = book.sheets.find(s => s.name === '后台交易明细');
    if (!revenueSheet || !backendSheet) throw new Error('报表需要包含revenue和后台交易明细两个工作表。');
    const revenueRows = await book.rows(revenueSheet, v => progress(.25 + .15 * v, '读取Revenue'));
    const backendRows = await book.rows(backendSheet, v => progress(.4 + .6 * v, '读取后台交易明细'));
    const input = SkuEngine.prepare(revenueRows, backendRows);
    return {book, input, revenueSheet};
  }
  function xmlDoc(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持DTD');
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Revenue工作表XML无效。');
    return d;
  }
  async function exportReport(context, output, progress = () => {}, signal) {
    const {book, input, revenueSheet} = context;
    if (Object.keys(book.zip.files).some(p => p.startsWith('_xmlsignatures/'))) throw new Error('该工作簿带有文件级数字签名，请先使用未签名副本。');
    const d = xmlDoc(await book.read(revenueSheet.path)), rootEl = d.documentElement, ns = rootEl.namespaceURI || NS;
    const elements = name => [...d.getElementsByTagNameNS(ns, name)];
    if (elements('sheetProtection').length) throw new Error('Revenue工作表受保护，请先在Excel中取消保护。');
    const sheetData = elements('sheetData')[0]; if (!sheetData) throw new Error('Revenue缺少sheetData');
    const rows = new Map([...sheetData.children].filter(e => local(e.nodeName) === 'row').map(e => [Number(e.getAttribute('r')), e]));
    const header = rows.get(input.rh.row); if (!header) throw new Error('Revenue表头不存在');
    const hs = input.rh.headers, hasSku = hs.sku != null;
    const outputs = ['SKU', 'SKU匹配状态', 'SKU匹配依据', '匹配后台行及数量', '候选SKU', 'Revenue与匹配后台金额差', 'ASIN身份核对', '后台匹配数量', 'SKU匹配版本'];
    if (hasSku) outputs.push('SKU匹配前原值');
    let last = Math.max(-1, ...Object.values(hs)), columns = new Map();
    for (const name of outputs) { const existing = hs[name.toLowerCase()]; columns.set(name, existing == null ? ++last : existing); }
    const cellMap = row => new Map([...row.children].filter(e => local(e.nodeName) === 'c').map(e => [colIndex(e.getAttribute('r')), e]));
    function setCell(row, cells, col, value, headerCell = false) {
      let c = cells.get(col);
      if (!c) {
        c = d.createElementNS(ns, 'c'); c.setAttribute('r', colName(col) + row.getAttribute('r'));
        const next = [...row.children].find(el => local(el.nodeName) === 'c' && colIndex(el.getAttribute('r')) > col);
        if (next) row.insertBefore(c, next); else row.appendChild(c); cells.set(col, c);
        if (headerCell) { const first = header.children[0]; if (first && first.hasAttribute('s')) c.setAttribute('s', first.getAttribute('s')); }
      }
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute('t');
      if (typeof value === 'number' && Number.isFinite(value)) { const v = d.createElementNS(ns, 'v'); v.textContent = String(value); c.appendChild(v); }
      else { c.setAttribute('t', 'inlineStr'); const is = d.createElementNS(ns, 'is'), t = d.createElementNS(ns, 't'); t.textContent = value == null ? '' : String(value).slice(0, 32767); t.setAttribute('xml:space', 'preserve'); is.appendChild(t); c.appendChild(is); }
    }
    const hc = cellMap(header); for (const [name, col] of columns) setCell(header, hc, col, name, true);
    const labels = {matched: '已匹配', manual: '人工确认', review: '待核对', excluded: '不参与'};
    for (let i = 0; i < output.results.length; i++) {
      if (signal && signal.aborted) throw new Error('已取消');
      const r = output.results[i], row = rows.get(r.row); if (!row) throw new Error('原Revenue第' + r.row + '行不存在');
      const cells = cellMap(row);
      const values = [r.sku, labels[r.status], r.reason, r.refs.map(a => a.row + '(数量' + a.qty + ')').join(';'),
        r.candidates.join(';'), r.difference == null ? '' : r.difference, r.evidence, r.qty == null ? '' : r.qty, output.version];
      if (hasSku) values.push(r.originalSku);
      outputs.forEach((name, j) => setCell(row, cells, columns.get(name), values[j]));
      if (i % 100 === 0) { progress(.1 + .55 * i / output.results.length, '更新SKU核对列'); await pause(); }
    }
    const lastRow = Math.max(...rows.keys()), dimension = elements('dimension')[0];
    if (dimension) dimension.setAttribute('ref', 'A1:' + colName(Math.max(last, colIndex((dimension.getAttribute('ref') || 'A1').split(':').pop()))) + lastRow);
    const filter = elements('autoFilter')[0];
    if (filter && /^A\d+:/.test(filter.getAttribute('ref') || '')) filter.setAttribute('ref', 'A' + input.rh.row + ':' + colName(last) + lastRow);
    // Only one ZIP member changes. VBA, shared strings, other sheets and formulas remain untouched.
    const xml = new XMLSerializer().serializeToString(d);
    const updated = await JSZip.loadAsync(await book.file.arrayBuffer()); updated.file(revenueSheet.path, xml);
    const data = await updated.generateAsync({type: 'blob', compression: 'DEFLATE', compressionOptions: {level: 3},
      mimeType: /\.xlsm$/i.test(book.file.name) ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
      m => progress(.65 + .35 * m.percent / 100, '生成报表副本'));
    if (signal && signal.aborted) throw new Error('已取消');
    return data;
  }
  function csvRows(text) {
    const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && ch === delimiter) { row.push(value); value = ''; }
      else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
      else value += ch;
    }
    if (quoted) throw new Error('CSV引号未闭合'); row.push(value); if (row.some(Boolean)) rows.push(row);
    return rows.map((cells, i) => ({row: i + 1, cells}));
  }
  function csv(data) { return '\ufeff' + data.map(row => row.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n'); }
  function safeCsv(data) { return csv(data.map(row => row.map(v => typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v))); }
  root.WorkbookIO = {open, report, exportReport, csvRows, csv, safeCsv, colName, colIndex};
})(globalThis);

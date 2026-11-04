(function () {
  'use strict';
  const $ = id => document.getElementById(id), $$ = selector => [...document.querySelectorAll(selector)];
  const state = {context: null, output: null, mappings: [], overrides: [], busy: false, dirty: false, view: 'records',
    filter: 'all', search: '', page: 1, pageSize: 50, ascending: true, mappingMode: 'confirmed', mappingSearch: '', mappingPage: 1,
    controller: null, detail: null, editing: null, importBook: null, importRows: null};
  const labels = {matched: '已匹配', manual: '人工确认', review: '待核对', excluded: '不参与'};
  const fmt = n => n == null ? '—' : (Math.abs(Number(n)) < .005 ? 0 : Number(n)).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const count = n => n == null ? '—' : Number(n).toLocaleString('zh-CN');
  function icon() { lucide.createIcons({attrs: {'aria-hidden': 'true'}}); }
  function node(tag, value = '', cls = '') { const n = document.createElement(tag); n.textContent = value; if (cls) n.className = cls; return n; }
  function buttonIcon(name, title, action) { const b = node('button', '', 'icon-btn'); b.title = title; b.setAttribute('aria-label', title); const i = document.createElement('i'); i.dataset.lucide = name; b.append(i); b.onclick = action; return b; }
  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
  function alert(message) { $('alert').hidden = !message; $('alert').textContent = message || ''; }
  function persist() { try { localStorage.setItem('revenue-sku-confirmed-v1', JSON.stringify(state.mappings)); } catch (_) { toast('映射未能写入本地存储，请导出备份'); } }
  function validateMapping(m) {
    const r = {account: SkuEngine.text(m.account), market: SkuEngine.text(m.market).toLowerCase(), asin: SkuEngine.text(m.asin).toUpperCase(), sku: SkuEngine.text(m.sku)};
    if (!r.account || r.account.length > 100) throw new Error('请填写账号');
    if (!/^[a-z0-9][a-z0-9.-]{1,99}$/.test(r.market)) throw new Error('站点格式无效');
    if (!/^[A-Z0-9]{10}$/.test(r.asin)) throw new Error('ASIN必须是10位字母或数字');
    if (!r.sku || r.sku.length > 255 || /[\r\n\u0000-\u001f]/.test(r.sku)) throw new Error('SKU为空、过长或包含换行');
    return r;
  }
  const mapKey = m => JSON.stringify([m.account, m.market, m.asin, m.sku]);
  function mergeMappings(list) { const unique = new Map(state.mappings.map(m => [mapKey(m), m])); for (const m of list) unique.set(mapKey(m), m); return [...unique.values()]; }
  function dirty() { state.dirty = !!state.output; updateControls(); render(); }
  function updateControls() {
    $('run').disabled = state.busy || !state.context;
    $('choose-file').disabled = state.busy;
    $('report-file').disabled = state.busy;
    $('export').disabled = state.busy || !state.output || state.dirty;
    $('audit-export').disabled = state.busy || !state.output || state.dirty;
    $('pending-export').disabled = state.busy || !state.output || state.dirty;
    ['mapping-add', 'mapping-import', 'mapping-export'].forEach(id => $(id).disabled = state.busy);
    $$('#records-body .icon-btn').forEach(b => b.disabled = state.busy || !state.output || state.dirty);
    $$('#mappings-body .icon-btn').forEach(b => b.disabled = state.busy);
    $('freshness').textContent = state.dirty ? '映射已修改 · 待重新匹配' : state.output ? state.output.version : '';
    $('freshness').className = state.dirty ? 'dirty' : 'muted';
  }
  function busy(on, stage = '') {
    state.busy = on; $('progress-band').hidden = !on;
    if (on) { state.controller = new AbortController(); progress(0, stage); alert(''); }
    updateControls();
  }
  function progress(value, stage) { const p = Math.max(0, Math.min(100, Math.round(value * 100))); $('progress').value = p; $('progress-text').textContent = p + '%'; $('progress-stage').textContent = stage; }
  function date(v) {
    if (typeof v === 'number' && v > 20000 && v < 100000) return new Date((v - 25569) * 86400000).toISOString().slice(0, 10);
    return String(v == null ? '' : v).slice(0, 10);
  }
  async function loadReport(file) {
    if (!file || state.busy) return;
    if (state.overrides.length && !confirm('当前报表存在人工修正，切换报表会清空这些修正。是否继续？')) return;
    busy(true, '读取工作簿');
    try {
      const context = await WorkbookIO.report(file, progress, state.controller.signal);
      state.context = context; state.output = null; state.overrides = []; state.dirty = false; state.page = 1;
      $('filename').textContent = file.name; $('filename').title = file.name;
      $('filemeta').textContent = context.input.account + ' · ' + context.input.markets.join(' / ') + ' · ' + count(context.input.revenue.length) + '条Revenue · ' + (file.size / 1048576).toFixed(1) + 'MB';
      render(); toast('报表已读取');
    } catch (e) { if (e.message !== '已取消') alert(e.message); else toast('已取消读取'); }
    finally { busy(false); $('report-file').value = ''; }
  }
  async function runMatch(options = {}) {
    if (!state.context || state.busy) return false;
    busy(true, '建立订单和ASIN索引');
    const mappings = options.mappings || state.mappings, overrides = options.overrides || state.overrides;
    try {
      const output = await SkuEngine.match(state.context.input, mappings, overrides,
        (p, done) => progress(p, '匹配Revenue · ' + count(done) + ' / ' + count(state.context.input.revenue.length)), state.controller.signal);
      state.output = output; state.overrides = overrides; state.mappings = mappings; state.dirty = false; state.page = 1;
      if (options.mappings) persist(); render();
      toast('匹配完成 · 已匹配' + count(output.stats.matched + output.stats.manual) + '条 · 待核对' + count(output.stats.review) + '条');
      return true;
    } catch (e) { if (e.message === '已取消') toast('已取消匹配，未提交本次结果'); else alert(e.message); return false; }
    finally { busy(false); }
  }
  function currentRows() {
    const base = state.output ? state.output.results : state.context ? state.context.input.revenue.map(r => ({...r, status: 'unrun', sku: '', reason: '', difference: null})) : [];
    const q = state.search.trim().toLowerCase();
    const filtered = base.filter(r => (state.filter === 'all' || r.status === state.filter) && (!q || [r.order, r.asin, r.sku, r.originalSku].some(v => String(v || '').toLowerCase().includes(q))));
    return state.ascending ? filtered : [...filtered].reverse();
  }
  function renderRecords() {
    const stats = state.output ? state.output.stats : {total: state.context ? state.context.input.revenue.length : null};
    ['total', 'matched', 'review', 'manual'].forEach(k => $('stat-' + k).textContent = count(stats[k]));
    $('stat-warning').textContent = count(stats.warnings); $('review-count').textContent = stats.review == null ? '' : count(stats.review);
    $('nav-count').textContent = stats.total == null ? '' : count(stats.total);
    const data = currentRows(), pages = Math.max(1, Math.ceil(data.length / state.pageSize)); state.page = Math.min(state.page, pages);
    const first = (state.page - 1) * state.pageSize, shown = data.slice(first, first + state.pageSize), body = $('records-body'); body.replaceChildren();
    for (const r of shown) {
      const tr = document.createElement('tr');
      tr.append(node('td', r.row, 'mono'));
      const order = node('td'); order.append(node('span', r.order || '缺少订单号', 'mono'), node('span', r.asin || '缺少ASIN', 'sub mono')); tr.append(order);
      const business = node('td'); business.append(node('span', r.activity), node('span', date(r.date), 'sub')); tr.append(business);
      tr.append(node('td', fmt(r.amount), 'numeric'));
      const sku = node('td', r.sku || '—', 'mono'); sku.title = r.sku || ''; tr.append(sku);
      const status = node('td'); status.append(node('span', labels[r.status] || '未匹配', 'badge ' + r.status)); tr.append(status);
      tr.append(node('td', r.reason || '—', 'muted'));
      tr.append(node('td', fmt(r.difference), 'numeric' + (r.difference != null && Math.abs(r.difference) > SkuEngine.TOL ? ' error-cell' : '')));
      const actions = node('td'), b = buttonIcon('scan-search', '核对第' + r.row + '行', () => openDetail(r)); b.disabled = !state.output || state.busy || state.dirty; actions.append(b); tr.append(actions); body.append(tr);
    }
    $('records-empty').hidden = data.length > 0; $('empty-meta').textContent = state.context ? '没有符合筛选条件的记录' : '未选择报表';
    $('record-range').textContent = data.length ? (first + 1) + '–' + (first + shown.length) + ' / ' + count(data.length) + '条' : '0条记录';
    $('page-label').textContent = state.page + ' / ' + pages; $('prev').disabled = state.page <= 1; $('next').disabled = state.page >= pages;
    icon();
  }
  function mappingRows() {
    const list = state.mappingMode === 'learned' ? (state.output ? state.output.learned : []) : state.mappings;
    const q = state.mappingSearch.trim().toLowerCase();
    return list.filter(m => !q || [m.account, m.market, m.asin, m.sku].some(v => String(v).toLowerCase().includes(q)));
  }
  function renderMappings() {
    $('mapping-count').textContent = state.mappings.length || ''; $('confirmed-count').textContent = count(state.mappings.length);
    $('learned-count').textContent = state.output ? count(state.output.learned.length) : '0';
    const rows = mappingRows(), pages = Math.max(1, Math.ceil(rows.length / 50)); state.mappingPage = Math.min(state.mappingPage, pages);
    const shown = rows.slice((state.mappingPage - 1) * 50, state.mappingPage * 50), body = $('mappings-body'); body.replaceChildren();
    for (const m of shown) {
      const tr = document.createElement('tr');
      for (const key of ['account', 'market', 'asin', 'sku']) tr.append(node('td', m[key], key === 'market' ? '' : 'mono'));
      const source = node('td', state.mappingMode === 'confirmed' ? '已确认' : count(m.count) + '个单SKU订单', 'muted');
      if (m.orders) source.title = m.orders.join('\n'); tr.append(source);
      const actions = node('td');
      if (state.mappingMode === 'confirmed') {
        actions.append(buttonIcon('pencil', '编辑映射', () => openMapping(m)), buttonIcon('trash-2', '删除映射', () => {
          if (state.busy || !confirm('删除ASIN ' + m.asin + '与该SKU的已确认映射？')) return;
          state.mappings = state.mappings.filter(x => mapKey(x) !== mapKey(m)); persist(); dirty();
        }));
      } else actions.append(buttonIcon('check', '确认为长期映射', () => {
        if (state.busy || !confirm('确认ASIN ' + m.asin + '对应完整SKU ' + m.sku + '？')) return;
        state.mappings = mergeMappings([validateMapping(m)]); persist(); dirty(); toast('映射已确认，待重新匹配');
      }));
      tr.append(actions); body.append(tr);
    }
    $('mappings-empty').hidden = rows.length > 0; $('mapping-range').textContent = count(rows.length) + '条映射';
    $('mapping-page').textContent = state.mappingPage + ' / ' + pages; $('mapping-prev').disabled = state.mappingPage <= 1; $('mapping-next').disabled = state.mappingPage >= pages; icon();
  }
  function render() { renderRecords(); renderMappings(); updateControls(); }
  function openDetail(r) {
    if (state.busy || state.dirty) return;
    state.detail = r; $('detail-subtitle').textContent = 'Revenue第' + r.row + '行 · ' + r.order;
    const fields = $('detail-fields'); fields.replaceChildren();
    for (const [label, value] of [['ASIN', r.asin], ['业务类型', r.activity], ['原币金额', fmt(r.amount) + ' ' + r.currency], ['当前SKU', r.sku || '未确定'], ['状态', labels[r.status]], ['原表SKU', r.originalSku || '—']]) {
      const n = node('div'); n.append(node('label', label), node('strong', value)); fields.append(n);
    }
    const candidates = state.context.input.backend.filter(b => b.order === r.order && b.kind === r.kind && b.market === r.market);
    const select = $('detail-sku'); select.replaceChildren(); select.append(new Option('请选择SKU', ''));
    for (const sku of [...new Set(candidates.map(b => b.sku))]) select.append(new Option(sku, sku));
    select.value = r.sku || '';
    const prior = state.overrides.find(o => o.row === r.row);
    $('detail-note').value = prior ? prior.note : ''; $('save-identity').checked = false; $('detail-error').textContent = '';
    $('detail-evidence').textContent = r.reason + '；' + (r.evidence || '无ASIN证据'); $('remove-override').hidden = !prior;
    const body = $('detail-candidates'); body.replaceChildren();
    for (const b of candidates) {
      const tr = document.createElement('tr'); tr.dataset.sku = b.sku;
      const td = node('td'), check = document.createElement('input'); check.type = 'checkbox'; check.dataset.row = b.row; check.disabled = !b.valid; check.setAttribute('aria-label', '选择后台第' + b.row + '行'); td.append(check); tr.append(td);
      tr.append(node('td', b.row, 'mono'), node('td', b.sku, 'mono'), node('td', fmt(b.gross), 'numeric'), node('td', b.qty, 'numeric'));
      const quantity = document.createElement('input'); quantity.type = 'number'; quantity.min = '1'; quantity.max = b.qty; quantity.step = '1'; quantity.value = String(b.qty); quantity.disabled = !b.valid; quantity.dataset.quantity = b.row; quantity.setAttribute('aria-label', '后台第' + b.row + '行本行匹配数量');
      const last = node('td'); last.append(quantity); tr.append(last); body.append(tr);
      const old = (prior ? prior.allocations : r.refs).find(a => a.row === b.row); if (old) { check.checked = true; quantity.value = old.qty; }
      check.onchange = () => { if (check.checked) { select.value = b.sku; filterCandidates(false); } };
    }
    $('detail-dialog').showModal(); filterCandidates(false); icon();
  }
  function filterCandidates(uncheck = true) {
    const sku = $('detail-sku').value;
    for (const tr of $('detail-candidates').children) {
      tr.hidden = !!sku && tr.dataset.sku !== sku;
      if (uncheck || (sku && tr.dataset.sku !== sku)) tr.querySelector('input[type=checkbox]').checked = false;
    }
  }
  async function saveOverride(remove = false) {
    const r = state.detail; if (!r || state.busy) return;
    let overrides = state.overrides.filter(o => o.row !== r.row), mappings = state.mappings;
    try {
      if (!remove) {
        const allocations = [...$('detail-candidates').querySelectorAll('input[type=checkbox]:checked')].map(c => ({row: Number(c.dataset.row), qty: Number($('detail-candidates').querySelector('[data-quantity="' + c.dataset.row + '"]').value)}));
        if (!allocations.length) throw new Error('请选择后台来源记录，并填写对应数量');
        const sku = $('detail-sku').value; if (!sku) throw new Error('请选择SKU');
        overrides.push({row: r.row, allocations, note: $('detail-note').value.trim()});
        if ($('save-identity').checked) mappings = mergeMappings([validateMapping({account: r.account, market: r.market, asin: r.asin, sku})]);
      }
      $('detail-dialog').close(); const ok = await runMatch({overrides, mappings});
      if (!ok) { $('detail-dialog').showModal(); $('detail-error').textContent = $('alert').textContent || '修正未提交'; }
    } catch (e) { $('detail-error').textContent = e.message; }
  }
  function openMapping(m = null) {
    if (state.busy) return; state.editing = m; $('mapping-dialog-title').textContent = m ? '编辑映射' : '新增映射';
    $('map-account').value = m ? m.account : state.context ? state.context.input.account : '';
    $('map-market').value = m ? m.market : state.context ? state.context.input.markets[0] : 'amazon.com';
    $('map-asin').value = m ? m.asin : ''; $('map-sku').value = m ? m.sku : ''; $('mapping-error').textContent = '';
    $('mapping-dialog').showModal();
  }
  function saveMapping(e) {
    e.preventDefault(); if (state.busy) return;
    try {
      const m = validateMapping({account: $('map-account').value, market: $('map-market').value, asin: $('map-asin').value, sku: $('map-sku').value});
      if (state.editing) state.mappings = state.mappings.filter(x => mapKey(x) !== mapKey(state.editing));
      state.mappings = mergeMappings([m]); persist(); dirty(); $('mapping-dialog').close(); toast('映射已保存');
    } catch (err) { $('mapping-error').textContent = err.message; }
  }
  function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
  function stamp() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('') + '-' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(''); }
  async function exportReport() {
    if (!state.output || state.dirty || state.busy) return;
    if (state.output.stats.review && !confirm('仍有' + state.output.stats.review + '条待核对，新副本会保留空SKU和核对原因。是否继续导出？')) return;
    if (state.context.input.rh.headers.sku != null && !confirm('原表已有SKU列，将只在新副本中更新，并保留“SKU匹配前原值”。原有数量、核销及税额结果不会重算。是否继续？')) return;
    busy(true, '生成新报表');
    try {
      const blob = await WorkbookIO.exportReport(state.context, state.output, progress, state.controller.signal);
      const file = state.context.book.file.name, dot = file.lastIndexOf('.');
      const a = $('download-ready'); if (a.href.startsWith('blob:')) URL.revokeObjectURL(a.href);
      a.href = URL.createObjectURL(blob); a.download = file.slice(0, dot) + '_SKU匹配_' + stamp() + file.slice(dot);
      $('download-name').textContent = a.download;
      $('download-summary').textContent = count(state.output.stats.total) + '条Revenue · 待核对' + count(state.output.stats.review) + '条 · ' + (blob.size / 1048576).toFixed(1) + 'MB';
      $('download-dialog').showModal(); icon();
    } catch (e) { if (e.message === '已取消') toast('已取消导出'); else alert(e.message); }
    finally { busy(false); }
  }
  function exportAudit(pending = false) {
    if (!state.output || state.dirty || state.busy) return;
    const rows = state.output.results.filter(r => !pending || r.status === 'review');
    const data = [['Revenue原行号', '账号', '站点', '订单号', 'ASIN', 'activity', 'Revenue原币金额', 'SKU', '状态', '依据', '后台来源行及数量', '候选SKU', '金额差', 'ASIN证据']];
    for (const r of rows) data.push([r.row, r.account, r.market, r.order, r.asin, r.activity, r.amount, r.sku, labels[r.status], r.reason, r.refs.map(a => a.row + '(数量' + a.qty + ')').join(';'), r.candidates.join(';'), r.difference, r.evidence]);
    download(new Blob([WorkbookIO.safeCsv(data)], {type: 'text/csv;charset=utf-8'}), (pending ? '待核对SKU_' : 'SKU核对明细_') + stamp() + '.csv');
  }
  async function importFile(file) {
    if (!file || state.busy) return;
    if (file.size > 32 * 1024 * 1024) { alert('映射文件不能超过32MB'); return; }
    try {
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(await file.text()), rows = Array.isArray(data) ? data : data.mappings;
        if (!Array.isArray(rows) || rows.length > 50000) throw new Error('映射JSON格式无效或超过50000条');
        const values = rows.map((m, i) => { try { return validateMapping(m); } catch (e) { throw new Error('第' + (i + 1) + '条：' + e.message); } });
        const before = state.mappings.length; state.mappings = mergeMappings(values); persist(); dirty(); toast('新增' + (state.mappings.length - before) + '条已确认映射'); return;
      }
      busy(true, '读取映射文件');
      state.importBook = null; state.importRows = null; $('import-sheet').replaceChildren();
      if (/\.(csv|tsv)$/i.test(file.name)) {
        let text = await file.text(); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        state.importRows = WorkbookIO.csvRows(text); $('import-sheet').append(new Option('CSV / TSV', 'csv'));
      } else {
        state.importBook = await WorkbookIO.open(file, p => progress(p, '读取映射工作簿'), state.controller.signal);
        for (const s of state.importBook.sheets) $('import-sheet').append(new Option(s.name, s.path));
        state.importRows = await state.importBook.rows(state.importBook.sheets[0]);
      }
      if (!state.importRows.length) throw new Error('映射文件没有记录');
      $('import-header').value = state.importRows[0].row;
      $('import-filename').textContent = file.name; $('import-account').value = state.context ? state.context.input.account : '';
      $('import-market').value = state.context ? state.context.input.markets[0] : 'amazon.com'; $('import-error').textContent = '';
      renderImport(true); $('import-dialog').showModal();
    } catch (e) { if (e.message !== '已取消') alert(e.message); }
    finally { busy(false); $('mapping-file').value = ''; }
  }
  function renderImport(auto = false) {
    const rows = state.importRows || [], header = rows.find(r => r.row === Number($('import-header').value));
    if (!header) { $('import-error').textContent = '表头行不存在'; return; } $('import-error').textContent = '';
    const oldA = $('import-asin').value, oldS = $('import-sku').value;
    for (const id of ['import-asin', 'import-sku']) { $(id).replaceChildren(); $(id).append(new Option('请选择列', '')); header.cells.forEach((v, i) => $(id).append(new Option(WorkbookIO.colName(i) + ' · ' + String(v || ''), String(i)))); }
    const find = names => header.cells.findIndex(v => names.includes(String(v || '').trim().toLowerCase()));
    $('import-asin').value = auto ? String(find(['asin', 'asin1', '商品asin'])) : oldA;
    $('import-sku').value = auto ? String(find(['sku', 'seller-sku', 'seller sku', 'msku', '卖家sku', '卖家 sku', 'merchant-sku'])) : oldS;
    const preview = $('import-preview'); preview.replaceChildren();
    const table = document.createElement('table'), head = document.createElement('thead'), tr = document.createElement('tr');
    for (const label of ['表格行', 'ASIN', 'SKU']) tr.append(node('th', label)); head.append(tr); table.append(head);
    const body = document.createElement('tbody');
    for (const r of rows.filter(r => r.row > header.row).slice(0, 5)) { const row = document.createElement('tr'); row.append(node('td', r.row), node('td', r.cells[Number($('import-asin').value)] || ''), node('td', r.cells[Number($('import-sku').value)] || '')); body.append(row); }
    table.append(body); preview.append(table);
  }
  function saveImport() {
    if (state.busy) return;
    try {
      const a = $('import-asin').value, s = $('import-sku').value;
      if (a === '' || s === '' || a === s) throw new Error('请分别选择ASIN和SKU列');
      const values = [], errors = [];
      for (const r of state.importRows.filter(r => r.row > Number($('import-header').value))) {
        if (!SkuEngine.text(r.cells[a]) && !SkuEngine.text(r.cells[s])) continue;
        try { values.push(validateMapping({account: $('import-account').value, market: $('import-market').value, asin: r.cells[a], sku: r.cells[s]})); }
        catch (e) { errors.push('第' + r.row + '行：' + e.message); }
        if (values.length > 50000) throw new Error('映射不能超过50000条');
      }
      if (errors.length) throw new Error(errors.slice(0, 4).join('；') + (errors.length > 4 ? '；共' + errors.length + '行异常，未导入' : '；未导入'));
      if (!values.length) throw new Error('没有有效映射');
      const before = state.mappings.length; state.mappings = mergeMappings(values); persist(); dirty(); $('import-dialog').close(); toast('新增' + (state.mappings.length - before) + '条映射');
    } catch (e) { $('import-error').textContent = e.message; }
  }
  $('choose-file').onclick = () => $('report-file').click(); $('report-file').onchange = e => loadReport(e.target.files[0]);
  $('run').onclick = () => runMatch(); $('cancel').onclick = () => state.controller && state.controller.abort();
  $('export').onclick = exportReport; $('audit-export').onclick = () => exportAudit(); $('pending-export').onclick = () => exportAudit(true);
  $('download-close').onclick = () => $('download-dialog').close();
  $('search').oninput = e => { state.search = e.target.value; state.page = 1; renderRecords(); };
  $('page-size').onchange = e => { state.pageSize = Number(e.target.value); state.page = 1; renderRecords(); };
  $('prev').onclick = () => { state.page--; renderRecords(); }; $('next').onclick = () => { state.page++; renderRecords(); };
  $('sort-row').onclick = () => { state.ascending = !state.ascending; renderRecords(); };
  $$('#status-tabs button').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; state.page = 1; $$('#status-tabs button').forEach(x => x.classList.toggle('selected', x === b)); renderRecords(); });
  $$('.nav').forEach(b => b.onclick = () => { state.view = b.dataset.view; $$('.nav').forEach(x => x.classList.toggle('active', x === b)); $('records-view').hidden = state.view !== 'records'; $('mappings-view').hidden = state.view !== 'mappings'; $('view-title').textContent = state.view === 'records' ? 'Revenue SKU匹配' : 'ASIN映射库'; });
  $$('#mapping-tabs button').forEach(b => b.onclick = () => { state.mappingMode = b.dataset.mapping; state.mappingPage = 1; $$('#mapping-tabs button').forEach(x => x.classList.toggle('selected', x === b)); renderMappings(); });
  $('mapping-search').oninput = e => { state.mappingSearch = e.target.value; state.mappingPage = 1; renderMappings(); };
  $('mapping-prev').onclick = () => { state.mappingPage--; renderMappings(); }; $('mapping-next').onclick = () => { state.mappingPage++; renderMappings(); };
  $('mapping-add').onclick = () => openMapping(); $('mapping-close').onclick = () => $('mapping-dialog').close(); $('mapping-form').onsubmit = saveMapping;
  $('mapping-import').onclick = () => $('mapping-file').click(); $('mapping-file').onchange = e => importFile(e.target.files[0]);
  $('mapping-export').onclick = () => download(new Blob([JSON.stringify({version: 1, exportedAt: new Date().toISOString(), mappings: state.mappings}, null, 2)], {type: 'application/json'}), 'ASIN映射备份_' + stamp() + '.json');
  $('detail-sku').onchange = () => filterCandidates(); $('detail-close').onclick = () => $('detail-dialog').close(); $('save-override').onclick = () => saveOverride(); $('remove-override').onclick = () => saveOverride(true);
  $('import-close').onclick = () => $('import-dialog').close(); $('import-save').onclick = saveImport;
  $('import-header').onchange = () => renderImport(true); $('import-asin').onchange = () => renderImport(); $('import-sku').onchange = () => renderImport();
  $('import-sheet').onchange = async () => { if (!state.importBook) return; try { state.importRows = await state.importBook.rows(state.importBook.sheets.find(s => s.path === $('import-sheet').value)); $('import-header').value = state.importRows[0].row; renderImport(true); } catch (e) { $('import-error').textContent = e.message; } };
  ['dragenter', 'dragover'].forEach(name => $('dropzone').addEventListener(name, e => { e.preventDefault(); if (!state.busy) $('dropzone').classList.add('drag'); }));
  $('dropzone').ondragleave = () => $('dropzone').classList.remove('drag'); $('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('drag'); loadReport(e.dataTransfer.files[0]); };
  window.addEventListener('beforeunload', e => { if (state.busy || state.overrides.length) { e.preventDefault(); e.returnValue = ''; } });
  try { const data = JSON.parse(localStorage.getItem('revenue-sku-confirmed-v1') || '[]'); if (!Array.isArray(data) || data.length > 50000) throw new Error(); state.mappings = data.map(validateMapping); } catch (_) { toast('本地映射未能读取，可重新导入备份'); }
  window.SkuApp = {getState: () => state};
  render();
})();

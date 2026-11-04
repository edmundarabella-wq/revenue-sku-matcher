(function (root) {
  'use strict';
  const VERSION = 'HTML-20261104-1', EPS = 1e-6, TOL = .021;
  const fields = ['product sales', 'product sales tax', 'shipping credits', 'shipping credits tax',
    'gift wrap credits', 'giftwrap credits tax', 'regulatory fee', 'tax on regulatory fee',
    'promotional rebates', 'promotional rebates tax'];
  const text = v => v == null ? '' : String(v).trim();
  const groupKey = (order, kind, market) => JSON.stringify([text(order), kind, text(market).toLowerCase()]);
  const identityKey = (account, market, asin) => JSON.stringify([text(account), text(market).toLowerCase(), text(asin).toUpperCase()]);
  const number = v => typeof v === 'number' && Number.isFinite(v) ? v :
    typeof v === 'string' && /^[+-]?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
  function kind(v) {
    v = text(v).toUpperCase();
    if (['SALES', 'SALE', 'ORDER', 'BESTELLUNG', 'COMMANDE', 'PEDIDO', 'ORDINE', '注文', 'BESTELLING'].includes(v)) return 'ORDER';
    if (['RETURN', 'RETURNS', 'REFUND', 'REFUNDS', 'ERSTATTUNG', 'REMBOURSEMENT', 'REEMBOLSO', 'RIMBORSO', '返金', 'TERUGBETALING'].includes(v)) return 'REFUND';
    return '';
  }
  function index(map, key, value) { if (!map.has(key)) map.set(key, []); map.get(key).push(value); }
  function headers(rows, required, max = 30) {
    for (let i = 0; i < Math.min(rows.length, max); i++) {
      const map = new Map();
      for (let c = 0; c < rows[i].cells.length; c++) {
        const h = text(rows[i].cells[c]).replace(/\s+/g, ' ').toLowerCase();
        if (h) { if (map.has(h)) { map.set(h, -1); } else map.set(h, c); }
      }
      if (required.every(h => map.has(h))) {
        if ([...map.values()].includes(-1)) throw new Error('存在重复表头，请先核对源表。');
        return {row: rows[i].row, index: i, map};
      }
    }
    throw new Error('找不到所需表头：' + required.join('、'));
  }
  function prepare(revenueRows, backendRows) {
    const rh = headers(revenueRows, ['order_id', 'activity', 'asin', 'marketplace_name', 'account_id', 'total_in_original_currency']);
    const bh = headers(backendRows, ['order id', 'type', 'sku', 'quantity', 'marketplace', ...fields]);
    const get = (r, h, name) => h.map.has(name) ? r.cells[h.map.get(name)] : '';
    const revenue = revenueRows.slice(rh.index + 1).filter(r => r.cells.some(v => text(v) !== '')).map(r => ({
      row: r.row, order: text(get(r, rh, 'order_id')), asin: text(get(r, rh, 'asin')).toUpperCase(),
      activity: text(get(r, rh, 'activity')), kind: kind(get(r, rh, 'activity')),
      account: text(get(r, rh, 'account_id')), market: text(get(r, rh, 'marketplace_name')).toLowerCase(),
      date: get(r, rh, 'ship_date'), currency: text(get(r, rh, 'original_currency')),
      amount: number(get(r, rh, 'total_in_original_currency')), originalSku: text(get(r, rh, 'sku'))
    }));
    if (!revenue.length) throw new Error('Revenue没有有效记录。');
    const accounts = new Set(revenue.map(r => r.account).filter(Boolean));
    if (accounts.size !== 1) throw new Error('请每次选择一个账号的报表，不能混合多个账号。');
    const backend = backendRows.slice(bh.index + 1).map(r => {
      const qty = number(get(r, bh, 'quantity')), k = kind(get(r, bh, 'type'));
      let gross = 0, valid = true;
      for (const f of fields) {
        const v = get(r, bh, f); if (text(v) === '') continue;
        const n = number(v); if (n == null) valid = false; else gross += n;
      }
      const b = {row: r.row, order: text(get(r, bh, 'order id')), kind: k, sku: text(get(r, bh, 'sku')),
        market: text(get(r, bh, 'marketplace')).toLowerCase(), qty: qty == null ? 0 : Math.abs(qty), gross,
        date: get(r, bh, 'date/time')};
      b.valid = valid && !!b.sku && qty != null && b.qty > 0 && Math.abs(b.qty - Math.round(b.qty)) < EPS &&
        !((k === 'ORDER' && gross < -EPS) || (k === 'REFUND' && gross > EPS));
      return b;
    }).filter(b => b.kind && b.order);
    return {revenue, backend, rh: {row: rh.row, headers: Object.fromEntries(rh.map)}, account: [...accounts][0],
      markets: [...new Set(revenue.map(r => r.market))]};
  }
  function option(pool, target, remain) {
    const total = pool.reduce((s, b) => s + b.gross * remain.get(b.row) / b.qty, 0);
    const totalQty = pool.reduce((s, b) => s + remain.get(b.row), 0);
    if (Math.abs(total - target) <= TOL) return pool.map(b => ({row: b.row, qty: remain.get(b.row)}));
    const unit = pool[0].gross / pool[0].qty;
    if (Math.abs(unit) > EPS && pool.every(b => Math.abs(b.gross / b.qty - unit) < EPS)) {
      let needed = Math.round(target / unit);
      if (needed <= 0 || needed > totalQty + EPS || Math.abs(needed * unit - target) > TOL) return null;
      const allocations = [];
      for (const b of pool) { const qty = Math.min(remain.get(b.row), needed); if (qty > EPS) allocations.push({row: b.row, qty}); needed -= qty; if (needed < EPS) break; }
      return allocations;
    }
    const hits = pool.filter(b => Math.abs(b.gross * remain.get(b.row) / b.qty - target) <= TOL);
    if (hits.length && hits.every(b => Math.abs(remain.get(b.row) - remain.get(hits[0].row)) < EPS)) return [{row: hits[0].row, qty: remain.get(hits[0].row)}];
    return null;
  }
  async function match(input, mappings = [], overrides = [], progress = () => {}, signal = null) {
    const check = () => { if (signal && signal.aborted) throw new Error('已取消'); };
    const {revenue, backend} = input, rg = new Map(), bg = new Map(), learned = new Map(), confirmed = new Map();
    const remain = new Map(backend.map(b => [b.row, b.qty])), byBackend = new Map(backend.map(b => [b.row, b]));
    const results = revenue.map(r => ({...r, sku: '', status: r.kind ? 'review' : 'excluded', reason: r.kind ? '没有可靠的同订单、同业务类型和站点候选' : '非销售或退款业务',
      qty: null, gross: null, difference: null, refs: [], candidates: [], evidence: '', manual: false}));
    const byRow = new Map(results.map(r => [r.row, r]));
    for (const r of results) if (r.kind && r.order && r.account && r.market && r.asin && r.amount != null) index(rg, groupKey(r.order, r.kind, r.market), r);
    for (const b of backend) index(bg, groupKey(b.order, b.kind, b.market), b);
    for (const r of results) if (r.kind && (!r.order || !r.account || !r.market || !r.asin || r.amount == null)) r.reason = '源记录缺少订单、账号、站点、ASIN或有效金额';
    for (const [key, rr] of rg) {
      const bb = bg.get(key) || [];
      if (rr[0].kind !== 'ORDER' || !bb.length || !bb.every(b => b.valid)) continue;
      if (new Set(rr.map(r => r.asin)).size !== 1 || new Set(bb.map(b => b.sku)).size !== 1) continue;
      if (Math.abs(rr.reduce((s, r) => s + r.amount, 0) - bb.reduce((s, b) => s + b.gross, 0)) > TOL) continue;
      const id = identityKey(rr[0].account, rr[0].market, rr[0].asin);
      if (!learned.has(id)) learned.set(id, new Map());
      const m = learned.get(id); if (!m.has(bb[0].sku)) m.set(bb[0].sku, []);
      m.get(bb[0].sku).push(rr[0].order);
    }
    for (const m of mappings) {
      if (!text(m.account) || !text(m.market) || !text(m.asin) || !text(m.sku)) continue;
      const id = identityKey(m.account, m.market, m.asin);
      if (!confirmed.has(id)) confirmed.set(id, new Set()); confirmed.get(id).add(text(m.sku));
    }
    const identities = r => confirmed.get(identityKey(r.account, r.market, r.asin)) ||
      (learned.has(identityKey(r.account, r.market, r.asin)) ? new Set(learned.get(identityKey(r.account, r.market, r.asin)).keys()) : null);
    function assign(r, allocations, reason, manual = false) {
      if (!allocations.length) throw new Error('未选择后台来源记录');
      const combined = new Map();
      for (const a of allocations) { const q = number(a.qty); if (q == null || q <= 0 || Math.abs(q - Math.round(q)) > EPS) throw new Error('后台匹配数量必须是正整数'); combined.set(a.row, (combined.get(a.row) || 0) + q); }
      const refs = []; let sku = '', qty = 0, gross = 0;
      for (const [row, q] of combined) {
        const b = byBackend.get(row);
        if (!b || !b.valid || b.order !== r.order || b.kind !== r.kind || b.market !== r.market) throw new Error('来源行不属于当前订单、业务类型或站点');
        if (sku && sku !== b.sku) throw new Error('一行Revenue不能混入不同SKU');
        if (q > remain.get(row) + EPS) throw new Error('后台来源数量已被其他记录占用');
        sku = b.sku; qty += q; gross += b.gross * q / b.qty; refs.push({row, qty: q});
      }
      for (const a of refs) remain.set(a.row, remain.get(a.row) - a.qty);
      Object.assign(r, {sku, qty, gross, difference: Math.round((r.amount - gross) * 1e8) / 1e8, refs, reason,
        status: manual ? 'manual' : 'matched', manual});
    }
    // Explicit row corrections reserve their sources before automatic matching.
    for (const o of [...overrides].sort((a, b) => a.row - b.row)) {
      const r = byRow.get(o.row); if (!r) throw new Error('本行修正不属于当前报表');
      if (!r.kind || r.amount == null) throw new Error('源行金额或业务类型无效，不能人工覆盖');
      try { assign(r, o.allocations, '人工确认本行；' + text(o.note), true); }
      catch (e) { throw new Error('Revenue第' + r.row + '行修正无效：' + e.message); }
    }
    let done = 0;
    for (const [key, rr] of rg) {
      check(); const bb = bg.get(key) || [];
      for (const r of rr) {
        const ids = identities(r), isConfirmed = confirmed.has(identityKey(r.account, r.market, r.asin));
        r.evidence = ids ? (isConfirmed ? '已确认映射：' : '本次单SKU订单识别：') + [...ids].join('；') : '缺少可靠ASIN映射';
        r.candidates = [...new Set(bb.map(b => b.sku))];
      }
      if (bb.length) {
        let changed;
        do {
          changed = false;
          for (const r of rr) {
            if (r.sku) continue;
            const ids = identities(r), invalid = bb.some(b => !b.valid), pools = new Map(), options = [];
            for (const b of bb) if (b.valid && remain.get(b.row) > EPS && (!ids || ids.has(b.sku)) &&
              ((Math.abs(r.amount) < EPS) === (Math.abs(b.gross) < EPS))) index(pools, b.sku, b);
            if (!invalid) for (const [sku, pool] of pools) {
              if (Math.abs(r.amount) < EPS && !(rr.length === 1 && bb.length === 1)) continue;
              const allocations = option(pool, r.amount, remain); if (allocations) options.push({sku, allocations});
            }
            let picked = options.length === 1 ? options[0].allocations : null;
            let reason = '同订单、业务类型和站点金额对应' + (ids ? '；ASIN身份核对' : '');
            if (!picked && !invalid && rr.length === 1 && bb.length === 1) {
              const b = bb[0]; if (remain.get(b.row) > EPS && (!ids || ids.has(b.sku))) { picked = [{row: b.row, qty: remain.get(b.row)}]; reason = '唯一业务记录；金额差异仅提醒'; }
            }
            if (!picked && options.length === 0 && !invalid && ids) {
              const live = bb.filter(b => b.valid && remain.get(b.row) > EPS && ids.has(b.sku));
              if (live.length === 1) {
                const b = live[0];
                const peers = rr.filter(other => !other.sku && (!identities(other) || identities(other).has(b.sku)));
                if (peers.length === 1) { picked = [{row: b.row, qty: remain.get(b.row)}]; reason = '独立ASIN证据确认唯一来源；金额差异仅提醒'; }
              }
            }
            if (picked) { assign(r, picked, reason); changed = true; }
            else r.reason = invalid ? '同组后台存在无效金额、数量或SKU，需核对来源' :
              ids && !bb.some(b => ids.has(b.sku)) ? 'ASIN映射与当前订单SKU不一致' :
              '同价多SKU、金额或数量分配仍不唯一';
          }
        } while (changed);
      }
      done += rr.length;
      if (done % 150 < rr.length) { progress(done / revenue.length, done); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    check();
    const seen = new Map();
    for (const r of results) for (const a of r.refs) seen.set(a.row, (seen.get(a.row) || 0) + a.qty);
    for (const [row, q] of seen) if (q > byBackend.get(row).qty + EPS) throw new Error('后台数量守恒检查未通过');
    const learnedRows = [];
    for (const [key, skus] of learned) {
      const [account, market, asin] = JSON.parse(key);
      for (const [sku, orders] of skus) learnedRows.push({account, market, asin, sku, source: '本次识别', orders: orders.slice(0, 5), count: orders.length});
    }
    const stats = {total: results.length, matched: results.filter(r => r.status === 'matched').length,
      manual: results.filter(r => r.status === 'manual').length, review: results.filter(r => r.status === 'review').length,
      excluded: results.filter(r => r.status === 'excluded').length, warnings: results.filter(r => r.sku && Math.abs(r.difference) > TOL).length};
    progress(1, revenue.length);
    return {results, stats, learned: learnedRows, version: VERSION};
  }
  root.SkuEngine = {VERSION, TOL, EPS, fields, text, number, kind, groupKey, identityKey, headers, prepare, match};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SkuEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);

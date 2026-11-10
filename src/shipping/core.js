/* 出货匹配核心：无网络、无文件修改。 */
(function (root) {
  'use strict';
  const DEFAULT_SIZES = ['5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','11','12','10.5'];
  const str = v => v == null ? '' : String(v).trim();
  const numericSize = v => { const s = str(v); return /^\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s; };
  const key = v => str(v).replace(/[－–—]/g, '-').replace(/\s*-\s*/g, '-').replace(/-(\d+(?:\.\d+)?)$/, (_, n) => '-' + numericSize(n));
  function parseText(text) {
    if (text.length > 4e6) throw Error('粘贴内容过大，请拆分为每次 20,000 行以内。');
    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const delimiter = text.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i=0;i<text.length;i++) {
      const c=text[i];
      if(c==='"' && (quoted || cell==='')) { if(quoted && text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
      else if(!quoted && (c===delimiter || c==='\n')) {row.push(cell);cell='';if(c==='\n'){rows.push(row);row=[];}}
      else cell+=c;
    }
    if (quoted) throw Error('粘贴内容有未闭合的双引号，请重新复制完整区域。');
    row.push(cell);rows.push(row);
    while(rows.length && rows.at(-1).every(v=>!str(v))) rows.pop();
    if(rows.length>20000) throw Error('最多支持 20,000 行，请分批处理。');
    return rows;
  }
  function quantity(v, label, errors) {
    if(!str(v)) return 0;
    const n=Number(str(v));
    if(!Number.isSafeInteger(n)||n<0){errors.push(label+'：数量必须是大于或等于 0 的整数。');return 0;}
    return n;
  }
  function summarize(items, errors=[], warnings=[]) {
    const map=new Map(); let duplicates=0;
    for(const x of items){ const k=key(x.sku); if(map.has(k)){map.get(k).qty+=x.qty;duplicates++;}else map.set(k,{sku:k,qty:x.qty}); }
    const records=[...map.values()];
    if(duplicates) warnings.push('已合并 '+duplicates+' 条重复货号，数量相加。');
    const total=records.reduce((s,r)=>s+r.qty,0);
    if(!Number.isSafeInteger(total)) errors.push('数量合计过大，请检查原始数据。');
    return {records,total,errors,warnings};
  }
  function convertFixed(rows,sizes=DEFAULT_SIZES){
    const items=[],errors=[],warnings=[];
    rows.forEach((r,i)=>{
      if(r.every(v=>!str(v)))return;
      if(/^(合计|总计|小计)/.test(str(r[0])))return;
      if(str(r[0])==='货号'&&str(r[1])==='颜色')return;
      if(r.slice(sizes.length+2).some(v=>str(v))) errors.push('第 '+(i+1)+' 行超出当前表头列数，请先添加尺码列或改用带表头文件导入。');
      let rowTotal=0;
      sizes.forEach((size,j)=>{
        const qty=quantity(r[j+2],'第 '+(i+1)+' 行 / '+size+' 码',errors);rowTotal+=qty;
        if(qty>0){if(!str(r[0])||!str(r[1]))return;items.push({sku:str(r[0])+'-'+str(r[1])+'-'+numericSize(size),qty});}
      });
      if(rowTotal>0&&(!str(r[0])||!str(r[1])))errors.push('第 '+(i+1)+' 行有数量，但货号或颜色为空。');
    });
    return summarize(items,errors,warnings);
  }
  function convertDetail(rows){
    const items=[],errors=[];
    rows.forEach((r,i)=>{if(r.every(v=>!str(v))||/^(货号|SKU|sku)$/.test(str(r[0])))return;
      if(/^(合计|总计|小计)/.test(str(r[0])))return;
      const qty=quantity(r[1],'第 '+(i+1)+' 行',errors);
      if(!str(r[0])&&qty)errors.push('第 '+(i+1)+' 行货号为空。');
      if(r.slice(2).some(v=>str(v))) errors.push('第 '+(i+1)+' 行不止两列，请选择“尺码数量表”或只粘贴货号、数量两列。');
      if(qty&&str(r[0]))items.push({sku:str(r[0]),qty});
    });return summarize(items,errors);
  }
  function importSupplier(rows,fallbackSizes=DEFAULT_SIZES){
    const hi=rows.findIndex(r=>str(r[0])==='货号'&&str(r[1])==='颜色');
    if(hi<0) {
      const detail=rows.some(r=>/^(货号|SKU|sku)$/.test(str(r[0]))&&str(r[1])==='数量');
      if(detail)return {mode:'detail',rows:rows.filter(r=>str(r[0])!=='货号'),sizes:fallbackSizes,warnings:[]};
      return {mode:'fixed',rows,sizes:fallbackSizes,warnings:[]};
    }
    const upper=rows[hi], lower=rows[hi+1]||[];
    const hasLower=!str(lower[0])&&!str(lower[1])&&lower.slice(2).filter(v=>/^\d+(\.\d+)?$/.test(str(v))).length>=3;
    const head=hasLower?lower:upper,cols=[];
    head.forEach((v,i)=>{if(i>=2&&/^\d+(\.\d+)?$/.test(str(v)))cols.push({i,size:numericSize(v)});});
    if(!cols.length)throw Error('没有找到尺码表头，请使用固定表头粘贴，或导入含数字尺码表头的文件。');
    if(new Set(cols.map(c=>c.size)).size!==cols.length)throw Error('尺码表头重复，请先在原表中确认各列尺码。');
    const sizes=[...fallbackSizes];cols.forEach(c=>{if(!sizes.includes(c.size))sizes.push(c.size);});
    const totalCol=upper.findIndex(v=>/^(双数|数量|合计|总计)$/.test(str(v))),warnings=[];
    const data=rows.slice(hi+(hasLower?2:1)).filter(r=>r.some(v=>str(v))&&!/^(合计|总计|小计)/.test(str(r[0])));
    const output=data.map((r,idx)=>{
      const rr=[r[0]||'',r[1]||'',...sizes.map(s=>{const c=cols.find(c=>c.size===s);return c?r[c.i]??'':'';})];
      if(totalCol>=0&&str(r[totalCol])){const sum=cols.reduce((a,c)=>a+(Number(r[c.i])||0),0);if(sum!==Number(r[totalCol]))warnings.push('原表第 '+(hi+(hasLower?3:2)+idx)+' 行的尺码数量合计与“双数”不一致。');}
      return rr;
    });
    const foot=rows.find(r=>/^合计[：:]\s*\d+/.test(str(r[0])));
    if(foot){const n=Number(str(foot[0]).match(/\d+/)[0]);const actual=output.reduce((a,r)=>a+r.slice(2).reduce((b,v)=>b+(Number(v)||0),0),0);if(n!==actual)warnings.push('原表标注合计 '+n+' 双，按尺码列统计为 '+actual+' 双，请核对。');}
    return {mode:'fixed',rows:output,sizes,warnings};
  }
  function isOrderHeader(row){return /^(订单|采购.*单|单号|编号)/.test(str(row[0]))&&/货号|SKU|sku|商品/.test(str(row[1]));}
  function orderDataRows(rows){
    const data=rows.map(r=>[...r]);
    if(data.length&&isOrderHeader(data[0]))data.shift();
    while(data.length&&data.at(-1).every(v=>!str(v)))data.pop();
    return data;
  }
  function today(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const part=type=>parts.find(p=>p.type===type).value;
    return part('year')+'/'+part('month')+'/'+part('day');
  }
  function gridSummary(rows,sizes=DEFAULT_SIZES){
    const columns=sizes.map(()=>0);let total=0,valid=true,activeRows=0;
    const rowTotals=rows.map(row=>{let sum=0,ok=true;
      if(/^(合计|总计|小计)/.test(str(row[0]))||(str(row[0])==='货号'&&str(row[1])==='颜色'))return 0;
      sizes.forEach((_,j)=>{const v=str(row[j+2]),n=v?Number(v):0;
        if(!Number.isSafeInteger(n)||n<0){ok=false;valid=false;columns[j]=null;}
        else{sum+=n;if(columns[j]!==null)columns[j]+=n;}
      });
      if(!Number.isSafeInteger(sum)){ok=false;valid=false;}
      if(sum>0)activeRows++;
      total+=sum;return ok?sum:null;
    });
    if(!Number.isSafeInteger(total))valid=false;
    return {rowTotals,columns,total:valid?total:null,activeRows};
  }
  function parseOrders(rows){
    const records=[],errors=[],warnings=[];const pairs=new Set();let duplicate=0;
    orderDataRows(rows).forEach((r,i)=>{
      if(r.every(v=>!str(v))){records.push({id:'',sku:'',sourceRow:i+1,empty:true});return;}
      if(isOrderHeader(r)){errors.push('第 '+(i+1)+' 行出现重复表头，请删除后继续，以免回填时错行。');return;}
      if(!str(r[0])||!str(r[1])){errors.push('第 '+(i+1)+' 行缺少订单编号或采购货号。');return;}
      if(typeof r[0]==='number'&&!Number.isSafeInteger(r[0])){errors.push('第 '+(i+1)+' 行订单编号已按超长数字存储，可能丢失精度。请将原始准确编号以文本格式复制粘贴。');return;}
      if(/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(str(r[0]))){errors.push('第 '+(i+1)+' 行订单编号是科学计数法，请复制完整的文本编号。');return;}
      const id=str(r[0]),sku=str(r[1]),pair=id+'\u0000'+key(r[1]);
      if(pairs.has(pair))duplicate++;pairs.add(pair);
      records.push({id,sku,sourceRow:i+1});
    });
    if(duplicate)warnings.push('有 '+duplicate+' 行订单编号与货号重复；每行仍按一双参与分配，请核对是否重复粘贴。');
    if(rows.some(r=>r.slice(2).some(v=>str(v))))warnings.push('只使用前两列：订单编号、采购货号。原有 C 列及之后的内容不参与匹配。');
    return {records,errors,warnings,count:records.filter(r=>!r.empty).length};
  }
  function match(supply,orders,mode='date',matchDate=today()){
    if(!['date','one','total'].includes(mode))throw Error('请选择有效的 C 列回填方式。');
    const stock=new Map(supply.map(r=>[key(r.sku),{sku:r.sku,total:r.qty,left:r.qty}]));
    const rows=orders.map(o=>{if(o.empty)return {...o,value:'',matched:false,status:''};const s=stock.get(key(o.sku));const matched=!!s&&s.left>0;if(matched)s.left--;return {...o,value:matched?(mode==='date'?matchDate:mode==='one'?1:s.total):'',matched,status:matched?'已匹配':s?'出货数量不足':'出货单无此货号'};});
    const inventory=[...stock.values()].map(s=>({sku:s.sku,total:s.total,allocated:s.total-s.left,left:s.left}));
    const matched=rows.filter(r=>r.matched).length;const total=supply.reduce((a,r)=>a+r.qty,0);
    if(total!==matched+inventory.reduce((a,r)=>a+r.left,0))throw Error('数量核对未通过，请检查输入。');
    const orderCount=orders.filter(o=>!o.empty).length;
    return {rows,inventory,total,matched,unmatched:orderCount-matched,left:total-matched,mode,matchDate:mode==='date'?matchDate:'',orderCount};
  }
  const api={DEFAULT_SIZES,str,key,numericSize,parseText,convertFixed,convertDetail,importSupplier,parseOrders,match,isOrderHeader,orderDataRows,today,gridSummary};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ShippingCore=api;
})(typeof window!=='undefined'?window:globalThis);

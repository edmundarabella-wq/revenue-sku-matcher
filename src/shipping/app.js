(function(){
  'use strict';
  const C=ShippingCore, $=id=>document.getElementById(id), text=(el,s)=>el.textContent=s;
  const el=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
  const state={sizes:[...C.DEFAULT_SIZES],grid:[],orderGrid:Array.from({length:8},()=>['','']),mode:'fixed',supply:null,orders:null,result:null,orderImportWarnings:[],importWarnings:[],view:'orders',filter:'all',page:0,gridPage:0,orderGridPage:0,orderPreviewPage:0,step:1};
  try{const saved=JSON.parse(localStorage.getItem('shipping-template-v1'));if(Array.isArray(saved)&&saved.length&&saved.length<=60&&saved.every(s=>/^\d+(\.\d+)?$/.test(s))&&new Set(saved.map(C.numericSize)).size===saved.length)state.sizes=saved.map(C.numericSize);}catch{}
  function saveSizes(){try{localStorage.setItem('shipping-template-v1',JSON.stringify(state.sizes));}catch{}}
  const emptyRow=()=>Array(state.sizes.length+2).fill('');
  state.grid=Array.from({length:8},emptyRow);
  let toastTimer, supplyTimer, orderTimer;
  function toast(s){text($('toast'),s);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
  function message(box,errors=[],warnings=[]){box.replaceChildren();errors.slice(0,6).forEach(s=>box.append(el('div','message error',s)));if(errors.length>6)box.append(el('div','message error','另有 '+(errors.length-6)+' 处错误，请逐行核对。'));warnings.slice(0,5).forEach(s=>box.append(el('div','message',s)));if(warnings.length>5)box.append(el('div','message','另有 '+(warnings.length-5)+' 条提醒。'));}
  function invalidate(){state.result=null;$('exportAll').disabled=true;$('resultBody').hidden=true;$('resultEmpty').hidden=false;text($('navResult'),'核对结果，完成今日出货');}
  function goto(n){state.step=n;document.querySelectorAll('.step-panel').forEach((p,i)=>p.hidden=i!==n-1);document.querySelectorAll('.nav-step').forEach(b=>{b.classList.toggle('active',Number(b.dataset.step)===n);if(Number(b.dataset.step)===n)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});text($('breadcrumb'),['录入出货单','录入采购单','匹配与导出','装箱分配'][n-1]);$('demoBtn').hidden=n===4;if(n===2)updateDateLabel();window.scrollTo({top:0,behavior:'instant'});}
  function updateDateLabel(){text($('returnMode').querySelector('[value="date"]'),'今日日期（'+C.today()+'，默认）');}
  document.querySelectorAll('.nav-step').forEach(b=>b.onclick=()=>goto(Number(b.dataset.step)));
  function table(headers,rows,limit=50){const t=el('table');const head=el('thead'),hr=el('tr');headers.forEach(h=>hr.append(el('th','',h)));head.append(hr);t.append(head);const body=el('tbody');rows.slice(0,limit).forEach(row=>{const tr=el('tr');row.forEach(v=>{const td=el('td');if(v instanceof Node)td.append(v);else td.textContent=v==null?'':v;tr.append(td);});body.append(tr);});t.append(body);return t;}
  function updateSupply(){
    clearTimeout(supplyTimer);invalidate();let r;
    try{r=state.mode==='fixed'?C.convertFixed(state.grid,state.sizes):C.convertDetail(C.parseText($('detailText').value));}catch(e){r={records:[],total:0,errors:[e.message],warnings:[]};}
    state.supply=r;message($('supplyMessages'),r.errors,[...state.importWarnings,...r.warnings]);const valid=r.records.length>0&&!r.errors.length;
    if(state.mode==='fixed')updateGridTotals();
    $('nextOrders').disabled=!valid;$('exportSupply').disabled=!valid;
    text($('supplyCount'),r.records.length+' 个货号 / '+r.total+' 双');text($('supplySummary'),valid?'已识别 '+r.records.length+' 个货号，共 '+r.total+' 双':r.errors.length?'请先修正出货数据中的错误':'先粘贴或导入今天的出货单');
    text($('navSupply'),valid?r.total+' 双出货已录入':'固定表头，直接粘贴');text($('check1'),valid?'✓':'');
    $('supplyPreview').replaceChildren();if(r.records.length){$('supplyPreview').append(table(['货号','数量'],r.records.map(x=>[x.sku,x.qty])));if(r.records.length>50)$('supplyPreview').append(el('div','preview-more','预览前 50 条，匹配和导出包含全部 '+r.records.length+' 个货号。'));}else $('supplyPreview').append(el('div','empty-inline','粘贴出货数据后，这里会显示展开的货号与数量。'));
    updateRunButton();
  }
  const gridFooter=$('gridArea').querySelector('.grid-footer');const gridPager=el('div','grid-pager');const gp=el('button','quiet','上一页'),gl=el('span'),gn=el('button','quiet','下一页');gridPager.append(gp,gl,gn);gridFooter.insertBefore(gridPager,$('clearSupply'));gp.onclick=()=>{state.gridPage--;renderGrid();};gn.onclick=()=>{state.gridPage++;renderGrid();};
  let dragging=null;
  function renderGrid(){
    const pages=Math.max(1,Math.ceil(state.grid.length/50));state.gridPage=Math.max(0,Math.min(pages-1,state.gridPage));
    gridPager.hidden=pages===1;text(gl,(state.gridPage+1)+' / '+pages);gp.disabled=state.gridPage===0;gn.disabled=state.gridPage===pages-1;
    const t=$('supplyGrid');t.replaceChildren();const head=el('thead'),hr=el('tr');hr.append(el('th','','#'));
    ['货号','颜色',...state.sizes].forEach((h,i)=>{const th=el('th','',h);th.scope='col';if(i>=2){th.draggable=true;th.title='拖动调整尺码顺序，也可点击“调整尺码列”使用左右按钮';th.ondragstart=e=>{dragging=i-2;e.dataTransfer.setData('text/plain',String(i-2));};th.ondragover=e=>{e.preventDefault();th.classList.add('drag-over');};th.ondragleave=()=>th.classList.remove('drag-over');th.ondrop=e=>{e.preventDefault();if(dragging!=null)moveColumn(dragging,i-2);dragging=null;};th.ondragend=()=>{dragging=null;document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));};}hr.append(th);});hr.append(el('th','supply-total','每行合计'));head.append(hr);t.append(head);const body=el('tbody');
    state.grid.slice(state.gridPage*50,state.gridPage*50+50).forEach((row,j)=>{const ri=state.gridPage*50+j,tr=el('tr');tr.append(el('td','',ri+1));for(let col=0;col<state.sizes.length+2;col++){const td=el('td'),input=el('input');input.value=row[col]??'';input.dataset.row=ri;input.dataset.col=col;input.setAttribute('aria-label','第 '+(ri+1)+' 行 '+(['货号','颜色',...state.sizes][col]));if(col>=2)input.inputMode='numeric';input.addEventListener('input',()=>{state.grid[ri][col]=input.value;state.importWarnings=[];invalidate();clearTimeout(supplyTimer);supplyTimer=setTimeout(updateSupply,180);});td.append(input);tr.append(td);}const total=el('td','supply-total');total.dataset.totalRow=ri;tr.append(total);body.append(tr);});t.append(body);
    const foot=el('tfoot'),fr=el('tr'),label=el('th','','全部行汇总');label.colSpan=3;fr.append(label);state.sizes.forEach((_,j)=>{const td=el('td','column-total');td.dataset.totalCol=j;fr.append(td);});const grand=el('td','supply-total');grand.id='gridGrandTotal';fr.append(grand);foot.append(fr);t.append(foot);updateGridTotals();
  }
  function updateGridTotals(){const s=C.gridSummary(state.grid,state.sizes),bad=state.supply?.errors.length>0;
    $('supplyGrid').querySelectorAll('[data-total-row]').forEach(td=>{const n=s.rowTotals[Number(td.dataset.totalRow)];text(td,n===null?'待修正':n);});
    $('supplyGrid').querySelectorAll('[data-total-col]').forEach(td=>{const n=s.columns[Number(td.dataset.totalCol)];text(td,n===null?'待修正':n);});
    if($('gridGrandTotal'))text($('gridGrandTotal'),bad||s.total===null?'待修正':s.total);
    text($('supplyGrandTotal'),bad||s.total===null?'待修正':s.total);text($('supplyRowCount'),s.activeRows+' 行有出货');text($('supplySkuCount'),(state.supply?.records.length||0)+' 个货号');
  }
  $('supplyGrid').addEventListener('paste',e=>{
    const input=e.target.closest('input');if(!input)return;const raw=e.clipboardData.getData('text/plain');if(!raw.includes('\t')&&!raw.includes('\n'))return;e.preventDefault();
    try{const rows=C.parseText(raw);let start=Number(input.dataset.row),col=Number(input.dataset.col);
      if(rows.some(r=>r.length+col>state.sizes.length+2))throw Error('粘贴列数超出当前表头。请先添加尺码，或只复制对应的数据列。');
      if(start+rows.length>20000)throw Error('最多支持 20,000 行，请分批处理。');
      while(state.grid.length<start+rows.length)state.grid.push(emptyRow());rows.forEach((r,i)=>r.forEach((v,j)=>state.grid[start+i][col+j]=v));state.importWarnings=[];renderGrid();updateSupply();toast('已填入 '+rows.length+' 行出货数据');
    }catch(err){toast(err.message);}
  });
  $('supplyGrid').addEventListener('keydown',e=>{const input=e.target.closest('input');if(!input||e.key!=='Enter')return;e.preventDefault();const row=Number(input.dataset.row)+1,col=Number(input.dataset.col);if(row>=20000)return;if(row>=state.grid.length)state.grid.push(emptyRow());state.gridPage=Math.floor(row/50);renderGrid();$('supplyGrid').querySelector('input[data-row="'+row+'"][data-col="'+col+'"]').focus();});
  function setMode(mode){state.mode=mode;$('modeFixed').classList.toggle('selected',mode==='fixed');$('modeDetail').classList.toggle('selected',mode==='detail');$('gridArea').hidden=mode!=='fixed';$('fixedTools').hidden=mode!=='fixed';$('detailArea').hidden=mode!=='detail';state.importWarnings=[];updateSupply();}
  $('modeFixed').onclick=()=>setMode('fixed');$('modeDetail').onclick=()=>setMode('detail');
  $('detailText').oninput=()=>{invalidate();clearTimeout(supplyTimer);supplyTimer=setTimeout(updateSupply,250);};$('readDetail').onclick=updateSupply;
  $('clearSupply').onclick=()=>{if(state.grid.some(r=>r.some(C.str))&&!confirm('清空本次出货数据？尺码表头会保留。'))return;state.grid=Array.from({length:8},emptyRow);state.gridPage=0;state.importWarnings=[];renderGrid();updateSupply();};
  $('pasteSupplyBtn').onclick=()=>{text($('pasteTitle'),state.mode==='fixed'?'粘贴出货数据行':'粘贴货号与数量');text($('pasteHint'),'识别后将替换当前出货数据。只复制对应列的数据行即可。');text($('pasteTemplate'),state.mode==='fixed'?['货号','颜色',...state.sizes].join('  |  '):'货号  |  数量');$('pasteText').value='';$('pasteError').replaceChildren();$('pasteDialog').showModal();$('pasteText').focus();};
  $('cancelPaste').onclick=()=>$('pasteDialog').close();
  $('applyPaste').onclick=()=>{try{const rows=C.parseText($('pasteText').value);if(!rows.length)throw Error('请先粘贴出货数据。');if(state.mode==='fixed'){
      const imported=C.importSupplier(rows,state.sizes);if(imported.mode==='detail')throw Error('这是两列明细，请先切换到“已转换的两列明细”。');
      const r=C.convertFixed(imported.rows,imported.sizes);if(r.errors.length)throw Error(r.errors.slice(0,3).join('\n'));if(!r.records.length)throw Error('没有识别到大于 0 的数量，请检查所复制的列。');
      state.sizes=imported.sizes;state.grid=imported.rows;while(state.grid.length<8)state.grid.push(emptyRow());state.gridPage=0;state.importWarnings=imported.warnings;saveSizes();renderGrid();
    }else{$('detailText').value=$('pasteText').value;state.importWarnings=[];}
    updateSupply();$('pasteDialog').close();toast('已识别出货数据，请核对转换明细');}catch(e){message($('pasteError'),[e.message]);}};
  function moveColumn(from,to){if(from===to)return;state.grid.forEach(r=>{while(r.length<state.sizes.length+2)r.push('');});const [size]=state.sizes.splice(from,1);state.sizes.splice(to,0,size);state.grid.forEach(r=>{const [v]=r.splice(from+2,1);r.splice(to+2,0,v??'');});saveSizes();renderGrid();renderColumns();updateSupply();}
  function renderColumns(){const list=$('columnList');list.replaceChildren();state.sizes.forEach((size,i)=>{const item=el('div','column-item');item.draggable=true;item.append(el('span','',i+1),el('span','col-label',size+' 码'));const left=el('button','btn','←'),right=el('button','btn','→'),remove=el('button','btn','删除');left.setAttribute('aria-label',size+' 码向左移');right.setAttribute('aria-label',size+' 码向右移');left.disabled=i===0;right.disabled=i===state.sizes.length-1;left.onclick=()=>moveColumn(i,i-1);right.onclick=()=>moveColumn(i,i+1);remove.onclick=()=>{if(state.grid.some(r=>C.str(r[i+2])))return message($('colsMessage'),[],['此列已有数据，请先清空该列再删除。']);if(state.sizes.length===1)return;state.sizes.splice(i,1);state.grid.forEach(r=>r.splice(i+2,1));saveSizes();renderColumns();renderGrid();updateSupply();};item.append(left,right,remove);item.ondragstart=e=>{dragging=i;e.dataTransfer.setData('text/plain',String(i));};item.ondragover=e=>{e.preventDefault();item.classList.add('drag-over');};item.ondragleave=()=>item.classList.remove('drag-over');item.ondrop=e=>{e.preventDefault();if(dragging!=null)moveColumn(dragging,i);dragging=null;};item.ondragend=()=>{dragging=null;document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));};list.append(item);});}
  $('manageCols').onclick=()=>{renderColumns();$('colsMessage').replaceChildren();$('colsDialog').showModal();};$('doneCols').onclick=()=>$('colsDialog').close();
  function addSize(){const size=C.numericSize($('newSize').value);if(!/^\d+(\.\d+)?$/.test(size)||Number(size)<=0)return message($('colsMessage'),['请输入有效的数字尺码，例如 13 或 13.5。']);if(state.sizes.includes(size))return message($('colsMessage'),['该尺码已存在，无需重复添加。']);if(state.sizes.length>=60)return message($('colsMessage'),['最多支持 60 个尺码列。']);state.sizes.push(size);state.grid.forEach(r=>r.push(''));$('newSize').value='';message($('colsMessage'),[],[size+' 码已添加到最后，可用左右按钮移动。']);saveSizes();renderColumns();renderGrid();updateSupply();}
  $('addSize').onclick=addSize;$('newSize').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addSize();}};
  $('resetSizes').onclick=()=>{const desired=[...C.DEFAULT_SIZES,...state.sizes.filter(s=>!C.DEFAULT_SIZES.includes(s))];const old=[...state.sizes];state.grid=state.grid.map(r=>[r[0],r[1],...desired.map(s=>old.includes(s)?r[old.indexOf(s)+2]??'':'')]);state.sizes=desired;saveSizes();renderColumns();renderGrid();updateSupply();message($('colsMessage'),[],['默认尺码顺序已恢复，自定义尺码与已有数据均保留。']);};
  function updateOrders(){
    clearTimeout(orderTimer);invalidate();let r;
    try{r=C.parseOrders(state.orderGrid);}catch(e){r={records:[],count:0,errors:[e.message],warnings:[]};}
    state.orders=r;message($('ordersMessages'),r.errors,[...state.orderImportWarnings,...r.warnings]);
    const count=r.count||0,blank=r.records.filter(o=>o.empty).length,valid=count>0&&!r.errors.length;
    text($('ordersCount'),count+' 行订单'+(blank?' / 保留 '+blank+' 个空行':''));
    text($('ordersSummary'),r.errors.length?'请修正采购订单中的错误':'已录入 '+count+' 行采购订单，保持原始行序');
    text($('navOrders'),valid?count+' 行订单已录入':'订单编号与采购货号');text($('check2'),valid?'✓':'');
    renderOrderPreview();updateRunButton();
  }
  const orderPager=el('div','grid-pager'),op=el('button','quiet','上一页'),ol=el('span'),on=el('button','quiet','下一页');orderPager.append(op,ol,on);$('ordersGridFooter').insertBefore(orderPager,$('clearOrders'));
  op.onclick=()=>{state.orderGridPage--;renderOrdersGrid();};on.onclick=()=>{state.orderGridPage++;renderOrdersGrid();};
  function renderOrdersGrid(){
    const pages=Math.max(1,Math.ceil(state.orderGrid.length/50));state.orderGridPage=Math.max(0,Math.min(pages-1,state.orderGridPage));orderPager.hidden=pages===1;text(ol,(state.orderGridPage+1)+' / '+pages);op.disabled=state.orderGridPage===0;on.disabled=state.orderGridPage===pages-1;
    const t=$('ordersGrid');t.replaceChildren();const head=el('thead'),hr=el('tr');['原始行序','A列 · 订单编号','B列 · 采购货号'].forEach(h=>hr.append(el('th','',h)));head.append(hr);t.append(head);const body=el('tbody');
    state.orderGrid.slice(state.orderGridPage*50,state.orderGridPage*50+50).forEach((row,j)=>{const ri=state.orderGridPage*50+j,tr=el('tr');tr.append(el('td','',ri+1));
      for(let col=0;col<2;col++){const td=el('td'),input=el('input');input.value=row[col]??'';input.dataset.row=ri;input.dataset.col=col;input.setAttribute('aria-label','采购第 '+(ri+1)+' 行 '+(col===0?'订单编号':'采购货号'));input.addEventListener('input',()=>{state.orderGrid[ri][col]=input.value;invalidate();clearTimeout(orderTimer);orderTimer=setTimeout(updateOrders,180);});td.append(input);tr.append(td);}body.append(tr);
    });t.append(body);
  }
  function renderOrderPreview(){const records=state.orders?.records||[],pages=Math.max(1,Math.ceil(records.length/50));state.orderPreviewPage=Math.max(0,Math.min(pages-1,state.orderPreviewPage));$('ordersPreview').replaceChildren();
    if(records.length){const data=records.slice(state.orderPreviewPage*50,state.orderPreviewPage*50+50).map(r=>[r.sourceRow,r.id,r.sku]);$('ordersPreview').append(table(['原始行序','订单编号','采购货号'],data));}else $('ordersPreview').append(el('div','empty-inline','请在表格内粘贴订单编号与采购货号两列。'));
    $('ordersPreviewPager').hidden=!records.length;text($('ordersPreviewSummary'),'共 '+records.length+' 个原始行位，顺序与录入一致');text($('ordersPreviewPage'),(state.orderPreviewPage+1)+' / '+pages);$('ordersPreviewPrev').disabled=state.orderPreviewPage===0;$('ordersPreviewNext').disabled=state.orderPreviewPage>=pages-1;
  }
  $('ordersPreviewPrev').onclick=()=>{state.orderPreviewPage--;renderOrderPreview();};$('ordersPreviewNext').onclick=()=>{state.orderPreviewPage++;renderOrderPreview();};
  function setOrderRows(rows){
    const data=C.orderDataRows(rows);if(data.length>20000)throw Error('最多支持 20,000 行，请分批处理。');
    state.orderImportWarnings=data.some(r=>r.slice(2).some(C.str))?['只使用前两列，原 C 列及之后的内容不参与匹配。']:[];
    state.orderGrid=data.map(r=>r.slice(0,2));while(state.orderGrid.length<8)state.orderGrid.push(['','']);
    state.orderGridPage=0;state.orderPreviewPage=0;renderOrdersGrid();updateOrders();
  }
  $('ordersGrid').addEventListener('paste',e=>{const input=e.target.closest('input');if(!input)return;const raw=e.clipboardData.getData('text/plain');if(!raw.includes('\t')&&!raw.includes('\n'))return;e.preventDefault();
    try{let rows=C.parseText(raw);const start=Number(input.dataset.row),col=Number(input.dataset.col);if(start===0&&col===0&&rows.length&&C.isOrderHeader(rows[0]))rows=rows.slice(1);
      if(!rows.length)return;if(rows.some(r=>r.length+col>2))throw Error('采购表只接收订单编号、采购货号两列，请仅复制这两列。');if(start+rows.length>20000)throw Error('最多支持 20,000 行，请分批处理。');
      while(state.orderGrid.length<start+rows.length)state.orderGrid.push(['','']);rows.forEach((r,i)=>r.forEach((v,j)=>state.orderGrid[start+i][col+j]=v));state.orderImportWarnings=[];state.orderPreviewPage=0;renderOrdersGrid();updateOrders();toast('已按原顺序填入 '+rows.length+' 行，空行保留');
    }catch(err){toast(err.message);}
  });
  $('ordersGrid').addEventListener('keydown',e=>{const input=e.target.closest('input');if(!input||e.key!=='Enter')return;e.preventDefault();const row=Number(input.dataset.row)+1,col=Number(input.dataset.col);if(row>=20000)return;if(row>=state.orderGrid.length)state.orderGrid.push(['','']);state.orderGridPage=Math.floor(row/50);renderOrdersGrid();$('ordersGrid').querySelector('input[data-row="'+row+'"][data-col="'+col+'"]').focus();});
  $('readOrders').onclick=updateOrders;$('clearOrders').onclick=()=>{if(state.orderGrid.some(r=>r.some(C.str))&&!confirm('清空本次采购订单？'))return;setOrderRows([]);};
  $('focusOrders').onclick=()=>{$('ordersPasteText').value='';$('ordersPasteError').replaceChildren();$('ordersPasteDialog').showModal();$('ordersPasteText').focus();};
  $('cancelOrdersPaste').onclick=()=>$('ordersPasteDialog').close();$('applyOrdersPaste').onclick=()=>{try{const rows=C.parseText($('ordersPasteText').value);if(!rows.length)throw Error('请先粘贴采购订单。');setOrderRows(rows);$('ordersPasteDialog').close();toast('已按原顺序填入采购订单，请核对预览');}catch(e){message($('ordersPasteError'),[e.message]);}};
  function updateRunButton(){$('runMatch').disabled=!(state.supply?.records.length&&!state.supply.errors.length&&state.orders?.count>0&&!state.orders.errors.length);}
  $('nextOrders').onclick=()=>{updateSupply();if(!state.supply.errors.length&&state.supply.records.length)goto(2);};$('backSupply').onclick=()=>goto(1);$('backOrders').onclick=()=>goto(2);$('goSupply').onclick=()=>goto(1);$('returnMode').onchange=invalidate;
  function returnDescription(r){return r.mode==='date'?'C 列匹配成功填 '+r.matchDate+'（北京时间的今日日期），未匹配或原始空行保持空白。':r.mode==='total'?'C 列回填该货号的原出货总数，沿用原宏。C 列不可相加作为分配总数；实际分配量见导出的“实际分配双数”列。':'C 列每条已匹配订单填写 1；未匹配行保持空白。';}
  $('runMatch').onclick=()=>{updateSupply();updateOrders();updateDateLabel();if($('runMatch').disabled)return;try{state.result=C.match(state.supply.records,state.orders.records,$('returnMode').value);state.page=0;state.filter='all';state.view='orders';$('search').value='';$('resultBody').hidden=false;$('resultEmpty').hidden=true;$('exportAll').disabled=false;const r=state.result;text($('statTotal'),r.total);text($('statMatched'),r.matched);text($('statLeft'),r.left);text($('statUnmatched'),r.unmatched);text($('reconcile'),'数量已核对：'+r.total+' 双出货 = '+r.matched+' 双已分配 + '+r.left+' 双剩余');text($('navResult'),'已匹配 '+r.matched+' 行订单');text($('resultSubtitle'),'保持采购单原始行序，每条匹配订单占用 1 双出货。');text($('resultFootnote'),returnDescription(r));renderResult();goto(3);}catch(e){toast(e.message);}};
  function filtered(){if(!state.result)return[];const q=$('search').value.trim().toLowerCase();return (state.view==='orders'?state.result.rows:state.result.inventory).filter(r=>(state.view!=='orders'||state.filter==='all'||(!r.empty&&(state.filter==='matched'?r.matched:!r.matched)))&&(!q||(String(r.id||'')+' '+r.sku).toLowerCase().includes(q)));}
  function renderResult(){if(!state.result)return;const ordersView=state.view==='orders';$('viewOrders').classList.toggle('selected',ordersView);$('viewInventory').classList.toggle('selected',!ordersView);$('orderFilters').hidden=!ordersView;$('copyAllC').hidden=!ordersView;text($('exportCurrent'),ordersView?'导出采购结果':'导出出货余额');document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===state.filter));const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages-1);const selected=rows.slice(state.page*50,state.page*50+50);let data,headers;if(ordersView){headers=['订单编号','采购货号','C列回填值','匹配状态'];data=selected.map(r=>[r.id,r.sku,r.value,r.empty?'':el('span','badge'+(r.matched?'':' pending'),r.status)]);}else{headers=['货号','原出货数量','已分配双数','剩余数量'];data=selected.map(r=>[r.sku,r.total,r.allocated,r.left]);}$('resultTable').replaceChildren(table(headers,data));if(!rows.length)$('resultTable').append(el('div','empty-inline','没有符合条件的记录。'));text($('resultOrderNote'),ordersView?(state.filter==='all'&&!$('search').value.trim()?'原始顺序已保留。回填原表 C 列，可使用“按原序复制全部 C 列”，含表头和空行。':'当前为筛选结果，复制和当前表格导出包含筛选内全部行；“按原序复制全部 C 列”始终保留完整原序。'):'复制或导出均包含表头及当前搜索范围内的全部货号。');text($('pageSummary'),'共 '+rows.length+' 条'+(rows.length?'，显示 '+(state.page*50+1)+'–'+Math.min((state.page+1)*50,rows.length)+' 条':''));text($('pageIndex'),(state.page+1)+' / '+pages);$('prevPage').disabled=state.page===0;$('nextPage').disabled=state.page>=pages-1;}
  $('viewOrders').onclick=()=>{state.view='orders';state.page=0;renderResult();};$('viewInventory').onclick=()=>{state.view='inventory';state.page=0;renderResult();};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.page=0;renderResult();});$('search').oninput=()=>{state.page=0;renderResult();};$('prevPage').onclick=()=>{state.page--;renderResult();};$('nextPage').onclick=()=>{state.page++;renderResult();};
  const cellString=s=>({t:'s',v:String(s??'')});
  function makeWorkbook(parts){const wb=XLSX.utils.book_new();parts.forEach(({name,headers,rows,widths})=>{const ws=XLSX.utils.aoa_to_sheet([headers,...rows.map(row=>row.map(v=>typeof v==='number'?v:cellString(v)))]);ws['!cols']=(widths||headers.map(()=>22)).map(w=>({wch:w}));ws['!autofilter']={ref:ws['!ref']};XLSX.utils.book_append_sheet(wb,ws,name);});return wb;}
  function exportParts(parts,name){try{const wb=makeWorkbook(parts),data=XLSX.write(wb,{type:'array',bookType:'xlsx'});const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('已生成文件，请查看浏览器下载记录');}catch(e){toast('导出失败：'+e.message);}}
  function dateStamp(){return C.today().replaceAll('/','-');}
  $('exportSupply').onclick=()=>{updateSupply();if(!state.supply.records.length||state.supply.errors.length)return;exportParts([{name:'转换明细',headers:['货号','数量'],rows:state.supply.records.map(r=>[r.sku,r.qty]),widths:[38,14]}],'出货转换明细_'+dateStamp()+'.xlsx');};
  function orderPart(rows,full=false){return {name:'采购匹配结果',headers:['订单编号','采购货号','回填值','匹配状态',...(full?['实际分配双数']:[])],rows:rows.map(o=>[o.id,o.sku,o.value,o.status,...(full?[o.empty?'':o.matched?1:0]:[])]),widths:[25,38,18,24,...(full?[18]:[])]};}
  function inventoryPart(rows){return {name:'出货余额',headers:['货号','原出货数量','已分配双数','剩余数量'],rows:rows.map(o=>[o.sku,o.total,o.allocated,o.left]),widths:[38,16,16,16]};}
  $('exportCurrent').onclick=()=>{if(!state.result)return;const part=state.view==='orders'?orderPart(filtered()):inventoryPart(filtered());exportParts([part],part.name+'_'+dateStamp()+'.xlsx');};
  $('exportAll').onclick=()=>{const r=state.result;if(!r)return;exportParts([orderPart(r.rows,true),inventoryPart(r.inventory),{name:'转换明细',headers:['货号','数量'],rows:state.supply.records.map(o=>[o.sku,o.qty]),widths:[38,14]},{name:'处理说明',headers:['项目','说明'],rows:[['匹配时间',new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})],['分配规则','每行采购单按一双，按原始行序匹配；原始空行占位保留；重复出货货号数量合并。'],['C列回填',returnDescription(r)],['数量核对',r.total+' = '+r.matched+' + '+r.left],['订单数量',r.orderCount],['含空行的原始行数',r.rows.length],['未匹配订单',r.unmatched]],widths:[22,88]}],'出货匹配结果_'+dateStamp()+'.xlsx');};
  async function copyData(data,success){const value=data.map(row=>row.map(v=>{const s=String(v??'');return /[\t\n\r"]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}).join('\t')).join('\n');try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else throw Error();toast(success);}catch{const ta=el('textarea');ta.value=value;ta.style.position='fixed';ta.style.top='-9999px';document.body.append(ta);ta.select();const ok=document.execCommand('copy');ta.remove();toast(ok?success:'浏览器不允许复制，请使用导出表格。');}}
  $('copyResult').onclick=()=>{if(!state.result)return;const part=state.view==='orders'?orderPart(filtered()):inventoryPart(filtered());copyData([part.headers,...part.rows],'已复制 '+part.rows.length+' 条记录，包含表头，保持原始顺序');};
  $('copyAllC').onclick=()=>{if(!state.result)return;copyData([['回填值'],...state.result.rows.map(r=>[r.value])],'已按原序复制全部 C 列（含表头和空行），请粘贴到原表 C 列表头位置');};
  let pendingWorkbook=null,pendingType=null;
  async function loadFile(file,type){if(!file)return;if(file.size>30*1024*1024)return toast('文件超过 30MB，请精简后导入。');toast('正在读取 '+file.name+'…');try{const bytes=await file.arrayBuffer();const wb=XLSX.read(bytes,{type:'array',raw:true,cellFormula:false,cellHTML:false,bookVBA:false});if(!wb.SheetNames.length)throw Error('文件中没有工作表。');pendingWorkbook=wb;pendingType=type;if(wb.SheetNames.length>1){text($('sheetFileName'),file.name);$('sheetSelect').replaceChildren(...wb.SheetNames.map(n=>{const o=el('option','',n);o.value=n;return o;}));$('sheetDialog').showModal();}else importSheet(wb.SheetNames[0]);}catch(e){toast('读取失败：'+e.message);}}
  function importSheet(name){try{const ws=pendingWorkbook.Sheets[name];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:pendingType==='orders'});while(rows.length&&rows.at(-1).every(v=>!C.str(v)))rows.pop();if(rows.length>20001)throw Error('工作表超过 20,000 行，请分批处理。');if(pendingType==='supply'){const imp=C.importSupplier(rows,state.sizes);if(imp.mode==='detail'){$('detailText').value=imp.rows.map(r=>r.slice(0,2).join('\t')).join('\n');setMode('detail');}else{state.sizes=imp.sizes;state.grid=imp.rows.length?imp.rows:Array.from({length:8},emptyRow);state.gridPage=0;saveSizes();setMode('fixed');renderGrid();}state.importWarnings=imp.warnings;updateSupply();goto(1);}else{setOrderRows(rows);goto(2);}pendingWorkbook=null;pendingType=null;$('sheetDialog').close();toast('已导入 '+name+'，请核对预览');}catch(e){toast('导入失败：'+e.message);}}
  $('supplyFileBtn').onclick=()=>$('supplyFile').click();$('ordersFileBtn').onclick=()=>$('ordersFile').click();$('supplyFile').onchange=e=>{loadFile(e.target.files[0],'supply');e.target.value='';};$('ordersFile').onchange=e=>{loadFile(e.target.files[0],'orders');e.target.value='';};$('applySheet').onclick=()=>importSheet($('sheetSelect').value);$('cancelSheet').onclick=()=>{pendingWorkbook=null;pendingType=null;$('sheetDialog').close();};
  function loadDemo(){if((state.supply?.records.length||state.orders?.count)&&!confirm('示例将替换本次出货与采购数据，是否继续？'))return;state.sizes=[...C.DEFAULT_SIZES];const row=(model,color,values)=>[model,color,...state.sizes.map(s=>values[s]??'')];state.grid=[row('DEMO1','黑色',{'8.5':1}),row('DEMO1','米色',{'7':2}),row('DEMO2','红色',{'7':4,'8':3,'8.5':2})];while(state.grid.length<8)state.grid.push(emptyRow());state.gridPage=0;setMode('fixed');renderGrid();setOrderRows(['DEMO1-黑色-8.5','DEMO1-米色-7','DEMO1-米色-7','DEMO1-米色-7','DEMO2-红色-7','DEMO2-红色-7','DEMO2-蓝色-9.5'].map((sku,i)=>['DEMO-ORDER-'+(i+1),sku]));goto(1);toast('已载入演示数据');}
  $('demoBtn').onclick=loadDemo;$('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
  $('newBatch').onclick=()=>{if(!confirm('开始新一批会清空当前出货、采购单和结果，请确认已导出需要的数据。'))return;state.grid=Array.from({length:8},emptyRow);state.gridPage=0;$('detailText').value='';state.importWarnings=[];$('returnMode').value='date';renderGrid();updateSupply();setOrderRows([]);updateDateLabel();goto(1);};
  renderGrid();renderOrdersGrid();updateDateLabel();updateSupply();updateOrders();goto(1);
  let shippingStep = 1;
  window.ShippingWorkspace = {
    show(view) {
      if (document.body.dataset.workspace !== view) $('toast').hidden = true;
      document.body.dataset.workspace = view;
      if (view === 'packing' && state.step !== 4) {
        shippingStep = state.step;
        goto(4);
      } else if (view === 'shipping' && state.step === 4) goto(shippingStep);
    }
  };
})();

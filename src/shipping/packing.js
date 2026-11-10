(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fileInput = $('packingFile');
  const drop = $('packingDrop');
  const capacityInput = $('packingCapacity');
  const exportButton = $('packingExport');
  const factoryButton = $('packingFactory');
  const resetButton = $('packingReset');
  const summaryPattern = /^(合计|小计|总计)(?:\s|[:：]|$)/;
  const boxPattern = /^第\d+箱$/;
  const maximumBoxes = 16384;
  const boxesPerBlock = 9;
  let selection = null;
  let loadId = 0;
  let exporting = false;

  const stringValue = value => String(value ?? '').trim();

  function showStatus(message, error = false) {
    const status = $('packingStatus');
    status.textContent = message;
    status.hidden = !message;
    status.dataset.error = String(error);
  }

  function boxStats(total, capacity) {
    const boxes = Math.ceil(total / capacity);
    return { boxes, full: Math.floor(total / capacity), last: total % capacity || capacity };
  }

  function render() {
    const capacity = Number(capacityInput.value);
    const ready = selection && Number.isSafeInteger(capacity) && capacity > 0;
    const stats = ready ? boxStats(selection.total, capacity) : null;
    $('packingTotal').textContent = selection?.total ?? '—';
    $('packingBoxes').textContent = stats?.boxes ?? '—';
    $('packingFull').textContent = stats?.full ?? '—';
    $('packingLast').textContent = stats?.last ?? '—';
    exportButton.disabled = factoryButton.disabled = !ready || exporting;
    drop.disabled = resetButton.disabled = capacityInput.disabled = exporting;
  }

  function readTemplate(sheet) {
    const used = sheet?.usedRange();
    if (!used) throw new Error('工作簿的第一张表为空。');
    const lastRow = used.endCell().rowNumber();
    const lastColumn = used.endCell().columnNumber();
    let headerRow = 0;
    let columns;
    for (let row = 1; row <= Math.min(20, lastRow); row++) {
      const names = new Map();
      for (let col = 1; col <= Math.min(140, lastColumn); col++) {
        const title = stringValue(sheet.cell(row, col).value());
        if (title && !names.has(title)) names.set(title, col);
      }
      if (names.has('发货数量') && names.has('第1箱')) {
        headerRow = row;
        columns = names;
        break;
      }
    }
    if (!columns) throw new Error('找不到「发货数量」和「第1箱」，请选择领星的「每箱多款 SKU」装箱表。');

    const quantityColumn = columns.get('发货数量');
    const skuColumn = columns.get('SKU');
    const nameColumn = columns.get('品名');
    const serialColumn = columns.get('序号');
    const packedColumn = columns.get('已装箱数');
    const firstBox = columns.get('第1箱');
    const boxColumns = new Set();
    for (let col = firstBox; col <= lastColumn; col++) {
      if (boxPattern.test(stringValue(sheet.cell(headerRow, col).value()))) boxColumns.add(col);
    }

    const items = [];
    let total = 0;
    for (let row = headerRow + 1; row <= lastRow; row++) {
      const serial = serialColumn ? Number(sheet.cell(row, serialColumn).value()) : null;
      if (serialColumn && (!Number.isInteger(serial) || serial < 1)) continue;
      const sku = skuColumn ? stringValue(sheet.cell(row, skuColumn).value()) : '';
      const name = nameColumn ? stringValue(sheet.cell(row, nameColumn).value()) : '';
      const firstValue = stringValue(sheet.cell(row, 1).value());
      if ([sku, name, firstValue].some(value => summaryPattern.test(value))) continue;
      if (skuColumn && !sku) continue;

      const quantity = stringValue(sheet.cell(row, quantityColumn).value());
      if (!quantity && !sku && !name && !serial) continue;
      const qty = Number(quantity);
      if (!Number.isSafeInteger(qty) || qty < 0) throw new Error(`第 ${row} 行的发货数量应为非负整数。`);
      items.push({ row, qty, name: name || sku || `SKU-${row}` });
      total += qty;
    }
    if (!Number.isSafeInteger(total)) throw new Error('发货总数超过可处理范围。');
    if (total === 0) throw new Error('表中没有大于 0 的发货数量。');
    return { headerRow, firstBox, boxColumns, packedColumn, lastRow, lastColumn, items, total };
  }

  async function loadFile(file) {
    if (!file || exporting) return;
    const id = ++loadId;
    selection = null;
    $('packingFileName').textContent = file.name;
    render();
    showStatus('正在读取装箱表…');
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('请选择 .xlsx 文件。');
      if (file.size > 30 * 1024 * 1024) throw new Error('文件超过 30 MB。');
      const bytes = await file.arrayBuffer();
      if (id !== loadId) return;
      const workbook = await XlsxPopulate.fromDataAsync(bytes);
      if (id !== loadId) return;
      selection = { ...readTemplate(workbook.sheet(0)), bytes, base: file.name.replace(/\.xlsx$/i, '') };
      const itemCount = selection.items.filter(item => item.qty > 0).length;
      showStatus(`已读取 ${itemCount} 行 SKU，共 ${selection.total} 双。`);
    } catch (error) {
      if (id !== loadId) return;
      showStatus(`读取失败。${error.message}`, true);
    }
    render();
  }

  function allocate(items, capacity) {
    let box = 0;
    let free = capacity;
    return items.map(item => {
      const allocations = [];
      let remaining = item.qty;
      while (remaining > 0) {
        const qty = Math.min(remaining, free);
        allocations.push({ box, qty });
        remaining -= qty;
        free -= qty;
        if (free === 0) {
          box++;
          free = capacity;
        }
      }
      return { ...item, allocations };
    });
  }

  const templateStyles = ['fill', 'fontColor', 'fontFamily', 'fontSize', 'bold', 'border', 'horizontalAlignment', 'verticalAlignment', 'numberFormat'];

  function copyStyle(target, source) {
    const values = source.style(templateStyles);
    for (const name of templateStyles) {
      if (values[name] !== undefined) target.style(name, values[name]);
    }
  }

  async function createLingxingWorkbook(template, items, boxes) {
    const workbook = await XlsxPopulate.fromDataAsync(template.bytes);
    const sheet = workbook.sheet(0);
    const { headerRow, firstBox, boxColumns, packedColumn, lastRow, lastColumn } = template;
    if (firstBox + boxes - 1 > maximumBoxes) throw new Error('箱列超出 Excel 的列数上限，请提高单箱容量。');

    const newColumns = new Set();
    for (let index = 0; index < boxes; index++) {
      const col = firstBox + index;
      if (boxColumns.has(col)) continue;
      if (col <= lastColumn) {
        for (let row = 1; row <= lastRow; row++) {
          const cell = sheet.cell(row, col);
          if (stringValue(cell.value()) || cell.formula()) {
            throw new Error(`第 ${index + 1} 箱需要的列已有内容。请增加可用箱列或提高单箱容量。`);
          }
        }
      }
      newColumns.add(col);
    }

    for (const col of newColumns) {
      copyStyle(sheet.cell(headerRow, col), sheet.cell(headerRow, col - 1));
      const width = sheet.column(col - 1).width();
      if (width !== undefined) sheet.column(col).width(width);
    }
    for (let index = 0; index < boxes; index++) sheet.cell(headerRow, firstBox + index).value(`第${index + 1}箱`);
    for (const item of items) {
      for (const col of boxColumns) sheet.cell(item.row, col).clear();
      for (const { box, qty } of item.allocations) {
        const col = firstBox + box;
        const cell = sheet.cell(item.row, col);
        if (newColumns.has(col)) copyStyle(cell, sheet.cell(item.row, firstBox));
        cell.value(qty);
      }
      if (packedColumn) sheet.cell(item.row, packedColumn).value(item.qty);
    }
    return workbook;
  }

  async function createFactoryWorkbook(items, boxes, total) {
    const groups = Array.from({ length: Math.ceil(boxes / boxesPerBlock) }, () => []);
    for (const item of items) {
      for (const { box, qty } of item.allocations) {
        const group = groups[Math.floor(box / boxesPerBlock)];
        let line = group.at(-1);
        if (line?.sourceRow !== item.row) {
          line = { sourceRow: item.row, values: [item.name, 0, ...Array(boxesPerBlock).fill('')] };
          group.push(line);
        }
        line.values[1] += qty;
        line.values[2 + box % boxesPerBlock] = qty;
      }
    }

    const workbook = await XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0).name('装箱单');
    sheet.column('A').width(31);
    sheet.column('B').width(13);
    for (let col = 3; col <= 11; col++) sheet.column(col).width(10.5);
    const border = { style: 'thin', color: '000000' };
    const bodyStyle = { fontSize: 11, horizontalAlignment: 'center', verticalAlignment: 'center', border: { top: border, bottom: border, left: border, right: border } };
    const headerStyle = { ...bodyStyle, fontSize: 12, fill: '8C8C8C', fontColor: 'FFFFFF', bold: true };
    let row = 1;
    for (const [index, group] of groups.entries()) {
      const titles = Array.from({ length: boxesPerBlock }, (_, offset) => {
        const box = index * boxesPerBlock + offset + 1;
        return box <= boxes ? `B${box}` : '';
      });
      sheet.range(row, 1, row, 11).value([['品名', '发货数量', ...titles]]).style(headerStyle);
      sheet.row(row++).height(24);
      for (const { values } of group) {
        sheet.range(row, 1, row, 11).value([values]).style(bodyStyle);
        sheet.row(row++).height(22);
      }
    }
    sheet.cell(row, 2).value(total);
    sheet.range(row, 1, row, 11).style(headerStyle);
    sheet.row(row).height(22);
    return workbook;
  }

  async function downloadPacking(factory) {
    const template = selection;
    const capacity = Number(capacityInput.value);
    if (!template || exporting || !Number.isSafeInteger(capacity) || capacity < 1) return;
    exporting = true;
    render();
    showStatus('正在生成 Excel 文件…');
    try {
      const { boxes, last } = boxStats(template.total, capacity);
      if (boxes > maximumBoxes) throw new Error('箱数过多，请提高单箱容量。');
      const items = allocate(template.items, capacity);
      const workbook = factory
        ? await createFactoryWorkbook(items, boxes, template.total)
        : await createLingxingWorkbook(template, items, boxes);
      const data = await workbook.outputAsync('uint8array');
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = factory ? `${template.base}_工厂装箱单_${boxes}箱.xlsx` : `${template.base}_已自动装箱_${capacity}双每箱.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showStatus(`已生成${factory ? '工厂装箱单' : '领星装箱表'}，共 ${template.total} 双、${boxes} 箱，最后一箱 ${last} 双。`);
    } catch (error) {
      showStatus(`生成失败。${error.message}`, true);
    } finally {
      exporting = false;
      render();
    }
  }

  drop.onclick = () => fileInput.click();
  fileInput.onchange = event => {
    loadFile(event.target.files[0]);
    event.target.value = '';
  };
  drop.addEventListener('dragover', event => {
    event.preventDefault();
    if (!exporting) drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    loadFile(event.dataTransfer.files[0]);
  });
  capacityInput.oninput = () => {
    const capacity = Number(capacityInput.value);
    if (!Number.isSafeInteger(capacity) || capacity < 1) showStatus('请输入大于 0 的整数单箱容量。', true);
    else if (selection) showStatus('');
    render();
  };
  exportButton.onclick = () => downloadPacking(false);
  factoryButton.onclick = () => downloadPacking(true);
  resetButton.onclick = () => {
    loadId++;
    selection = null;
    fileInput.value = '';
    capacityInput.value = '20';
    $('packingFileName').textContent = '';
    showStatus('');
    render();
  };
})();

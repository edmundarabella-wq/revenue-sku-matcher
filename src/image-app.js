(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const items = [], MAX_FILES = 30, MAX_SIZE = 50 * 1024 * 1024, MAX_TOTAL = 200 * 1024 * 1024;
  let processing = false, packing = false, zipUrl = null, sequence = 0;
  const icons = () => lucide.createIcons();
  function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function icon(name) { const e = element('i'); e.dataset.lucide = name; return e; }
  function action(tag, label, name, className = 'icon-btn') {
    const e = element(tag, undefined, className); e.append(icon(name)); e.title = label; e.setAttribute('aria-label', label); if (tag === 'button') e.type = 'button'; return e;
  }
  function size(bytes) { return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB'; }
  function notice(message = '') { $('image-notice').textContent = message; $('image-notice').hidden = !message; }
  function invalidateZip() { if (zipUrl) URL.revokeObjectURL(zipUrl); zipUrl = null; $('image-zip-ready').removeAttribute('href'); $('image-zip-ready').hidden = true; }
  function release(item) { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); if (item.outputUrl) URL.revokeObjectURL(item.outputUrl); }
  function addFiles(files) {
    if (processing || packing) return;
    const known = new Set(items.map(i => i.fingerprint)), warnings = new Set();
    let total = items.reduce((n, i) => n + i.file.size, 0), added = false;
    for (const file of Array.from(files)) {
      const fingerprint = JSON.stringify([file.name, file.size, file.lastModified]);
      if (known.has(fingerprint)) { warnings.add('重复文件未再次添加'); continue; }
      if (items.length >= MAX_FILES) { warnings.add('最多添加30张图片，超出部分未添加'); continue; }
      if (file.size > MAX_SIZE) { warnings.add(file.name + '：超过单张50 MB限制，未添加'); continue; }
      if (file.size + total > MAX_TOTAL) { warnings.add('图片总大小不能超过200 MB，超出部分未添加'); continue; }
      const supported = /\.(jpe?g|png)$/i.test(file.name) || ['image/jpeg', 'image/png'].includes(file.type);
      items.push({id: ++sequence, fingerprint, file, previewUrl: supported ? URL.createObjectURL(file) : null, status: supported ? 'ready' : 'error', message: supported ? '尚未处理' : '仅支持JPEG或PNG图片'});
      known.add(fingerprint); total += file.size; added = true;
    }
    if (added) invalidateZip(); notice([...warnings].slice(0, 4).join('；')); render();
  }
  function render() {
    const locked = processing || packing, success = items.filter(i => i.status === 'success').length, pending = items.filter(i => i.status === 'ready').length;
    $('image-queue').hidden = !items.length; $('image-drop').classList.toggle('compact', !!items.length);
    $('image-drop').setAttribute('aria-disabled', String(locked));
    $('image-list').replaceChildren();
    for (const [index, item] of items.entries()) {
      const row = element('article', undefined, 'image-row'); row.dataset.id = item.id;
      row.append(element('span', String(index + 1).padStart(2, '0'), 'image-index'));
      if (item.previewUrl) { const img = element('img', undefined, 'image-thumbnail'); img.src = item.previewUrl; img.alt = item.file.name; row.append(img); }
      else { const preview = element('div', undefined, 'image-thumbnail no-preview'); preview.append(icon('file-warning')); row.append(preview); }
      const info = element('div', undefined, 'image-info'), name = element('strong', item.file.name); name.title = item.file.name;
      info.append(name, element('span', size(item.file.size) + (item.format ? ' · ' + item.format.toUpperCase() : ''))); row.append(info);
      const status = element('div', undefined, 'image-status ' + item.status);
      status.append(icon({ready: 'clock-3', processing: 'loader-circle', success: 'circle-check', error: 'circle-alert'}[item.status]));
      const copy = element('div'); copy.append(element('strong', {ready: '待处理', processing: '写入中', success: '校验成功', error: '处理失败'}[item.status]), element('span', item.message)); status.append(copy); row.append(status);
      const actions = element('div', undefined, 'image-row-actions');
      if (item.outputUrl) { const link = action('a', '下载 ' + item.outputName, 'download'); link.href = item.outputUrl; link.download = item.outputName; actions.append(link); }
      const remove = action('button', '移除 ' + item.file.name, 'x'); remove.disabled = locked;
      remove.onclick = () => { if (processing || packing) return; release(item); items.splice(items.indexOf(item), 1); invalidateZip(); render(); };
      actions.append(remove); row.append(actions); $('image-list').append(row);
    }
    $('image-summary').textContent = items.length + ' 张图片 · ' + success + ' 已完成 · ' + items.filter(i => i.status === 'error').length + ' 失败';
    $('image-process').disabled = locked || !pending;
    $('image-process').querySelector('span').textContent = processing ? '正在处理' : '添加并校验' + (pending ? ' (' + pending + ')' : '');
    $('image-files').disabled = locked; $('image-choose').disabled = locked; $('image-clear').disabled = locked;
    $('image-zip').disabled = locked || !success; $('image-zip').querySelector('span').textContent = packing ? '正在打包' : '打包下载';
    icons();
  }
  async function processAll() {
    if (processing || packing) return;
    const targets = items.filter(i => i.status === 'ready'); if (!targets.length) return;
    processing = true; invalidateZip(); notice(); $('image-progress-band').hidden = false;
    $('image-progress').value = 0; $('image-progress-text').textContent = '0%';
    try {
      for (const [index, item] of targets.entries()) {
        item.status = 'processing'; item.message = '写入并校验XMP'; render();
        $('image-stage').textContent = (index + 1) + ' / ' + targets.length + ' · ' + item.file.name;
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
          const source = new Uint8Array(await item.file.arrayBuffer());
          const result = ImageMetadata.applyTag(source);
          const bitmap = await createImageBitmap(new Blob([source])); bitmap.close();
          item.format = result.format; item.outputName = ImageMetadata.outputName(item.file.name, result.format);
          item.output = new Blob([result.bytes], {type: result.format === 'jpeg' ? 'image/jpeg' : 'image/png'});
          item.outputUrl = URL.createObjectURL(item.output); item.status = 'success';
          item.message = result.alreadyTagged ? '原图已含指定标签，未重复写入' : '指定标签已写入并校验';
        } catch (error) { item.status = 'error'; item.message = error.message || '无法读取图片，未生成结果'; }
        const percent = Math.round((index + 1) * 100 / targets.length);
        $('image-progress').value = percent; $('image-progress-text').textContent = percent + '%'; render();
      }
      $('image-stage').textContent = '处理完成';
    } finally { processing = false; render(); }
  }
  async function packAll() {
    if (processing || packing) return;
    const completed = items.filter(i => i.output && i.status === 'success'); if (!completed.length) return;
    packing = true; invalidateZip(); notice(); render();
    try {
      const zip = new JSZip(), used = new Set();
      for (const item of completed) {
        let name = item.outputName, number = 2;
        while (used.has(name.toLowerCase())) name = item.outputName.replace(/(\.[^.]+)$/, ' (' + number++ + ')$1');
        used.add(name.toLowerCase()); zip.file(name, await item.output.arrayBuffer());
      }
      const blob = await zip.generateAsync({type: 'blob', compression: 'STORE'});
      zipUrl = URL.createObjectURL(blob); $('image-zip-ready').href = zipUrl;
      $('image-zip-ready').download = 'amazon-ai-tagged-images.zip'; $('image-zip-ready').hidden = false;
    } catch (error) { notice('打包失败：' + error.message); }
    finally { packing = false; render(); }
  }
  function choose() { if (!processing && !packing) $('image-files').click(); }
  $('image-choose').onclick = choose; $('image-drop').onclick = choose;
  $('image-drop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
  for (const event of ['dragenter', 'dragover']) $('image-drop').addEventListener(event, e => { e.preventDefault(); if (!processing && !packing) $('image-drop').classList.add('drag'); });
  $('image-drop').ondragleave = () => $('image-drop').classList.remove('drag');
  $('image-drop').ondrop = e => { e.preventDefault(); $('image-drop').classList.remove('drag'); addFiles(e.dataTransfer.files); };
  $('image-files').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('image-process').onclick = processAll; $('image-zip').onclick = packAll;
  $('image-clear').onclick = () => { if (processing || packing) return; items.forEach(release); items.length = 0; invalidateZip(); notice(); $('image-progress-band').hidden = true; render(); };
  window.addEventListener('beforeunload', e => { if (processing || packing) { e.preventDefault(); e.returnValue = ''; } });
  window.ImageTool = {getState: () => ({items: items.slice(), processing, packing})};
  render();
})();

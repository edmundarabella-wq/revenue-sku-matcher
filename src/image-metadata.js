/* Adapted from edmundarabella-wq/amazon-ai-metadata-tool, commit 09954576a3279271c909aac95cefa137423db244. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEYWORD = 'contains-synthetic-performer';
  const DC = 'http://purl.org/dc/elements/1.1/', RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const jpegHeader = encoder.encode('http://ns.adobe.com/xap/1.0/\0');
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const packet = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="' + RDF + '"><rdf:Description rdf:about="" xmlns:dc="' + DC + '"><dc:subject><rdf:Bag><rdf:li>' + KEYWORD + '</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>';
  const crcTable = Uint32Array.from({length: 256}, (_, n) => {
    let c = n; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); return c >>> 0;
  });
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out;
  }
  function equalsAt(source, expected, offset = 0) { return offset >= 0 && offset + expected.length <= source.length && expected.every((v, i) => source[offset + i] === v); }
  function read32(source, offset) { return new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0); }
  function write32(target, offset, value) { new DataView(target.buffer, target.byteOffset + offset, 4).setUint32(0, value); }
  function crc32(source) { let crc = 0xffffffff; for (const byte of source) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
  function parseXml(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XMP包含不支持的实体声明，未修改原图');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagNameNS(RDF, 'RDF').length) throw new Error('现有XMP结构无效，未修改原图');
    return doc;
  }
  function containsKeyword(doc) {
    return Array.from(doc.getElementsByTagNameNS(DC, 'subject')).some(subject =>
      Array.from(subject.getElementsByTagNameNS(RDF, 'li')).some(li => li.textContent.trim() === KEYWORD));
  }
  function updateXml(xml) {
    const doc = parseXml(xml);
    if (containsKeyword(doc)) return xml;
    const subjects = Array.from(doc.getElementsByTagNameNS(DC, 'subject'));
    let bag = subjects.flatMap(subject => Array.from(subject.getElementsByTagNameNS(RDF, 'Bag')))[0];
    if (!bag) {
      const description = doc.createElementNS(RDF, 'rdf:Description');
      description.setAttributeNS(RDF, 'rdf:about', '');
      const subject = doc.createElementNS(DC, 'dc:subject');
      bag = doc.createElementNS(RDF, 'rdf:Bag'); subject.append(bag); description.append(subject);
      doc.getElementsByTagNameNS(RDF, 'RDF')[0].append(description);
    }
    const li = doc.createElementNS(RDF, 'rdf:li'); li.textContent = KEYWORD; bag.append(li);
    return new XMLSerializer().serializeToString(doc);
  }
  function jpegSegments(source) {
    const segments = []; let offset = 2;
    while (offset < source.length) {
      const start = offset;
      if (source[offset] !== 255) break;
      while (source[offset] === 255) offset++;
      const code = source[offset++];
      if (code === 217 || code === undefined || code === 0) break;
      if (code === 1 || (code >= 208 && code <= 215)) continue;
      if (offset + 2 > source.length) break;
      const size = (source[offset] << 8) | source[offset + 1], end = offset + size;
      if (size < 2 || end > source.length) break;
      if (code === 218) {
        for (let i = end; i + 1 < source.length; i++) if (source[i] === 255 && source[i + 1] === 217) return segments;
        break;
      }
      segments.push({start, end, code, dataStart: offset + 2}); offset = end;
    }
    throw new Error('JPEG文件结构不完整，未修改原图');
  }
  function pngChunks(source) {
    const chunks = []; let offset = 8, imageData = false;
    while (offset + 12 <= source.length) {
      const length = read32(source, offset), end = offset + length + 12;
      if (end > source.length || length > 0x7fffffff) break;
      const type = decoder.decode(source.subarray(offset + 4, offset + 8));
      if (!/^[A-Za-z]{4}$/.test(type) || crc32(source.subarray(offset + 4, end - 4)) !== read32(source, end - 4)) throw new Error('PNG文件块校验失败，未修改原图');
      if (!chunks.length && (type !== 'IHDR' || length !== 13)) break;
      const chunk = {start: offset, end, type, dataStart: offset + 8, length}; chunks.push(chunk);
      if (type === 'IDAT') imageData = true;
      if (type === 'IEND') { if (length === 0 && imageData) return chunks; break; }
      offset = end;
    }
    throw new Error('PNG文件结构不完整，未修改原图');
  }
  function pngXmp(source, chunk) {
    const data = source.subarray(chunk.dataStart, chunk.dataStart + chunk.length), keywordEnd = data.indexOf(0);
    if (keywordEnd < 0 || decoder.decode(data.subarray(0, keywordEnd)) !== 'XML:com.adobe.xmp') return null;
    if (keywordEnd + 3 > data.length || data[keywordEnd + 1] !== 0 || data[keywordEnd + 2] !== 0) throw new Error('暂不支持压缩的PNG XMP，未修改原图');
    const languageEnd = data.indexOf(0, keywordEnd + 3), translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) throw new Error('PNG XMP结构无效，未修改原图');
    return {prefix: data.subarray(0, translatedEnd + 1), xml: decoder.decode(data.subarray(translatedEnd + 1))};
  }
  function pngChunk(data) {
    const out = new Uint8Array(data.length + 12); write32(out, 0, data.length); out.set(encoder.encode('iTXt'), 4); out.set(data, 8);
    write32(out, out.length - 4, crc32(out.subarray(4, out.length - 4))); return out;
  }
  function inspect(source) {
    if (!(source instanceof Uint8Array)) throw new Error('图片内容必须是字节数组');
    if (source[0] === 255 && source[1] === 216) {
      const segments = jpegSegments(source);
      const metadata = segments.filter(s => s.code === 225 && equalsAt(source, jpegHeader, s.dataStart)).map(s => ({...s, xml: decoder.decode(source.subarray(s.dataStart + jpegHeader.length, s.end))}));
      return {format: 'jpeg', metadata};
    }
    if (equalsAt(source, pngHeader)) {
      const chunks = pngChunks(source), metadata = [];
      for (const chunk of chunks.filter(c => c.type === 'iTXt')) { const xmp = pngXmp(source, chunk); if (xmp) metadata.push({...chunk, ...xmp}); }
      return {format: 'png', metadata, insertAt: chunks[chunks.length - 1].start};
    }
    throw new Error('仅支持JPEG或PNG图片');
  }
  function hasTag(source) { return inspect(source).metadata.some(m => containsKeyword(parseXml(m.xml))); }
  function applyTag(source) {
    const info = inspect(source);
    if (info.metadata.some(m => containsKeyword(parseXml(m.xml)))) return {bytes: source.slice(), format: info.format, alreadyTagged: true};
    const existing = info.metadata[0], xml = encoder.encode(existing ? updateXml(existing.xml) : packet);
    let replacement;
    if (info.format === 'jpeg') {
      const data = concat([jpegHeader, xml]);
      if (data.length + 2 > 65535) throw new Error('JPEG XMP过大，无法安全写入标签');
      replacement = concat([new Uint8Array([255, 225, (data.length + 2) >>> 8, (data.length + 2) & 255]), data]);
    } else replacement = pngChunk(concat([existing ? existing.prefix : encoder.encode('XML:com.adobe.xmp\0\0\0\0\0'), xml]));
    const start = existing ? existing.start : info.format === 'jpeg' ? 2 : info.insertAt, end = existing ? existing.end : start;
    const bytes = concat([source.subarray(0, start), replacement, source.subarray(end)]);
    if (!hasTag(bytes)) throw new Error('标签写入后校验失败');
    return {bytes, format: info.format, alreadyTagged: false};
  }
  function outputName(name, format) {
    const base = String(name).replace(/\.[^.]+$/, '').replace(/_amazon-ai-tagged$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160) || 'image';
    return base + '_amazon-ai-tagged.' + (format === 'jpeg' ? 'jpg' : 'png');
  }
  return {KEYWORD, applyTag, hasTag, outputName};
});

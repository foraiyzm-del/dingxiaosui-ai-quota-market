import { crc32, inflateSync } from 'node:zlib';

// Validate the image container before enabling payments. This does not identify QR contents.
export function imageMime(bytes) {
  const invalid = () => { throw Object.assign(new Error('图片不完整或格式无效，请上传完整的 PNG、JPG 或 WebP 图片'), { status: 400 }); };
  if (bytes.length < 16) invalid();
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, header = false, ended = false;
    const data = [];
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      if (size > bytes.length - offset - 12) invalid();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) invalid();
      if (!header && type !== 'IHDR') invalid();
      if (type === 'IHDR') {
        if (header || size !== 13) invalid();
        const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12);
        if (!width || !height || width > 4096 || height > 4096) invalid();
        header = true;
      }
      if (type === 'IDAT') data.push(bytes.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
      if (type === 'IEND') { if (size !== 0 || offset !== bytes.length) invalid(); ended = true; break; }
    }
    if (!header || !ended || !data.length) invalid();
    try { if (!inflateSync(Buffer.concat(data), { maxOutputLength: 128 * 1024 * 1024 }).length) invalid(); } catch { invalid(); }
    return 'image/png';
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
    let pos = 2, frame = false, scan = false;
    while (pos + 3 < bytes.length) {
      if (bytes[pos++] !== 255) invalid();
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 217) break;
      if (pos + 2 > bytes.length) invalid();
      const size = bytes.readUInt16BE(pos);
      if (size < 2 || pos + size > bytes.length) invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8) invalid();
        const h = bytes.readUInt16BE(pos + 3), w = bytes.readUInt16BE(pos + 5);
        if (!w || !h || w > 4096 || h > 4096) invalid(); frame = true;
      }
      if (marker === 218) { scan = pos + size < bytes.length - 2; break; }
      pos += size;
    }
    if (!frame || !scan) invalid();
    return 'image/jpeg';
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
    let pos = 12, payload = false;
    while (pos + 8 <= bytes.length) {
      const type = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4);
      if (pos + 8 + size > bytes.length) invalid();
      if (type === 'VP8 ' || type === 'VP8L') { if (size < 10) invalid(); payload = true; }
      pos += 8 + size + (size % 2);
    }
    if (!payload || pos !== bytes.length) invalid();
    return 'image/webp';
  }
  invalid();
}

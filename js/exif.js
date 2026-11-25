// อ่าน "วันที่ถ่าย" จากข้อมูล EXIF ในไฟล์ JPEG → 'YYYYMMDD' หรือ null ถ้าไม่มี
export async function readShotDate(file) {
  try {
    const buf = await file.slice(0, 1024 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) {
      // HEIC/อื่นๆ: หาบล็อก "Exif\0\0" แล้วอ่าน TIFF ที่ตามมา
      const b = new Uint8Array(buf);
      for (let i = 0; i + 10 < b.length; i++) {
        if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
          const t = i + 6;
          if ((b[t] === 0x49 && b[t + 1] === 0x49) || (b[t] === 0x4d && b[t + 1] === 0x4d)) return parseTiff(v, t);
        }
      }
      return null;
    }
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p);
      const len = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      p += 2 + len;
    }
  } catch {
    /* ไฟล์อ่านไม่ได้ */
  }
  return null;
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const readAscii = (o, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(t + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const ifd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), off: e + 8 };
    }
    return tags;
  };
  const str = (tag) => (tag ? readAscii(tag.count > 4 ? u32(tag.off) : tag.off, tag.count) : '');
  const ifd0 = ifd(u32(4));
  let date = '';
  if (ifd0[0x8769]) {
    const ex = ifd(u32(ifd0[0x8769].off));
    date = str(ex[0x9003]) || str(ex[0x9004]); // DateTimeOriginal / DateTimeDigitized
  }
  if (!date) date = str(ifd0[0x0132]); // DateTime
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(date);
  return m && m[1] !== '0000' ? `${m[1]}${m[2]}${m[3]}` : null;
}

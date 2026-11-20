// ต่อภาพแคปหน้าจอ: หาส่วนที่ซ้อนกันระหว่างภาพบน (A) กับภาพล่าง (B)
// - แถบบนที่เหมือนกัน (แถบสถานะ ชื่อแชท) = header, แถบล่างที่เหมือนกัน (ช่องพิมพ์ เมนู) = footer
// - เลื่อนหาตำแหน่งที่เนื้อหาของ B ช่วงต้น ตรงกับเนื้อหาของ A ช่วงท้าย
// ทำงานบนรูปย่อกว้าง MW px แบบขาวดำ แล้วแปลงกลับเป็นพิกเซลจริง

const MW = 240;
const FW = 120; // ความกว้างของลายเซ็นละเอียด (ใช้ทุกแถวของภาพจริง ไว้หารอยต่อแบบตรงพิกเซล)
const PIX_DIFF = 24; // ต่างกันเกินนี้ = พิกเซลไม่เหมือน
const SAME_ROW = 0.15; // แถวที่ต่างกันไม่เกิน 15% นับว่าเหมือน (เผื่อนาฬิกาเปลี่ยนนาที)
const MATCH_OK = 0.03; // ส่วนซ้อนต้องต่างกันเฉลี่ยไม่เกิน 3%

export function makeSig(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = MW / w;
  const mh = Math.max(8, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = MW;
  c.height = mh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, MW, mh);
  const d = ctx.getImageData(0, 0, MW, mh).data;
  c.width = 0;
  const raw = new Uint8Array(MW * mh);
  for (let p = 0, i = 0; p < MW * mh; p++, i += 4) raw[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  // เกลี่ยแนวตั้ง 3 แถว: ลดผลจากการย่อที่ทำให้แถวไม่ตรงกันพอดี
  const g = new Uint8Array(MW * mh);
  const info = new Uint8Array(mh); // แถวมีรายละเอียดไหม (ไม่ใช่พื้นเรียบ)
  for (let y = 0; y < mh; y++) {
    let mn = 255;
    let mx = 0;
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(mh - 1, y + 1);
    for (let x = 0; x < MW; x++) {
      const v = ((raw[y0 * MW + x] + raw[y * MW + x] * 2 + raw[y1 * MW + x]) / 4) | 0;
      g[y * MW + x] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    info[y] = mx - mn > 30 ? 1 : 0;
  }
  // ลายเซ็นละเอียด: กว้าง FW ทุกแถวของภาพจริง
  const fc = document.createElement('canvas');
  fc.width = FW;
  fc.height = h;
  const fctx = fc.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0, FW, h);
  const fd = fctx.getImageData(0, 0, FW, h).data;
  fc.width = 0;
  const fg = new Uint8Array(FW * h);
  for (let p = 0, i = 0; p < FW * h; p++, i += 4) fg[p] = (0.299 * fd[i] + 0.587 * fd[i + 1] + 0.114 * fd[i + 2]) | 0;
  return { w, h, mh, scale: s, g, info, fg };
}

const fineRowDiff = (A, ra, B, rb) => {
  let sum = 0;
  const oa = ra * FW;
  const ob = rb * FW;
  for (let x = 0; x < FW; x++) sum += Math.abs(A.fg[oa + x] - B.fg[ob + x]);
  return sum / FW;
};

function rowDiff(A, ra, B, rb) {
  let n = 0;
  const oa = ra * MW;
  const ob = rb * MW;
  for (let x = 0; x < MW; x += 2) if (Math.abs(A.g[oa + x] - B.g[ob + x]) > PIX_DIFF) n++;
  return n / (MW / 2);
}

// คืน { found, header, footer, cutA, startB } เป็นพิกเซลจริงของแต่ละภาพ
// cutA = ใช้ภาพ A ถึงแถวนี้ (ไม่รวม footer), startB = เริ่มใช้ภาพ B จากแถวนี้ (หลังส่วนซ้อน)
export function matchPair(A, B) {
  const hA = A.mh;
  const hB = B.mh;
  const minH = Math.min(hA, hB);
  let header = 0;
  while (header < minH * 0.35 && rowDiff(A, header, B, header) < SAME_ROW) header++;
  let footer = 0;
  while (footer < minH * 0.25 && rowDiff(A, hA - 1 - footer, B, hB - 1 - footer) < SAME_ROW) footer++;
  const endA = hA - footer;
  const endB = hB - footer;
  const minL = Math.max(10, Math.round(hA * 0.05));

  let best = { score: 1, s: -1, L: 0 };
  for (let s = header + 1; s <= endA - minL; s++) {
    const L = Math.min(endA - s, endB - header);
    if (L < minL) continue;
    let sum = 0;
    let cnt = 0;
    let inf = 0;
    const limit = best.score * (L / 2 + 1);
    for (let k = 0; k < L; k += 2) {
      const ra = s + k;
      const rb = header + k;
      if (!A.info[ra] && !B.info[rb]) continue; // พื้นเรียบทั้งคู่ ไม่ช่วยตัดสิน
      inf++;
      sum += rowDiff(A, ra, B, rb);
      cnt++;
      if (sum > limit) break;
    }
    if (inf < (L / 2) * 0.15 || !cnt) continue;
    const score = sum / cnt;
    if (score < best.score) best = { score, s, L };
  }

  const fa = 1 / A.scale;
  const fb = 1 / B.scale;
  // ผ่านขั้นคร่าว หรือคะแนนก้ำกึ่งแต่ขั้นละเอียดยืนยันว่าตรงกันจริง
  const fine = best.s >= 0 && best.score <= 0.1 ? refine(A, B, best, header, fa, fb) : null;
  const found = !!fine && (best.score <= MATCH_OK || fine.diff <= 3);
  if (!found) {
    // หาส่วนซ้อนไม่เจอ: ต่อชนกันเลย ตัดแถบบน/ล่างที่ซ้ำออก
    return { found: false, score: best.score, cutA: Math.round(endA * fa), startB: Math.round(header * fb), dbg: { header, footer, s: best.s, L: best.L } };
  }
  return {
    found: true,
    score: best.score,
    cutA: fine.cutA,
    startB: fine.cutA - fine.off,
    dbg: { header, footer, s: best.s, L: best.L, off: fine.off, fine: +fine.diff.toFixed(2) },
  };
}

// ขั้นละเอียด: หาแถบล่างที่ซ้ำแบบตรงพิกเซล แล้วหาระยะเลื่อนที่ตรงที่สุด (±8 px รอบค่าคร่าวๆ)
function refine(A, B, best, header, fa, fb) {
  let fFoot = 0;
  const maxFoot = Math.min(A.h, B.h) * 0.3;
  while (fFoot < maxFoot && fineRowDiff(A, A.h - 1 - fFoot, B, B.h - 1 - fFoot) < 2) fFoot++;
  const cutA = A.h - fFoot;
  const approx = Math.round(best.s * fa - header * fb); // แถว r ของ B = แถว r + off ของ A
  let bestOff = approx;
  let bestD = Infinity;
  const band = Math.min(Math.round(best.L * fa * 0.8), 600);
  for (let off = approx - 8; off <= approx + 8; off++) {
    let sum = 0;
    let n = 0;
    for (let ra = cutA - band; ra < cutA; ra += 2) {
      const rb = ra - off;
      if (ra < 0 || rb < 0 || rb >= B.h) continue;
      sum += fineRowDiff(A, ra, B, rb);
      n++;
    }
    if (n && sum / n < bestD) {
      bestD = sum / n;
      bestOff = off;
    }
  }
  return { cutA, off: bestOff, diff: bestD };
}

// ต่อภาพแคปหน้าจอ: หาแถบบน/ล่างที่ค้างอยู่ทุกภาพ, หาส่วนที่ซ้อนกัน, และเรียงลำดับภาพอัตโนมัติ
// - แถบบน (แถบสถานะ ชื่อแชท) / แถบล่าง (ช่องพิมพ์ เมนู) = แถวที่เหมือนกันใน "ทุกภาพ" ที่ตำแหน่งเดิม
//   (เทียบทุกภาพพร้อมกัน แถวว่างที่บังเอิญเหมือนกันแค่ 2 ภาพจึงไม่ถูกนับ · เวลาที่เปลี่ยนนาทียังนับว่าเหมือน)
// - ส่วนซ้อน: ขั้นคร่าวบนรูปย่อกว้าง MW แล้วขั้นละเอียดระดับพิกเซลด้วยทุกแถวของภาพจริง
// - ลำดับ: จับคู่ทุกภาพ (ภาพไหนต่อท้ายภาพไหน) แล้วหาลำดับที่ต่อได้ดีที่สุด

const MW = 240;
const FW = 120; // ความกว้างของลายเซ็นละเอียด (ทุกแถวของภาพจริง)
const PIX_DIFF = 24; // ต่างกันเกินนี้ = พิกเซลไม่เหมือน
const SAME_ROW = 0.15; // แถวที่ต่างกันไม่เกิน 15% นับว่าเหมือน (เผื่อนาฬิกาเปลี่ยนนาที)
const MATCH_OK = 0.03; // ส่วนซ้อน (ขั้นคร่าว) ต่างกันเฉลี่ยไม่เกิน 3%

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

function rowDiff(A, ra, B, rb) {
  let n = 0;
  const oa = ra * MW;
  const ob = rb * MW;
  for (let x = 0; x < MW; x += 2) if (Math.abs(A.g[oa + x] - B.g[ob + x]) > PIX_DIFF) n++;
  return n / (MW / 2);
}
const fineRowDiff = (A, ra, B, rb) => {
  let sum = 0;
  const oa = ra * FW;
  const ob = rb * FW;
  for (let x = 0; x < FW; x++) sum += Math.abs(A.fg[oa + x] - B.fg[ob + x]);
  return sum / FW;
};
const fineRowSame = (A, ra, B, rb) => {
  let n = 0;
  const oa = ra * FW;
  const ob = rb * FW;
  for (let x = 0; x < FW; x++) if (Math.abs(A.fg[oa + x] - B.fg[ob + x]) > PIX_DIFF) n++;
  return n / FW < SAME_ROW;
};

// ---------- แถบบน/ล่างที่ค้างอยู่ทุกภาพ ----------
// คืนทั้งหน่วยรูปย่อ (header, footer) และพิกเซลจริง (fHeader, fFooter)
export function detectBars(sigs) {
  if (sigs.length < 2) return { header: 0, footer: 0, fHeader: 0, fFooter: 0 };
  const A = sigs[0];
  const all = (fn) => sigs.slice(1).every(fn);
  const minH = Math.min(...sigs.map((s) => s.mh));
  let header = 0;
  while (header < minH * 0.35 && all((B) => rowDiff(A, header, B, header) < SAME_ROW)) header++;
  let footer = 0;
  while (footer < minH * 0.3 && all((B) => rowDiff(A, A.mh - 1 - footer, B, B.mh - 1 - footer) < SAME_ROW)) footer++;
  const minF = Math.min(...sigs.map((s) => s.h));
  let fHeader = 0;
  while (fHeader < minF * 0.35 && all((B) => fineRowSame(A, fHeader, B, fHeader))) fHeader++;
  let fFooter = 0;
  while (fFooter < minF * 0.3 && all((B) => fineRowSame(A, A.h - 1 - fFooter, B, B.h - 1 - fFooter))) fFooter++;
  return { header, footer, fHeader, fFooter };
}

// ---------- ส่วนซ้อนระหว่างภาพบน A กับภาพล่าง B ----------
// คืน { found, score, cutA, startB } (พิกเซลจริง): ใช้ A ถึงแถว cutA, ใช้ B ตั้งแต่แถว startB
export function matchPair(A, B, bars) {
  const { header, footer, fFooter } = bars || detectBars([A, B]);
  const endA = A.mh - footer;
  const endB = B.mh - footer;
  const minL = Math.max(10, Math.round(A.mh * 0.05));

  let best = { score: 1, s: -1, L: 0 };
  for (let s = header + 1; s <= endA - minL; s++) {
    const L = Math.min(endA - s, endB - header);
    if (L < minL) continue;
    let sum = 0;
    let cnt = 0;
    const limit = best.score * (L / 2 + 1);
    for (let k = 0; k < L; k += 2) {
      const ra = s + k;
      const rb = header + k;
      if (!A.info[ra] && !B.info[rb]) continue; // พื้นเรียบทั้งคู่ ไม่ช่วยตัดสิน
      sum += rowDiff(A, ra, B, rb);
      cnt++;
      if (sum > limit) break;
    }
    if (cnt < (L / 2) * 0.15 || !cnt) continue;
    const score = sum / cnt;
    if (score < best.score) best = { score, s, L };
  }

  const fa = 1 / A.scale;
  const fb = 1 / B.scale;
  const cutA = A.h - fFooter;
  // ผ่านขั้นคร่าว หรือคะแนนก้ำกึ่งแต่ขั้นละเอียดยืนยันว่าตรงกันจริง
  const fine = best.s >= 0 && best.score <= 0.1 ? refine(A, B, best, header, fa, fb, cutA) : null;
  const found = !!fine && (best.score <= MATCH_OK || fine.diff <= 3);
  if (!found) return { found: false, score: best.score, cutA, startB: Math.round(header * fb) };
  return { found: true, score: best.score, cutA, startB: cutA - fine.off };
}

// ขั้นละเอียด: ระยะเลื่อนที่ตรงที่สุดระดับพิกเซล (±8 px รอบค่าคร่าวๆ)
function refine(A, B, best, header, fa, fb, cutA) {
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
  return { off: bestOff, diff: bestD };
}

// ภาพซ้ำ (แคปซ้ำโดยไม่ได้เลื่อน): เนื้อหาเหมือนกันแทบทั้งหมด
export function isDuplicate(A, B, bars) {
  if (Math.abs(A.mh - B.mh) > 2) return false;
  let sum = 0;
  let n = 0;
  for (let r = bars.header; r < Math.min(A.mh, B.mh) - bars.footer; r += 3) {
    sum += rowDiff(A, r, B, r);
    n++;
  }
  return n > 0 && sum / n < 0.01;
}

// ---------- เรียงลำดับอัตโนมัติ ----------
// cost(i→j) = คะแนนส่วนซ้อน ถ้าต่อกันได้ / 10 ถ้าต่อไม่ได้ (เอนตามลำดับชื่อไฟล์เล็กน้อย)
// ≤ 12 ภาพ: หาลำดับที่ดีที่สุดจริง (Held–Karp) · มากกว่านั้น: ต่อทีละภาพที่ดีที่สุด
export function bestOrder(n, match, nameRank) {
  const cost = (i, j) => {
    const m = match[i][j];
    if (m && m.found) return m.score;
    return 10 + (nameRank[j] < nameRank[i] ? 1 : 0);
  };
  if (n <= 1) return [...Array(n).keys()];
  if (n <= 12) {
    const N = 1 << n;
    const dp = new Float64Array(N * n).fill(Infinity);
    const prev = new Int8Array(N * n).fill(-1);
    for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = nameRank[i] * 1e-6; // เสมอกัน: เริ่มจากชื่อแรก
    for (let mask = 1; mask < N; mask++)
      for (let j = 0; j < n; j++) {
        const v = dp[mask * n + j];
        if (!(mask & (1 << j)) || v === Infinity) continue;
        for (let k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          const nm = mask | (1 << k);
          const c = v + cost(j, k);
          if (c < dp[nm * n + k]) {
            dp[nm * n + k] = c;
            prev[nm * n + k] = j;
          }
        }
      }
    let end = 0;
    for (let j = 1; j < n; j++) if (dp[(N - 1) * n + j] < dp[(N - 1) * n + end]) end = j;
    const order = [];
    let mask = N - 1;
    let cur = end;
    while (cur >= 0) {
      order.push(cur);
      const p = prev[mask * n + cur];
      mask &= ~(1 << cur);
      cur = p;
    }
    return order.reverse();
  }
  const hasIn = new Array(n).fill(false);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && match[i][j]?.found) hasIn[j] = true;
  const used = new Array(n).fill(false);
  const order = [];
  let cur = [...Array(n).keys()].sort((a, b) => hasIn[a] - hasIn[b] || nameRank[a] - nameRank[b])[0];
  while (cur !== undefined) {
    order.push(cur);
    used[cur] = true;
    let nxt;
    let bc = Infinity;
    for (let k = 0; k < n; k++)
      if (!used[k] && cost(cur, k) < bc) {
        bc = cost(cur, k);
        nxt = k;
      }
    cur = nxt;
  }
  return order;
}

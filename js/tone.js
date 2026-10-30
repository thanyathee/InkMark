// ปรับแสงสี + ตัวช่วยวิเคราะห์รายรูป (ทำงานในเครื่อง ไม่ใช้เน็ต)
// แนวภาพข่าว/เพจองค์กร: สว่างได้มาตรฐาน สีขาวเป็นขาว หน้าคนไม่มืด ไฮไลต์ไม่จ้า คมเล็กน้อย สีไม่ฉูดฉาด
//
// ขั้นตอนต่อพิกเซล: สมดุลแสงขาว + ช่วงแสง + ความสว่าง (LUT) → ยกเงา/ลดส่วนสว่างแบบเฉพาะจุด
//                → คอนทราสต์ (S-curve) → ความสดของสี → ความคม

export const TONE_SLIDERS = [
  { key: 'b', label: 'ความสว่าง', min: -50, max: 50 },
  { key: 'c', label: 'คอนทราสต์', min: -50, max: 50 },
  { key: 'sh', label: 'ยกเงามืด', min: 0, max: 60 },
  { key: 'hl', label: 'ลดส่วนสว่างจ้า', min: 0, max: 60 },
  { key: 'v', label: 'ความสดของสี', min: -50, max: 50 },
  { key: 'w', label: 'โทนเย็น ↔ อุ่น', min: -50, max: 50 },
  { key: 's', label: 'ความคม', min: 0, max: 50 },
];

export const emptyTone = () => ({ b: 0, c: 0, sh: 0, hl: 0, v: 0, w: 0, s: 0 });

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- วิเคราะห์รูป ----------
export function analyzeAuto(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const hist = new Float64Array(256);
  let n = 0;
  let sum = 0;
  let cw = 0;
  let csum = 0;
  let wr = 0;
  let wg = 0;
  let wbS = 0;
  let wn = 0;
  let sw = 0;
  let ssum = 0;
  let nS = 0;
  const histS = new Float64Array(256);
  let satSum = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mn = 0;
  let bright = 0;
  let dark = 0;
  let clipHi = 0;
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 120000)));
  for (let y = 0; y < H; y += step) {
    const ny = y / H - 0.55;
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = lumOf(r, g, b) / 255;
      const mx = Math.max(r, g, b);
      hist[Math.min(255, (l * 255) | 0)]++;
      n++;
      sum += l;
      // วัดแสงเน้นกลางภาพ (ตัวแบบมักอยู่กลาง-ล่าง)
      const nx = x / W - 0.5;
      const wgt = Math.exp(-(nx * nx + ny * ny) / (2 * 0.22 * 0.22));
      cw += wgt;
      csum += l * wgt;
      // วัดแสง "ตัวแบบ": ไม่นับของขาว/ท้องฟ้าที่สว่างจัด (เช่น ถุงของบริจาคสีขาว) ไม่ให้หลอกว่ารูปสว่างแล้ว
      if (l < 0.82) {
        sw += wgt;
        ssum += l * wgt;
        histS[Math.min(255, (l * 255) | 0)]++;
        nS++;
      }
      satSum += mx ? (mx - Math.min(r, g, b)) / mx : 0;
      // สมดุลแสงขาว: ใช้ของที่ "ควรเป็นสีขาว/เทา" (สว่าง สีไม่จัด เช่น กระดาษ ถุง ผนังขาว)
      // ผนังไม้/หินสีน้ำตาลสีจัดกว่าจะไม่ถูกนับ จึงไม่หลอกระบบ
      const sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
      if (l > 0.62 && l < 0.97 && sat < 0.35) {
        wr += r;
        wg += g;
        wbS += b;
        wn++;
      }
      if (l > 0.2 && l < 0.9 && sat < 0.22) {
        mr += r;
        mg += g;
        mb += b;
        mn++;
      }
      if (l > 0.8) bright++;
      if (l < 0.25) dark++;
      if (l > 0.98) clipHi++;
    }
  }
  const pct = (p) => {
    const t = n * p;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= t) return i / 255;
    }
    return 1;
  };
  let medS = 0.5;
  for (let i = 0, acc = 0; i < 256; i++) {
    acc += histS[i];
    if (acc >= nS / 2) {
      medS = i / 255;
      break;
    }
  }
  return {
    mean: sum / n,
    center: csum / cw,
    subject: nS > n * 0.1 ? 0.6 * (ssum / sw) + 0.4 * medS : csum / cw,
    p005: pct(0.005),
    p05: pct(0.05),
    p50: pct(0.5),
    p95: pct(0.95),
    p995: pct(0.995),
    bright: bright / n,
    dark: dark / n,
    clipHi: clipHi / n,
    sat: satSum / n,
    rgb: wn > n * 0.02 ? [wr / wn, wg / wn, wbS / wn] : mn > n * 0.03 ? [mr / mn, mg / mn, mb / mn] : null,
  };
}

// แปลงผลวิเคราะห์เป็นค่าปรับ + เหตุผลที่อ่านเข้าใจได้
export function autoAdjust(st) {
  const notes = [];
  const tone = emptyTone();

  // 1) สมดุลแสงขาว (gray-world บนโทนกลาง ปรับแค่บางส่วนเพื่อไม่ให้ฉากสีจริงเพี้ยน)
  let wb = [1, 1, 1];
  if (st.rgb) {
    const [r, g, b] = st.rgb;
    const gray = (r + g + b) / 3;
    wb = [r, g, b].map((c) => 1 + clamp(gray / c - 1, -0.15, 0.15) * 0.7);
    const dev = Math.max(...wb.map((x) => Math.abs(x - 1)));
    if (dev > 0.025) {
      if (b < Math.min(r, g) - 4) notes.push('แสงอมเหลือง/ส้ม → แก้ให้ขาวขึ้น');
      else if (b > r + 4) notes.push('แสงอมฟ้า → แก้ให้อุ่นขึ้น');
      else if (g > r && g > b) notes.push('แสงอมเขียว → แก้ให้เป็นกลาง');
      else notes.push('สีเพี้ยนเล็กน้อย → แก้สมดุลแสงขาว');
    }
  }

  // 2) ช่วงแสง (จุดดำ/จุดขาว)
  const bp = clamp(st.p005 - 0.01, 0, 0.06);
  const wp = st.clipHi > 0.01 ? 1 : clamp(st.p995 + 0.01, 0.86, 1);
  if (st.p995 - st.p005 < 0.8) notes.push('ภาพหมอง ช่วงแสงแคบ → ขยายช่วงแสง');
  const map = (x) => clamp((x - bp) / (wp - bp), 0.02, 0.98);

  // 3) ย้อนแสง: ฉากหลังสว่างมาก แต่กลางภาพ (ตัวแบบ) มืด
  const backlit = st.bright > 0.15 && st.center < st.mean - 0.03 && st.dark > 0.2;

  // 4) ความสว่าง: เป้าหมายมาตรฐานเดียวกันทุกรูป เน้นกลางภาพ
  // ภาพข่าว/เพจ นิยมสว่างสดใส: ตัวแบบควรอยู่ราว 0.54 · ลดแสงเฉพาะเมื่อสว่างเกินชัดเจน (> 0.62)
  const key = map(st.subject);
  let gamma = 1;
  if (key < 0.54) gamma = clamp(Math.log(0.54) / Math.log(key), 0.55, 1);
  else if (key > 0.62) gamma = 1 + (clamp(Math.log(0.62) / Math.log(key), 1, 1.4) - 1) * 0.5;
  if (backlit) gamma = 1 + (gamma - 1) * 0.35; // ย้อนแสงให้ "ยกเงา" ทำงานแทน ฉากหลังจะได้ไม่ขาวโพลน
  tone.b = Math.round(clamp(-80 * Math.log2(gamma), -15, 40));
  if (tone.b >= 8) notes.push(`รูปมืด → เพิ่มความสว่าง +${tone.b}`);
  else if (tone.b <= -8) notes.push(`รูปสว่างเกิน → ลดความสว่าง ${tone.b}`);

  // 5) เงามืด / ส่วนสว่างจ้า
  if (backlit) {
    tone.sh = Math.round(clamp((0.5 - st.center) * 130 + 22, 22, 55));
    notes.push(`ย้อนแสง (ตัวแบบมืดกว่าฉากหลัง) → ยกเงามืด +${tone.sh}`);
  } else if (st.dark > 0.18 && st.p05 < 0.08) {
    tone.sh = 18;
    notes.push('เงามืดเยอะ → ยกเงาให้เห็นรายละเอียด');
  } else {
    tone.sh = 8;
  }
  if (backlit) {
    tone.hl = Math.round(clamp(st.bright * 80 + 15, 20, 40));
    notes.push(`ฉากหลังสว่างจ้า → ดึงรายละเอียดกลับ +${tone.hl}`);
  } else if (st.clipHi > 0.015 || (st.bright > 0.25 && st.p995 > 0.97)) {
    tone.hl = Math.round(clamp(st.clipHi * 800 + 18, 18, 45));
    notes.push(`ส่วนสว่างจ้า → ดึงรายละเอียดกลับ +${tone.hl}`);
  } else {
    tone.hl = 6;
  }

  // 6) คอนทราสต์ / ความสด / ความคม
  const spread = st.p95 - st.p05;
  tone.c = Math.round(clamp((0.75 - spread) * 50, 0, 20)) + 6;
  if (backlit) tone.c = Math.min(tone.c, 10);
  tone.v = st.sat < 0.18 ? 18 : st.sat < 0.3 ? 10 : 4;
  if (st.sat < 0.18) notes.push('สีซีด → เพิ่มความสดเล็กน้อย');
  tone.s = 20;

  if (!notes.length) notes.push('รูปดีอยู่แล้ว → เกลาเล็กน้อย');
  return { tone, wb, levels: [bp, wp], notes };
}

// ---------- สร้างพารามิเตอร์จากค่าแถบเลื่อน ----------
// auto = { wb, levels } จากตัวช่วยวิเคราะห์ (หรือ null), tone = ค่ารายรูป, global = ค่าทั้งชุด
export function buildParams(auto, global, local) {
  const t = {};
  for (const { key } of TONE_SLIDERS) t[key] = (global?.[key] || 0) + (local?.[key] || 0);
  const noTone = TONE_SLIDERS.every(({ key }) => !t[key]);
  if (!auto && noTone) return null;

  const wb = auto?.wb || [1, 1, 1];
  const [bp, wp] = auto?.levels || [0, 1];
  const gamma = Math.pow(2, -t.b / 80);
  const k = clamp((t.c / 100) * 0.5, -0.4, 0.5);
  const gr = wb[0] * (1 + (t.w / 100) * 0.12);
  const gg = wb[1];
  const gb = wb[2] * (1 - (t.w / 100) * 0.12);

  const lut1 = (gain) => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const x = clamp(((i / 255) * gain - bp) / (wp - bp), 0, 1);
      out[i] = Math.round(Math.pow(x, gamma) * 255);
    }
    return out;
  };
  let curve = null;
  if (k) {
    curve = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      curve[i] = Math.round(clamp(x + k * (x - 0.5) * x * (1 - x) * 4, 0, 1) * 255);
    }
  }
  return {
    lr: lut1(gr),
    lg: lut1(gg),
    lb: lut1(gb),
    curve,
    sh: t.sh / 50,
    hl: t.hl / 50,
    vib: clamp(t.v, -100, 100) / 100,
    sharp: (t.s / 50) * 0.9,
  };
}

// ---------- ยกเงา/ลดส่วนสว่างแบบเฉพาะจุด (ดูความสว่างของบริเวณรอบๆ ไม่ใช่ทั้งภาพ) ----------
function localTone(d, W, H, sh, hl) {
  const ds = Math.max(1, Math.round(Math.max(W, H) / 96));
  const mw = Math.ceil(W / ds);
  const mh = Math.ceil(H / ds);
  let m = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const py = Math.min(H - 1, y * ds + (ds >> 1));
    for (let x = 0; x < mw; x++) {
      const i = (py * W + Math.min(W - 1, x * ds + (ds >> 1))) * 4;
      m[y * mw + x] = lumOf(d[i], d[i + 1], d[i + 2]) / 255;
    }
  }
  // เบลอแผนที่ความสว่าง (box blur 3 รอบ ≈ gaussian)
  const tmp = new Float32Array(mw * mh);
  const R = 2;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        let s = 0;
        let c = 0;
        for (let k = -R; k <= R; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < mw) {
            s += m[y * mw + xx];
            c++;
          }
        }
        tmp[y * mw + x] = s / c;
      }
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        let s = 0;
        let c = 0;
        for (let k = -R; k <= R; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < mh) {
            s += tmp[yy * mw + x];
            c++;
          }
        }
        m[y * mw + x] = s / c;
      }
  }
  // ตารางอัตราขยาย: 64 ระดับความสว่างรอบข้าง × 256 ระดับพิกเซล
  const BINS = 64;
  const gainLut = new Float32Array(BINS * 256);
  for (let bi = 0; bi < BINS; bi++) {
    const lb = bi / (BINS - 1);
    const ws = (1 - lb) * (1 - lb);
    const wh = lb * lb;
    const g = Math.pow(2, -sh * ws * 1.1 + hl * wh * 0.9);
    for (let v = 0; v < 256; v++) {
      const L = Math.max(v, 1) / 255;
      gainLut[bi * 256 + v] = Math.pow(L, g) / L;
    }
  }
  for (let y = 0; y < H; y++) {
    const fy = Math.min(mh - 1, y / ds);
    const y0 = fy | 0;
    const y1 = Math.min(mh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(mw - 1, x / ds);
      const x0 = fx | 0;
      const x1 = Math.min(mw - 1, x0 + 1);
      const tx = fx - x0;
      const lb =
        (m[y0 * mw + x0] * (1 - tx) + m[y0 * mw + x1] * tx) * (1 - ty) +
        (m[y1 * mw + x0] * (1 - tx) + m[y1 * mw + x1] * tx) * ty;
      const i = (y * W + x) * 4;
      const L = lumOf(d[i], d[i + 1], d[i + 2]) | 0;
      const gain = gainLut[((lb * (BINS - 1) + 0.5) | 0) * 256 + L];
      d[i] *= gain;
      d[i + 1] *= gain;
      d[i + 2] *= gain;
    }
  }
  m = null;
}

// ---------- ความคม (unsharp mask) ----------
function sharpen(d, W, H, amount) {
  const r = Math.max(1, Math.round(Math.min(W, H) / 1400));
  const n = W * H;
  const blur = new Uint8ClampedArray(n * 3);
  const row = new Float32Array(Math.max(W, H));
  for (let c = 0; c < 3; c++) {
    // แนวนอน
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += d[(y * W + clamp(k, 0, W - 1)) * 4 + c];
      for (let x = 0; x < W; x++) {
        row[x] = s / (2 * r + 1);
        s += d[(y * W + Math.min(W - 1, x + r + 1)) * 4 + c] - d[(y * W + Math.max(0, x - r)) * 4 + c];
      }
      for (let x = 0; x < W; x++) blur[(y * W + x) * 3 + c] = row[x];
    }
    // แนวตั้ง
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += blur[(clamp(k, 0, H - 1) * W + x) * 3 + c];
      for (let y = 0; y < H; y++) {
        row[y] = s / (2 * r + 1);
        s += blur[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - blur[(Math.max(0, y - r) * W + x) * 3 + c];
      }
      for (let y = 0; y < H; y++) blur[(y * W + x) * 3 + c] = row[y];
    }
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const j = p * 3;
    d[i] += (d[i] - blur[j]) * amount;
    d[i + 1] += (d[i + 1] - blur[j + 1]) * amount;
    d[i + 2] += (d[i + 2] - blur[j + 2]) * amount;
  }
}

export function applyTone(imageData, p) {
  const d = imageData.data;
  const W = imageData.width;
  const H = imageData.height;
  const { lr, lg, lb } = p;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
  if (p.sh || p.hl) localTone(d, W, H, p.sh, p.hl);
  const { curve, vib } = p;
  if (curve || vib) {
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      if (curve) {
        r = curve[r];
        g = curve[g];
        b = curve[b];
      }
      if (vib) {
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        let f = vib > 0 ? vib * (1 - (mx - mn) / 255) : vib;
        if (r > g && g > b) f *= 0.5; // โทนสีผิว: ปรับครึ่งเดียว
        f += 1;
        r = l + (r - l) * f;
        g = l + (g - l) * f;
        b = l + (b - l) * f;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  if (p.sharp > 0) sharpen(d, W, H, p.sharp);
}

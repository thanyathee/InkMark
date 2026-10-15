// ปรับแสงสี — ตั้งค่าให้เบา (subtle) เป็นค่าเริ่มต้น เพราะรูปต้นฉบับดีอยู่แล้ว
// โหมดอัตโนมัติใช้หลักเดียวกับ Auto ของ Lightroom/Snapseed:
//   1) White balance แบบ gray-world บนโทนกลาง (แก้เหลือง/ฟ้าเบาๆ)
//   2) Levels — ตั้งจุดดำ/ขาวจาก histogram โดยไม่ให้ไฮไลต์ขาวโพลน
//   3) Gamma — ดึงความสว่างเฉลี่ยของทุกรูปเข้าหาค่ากลางของชุด (โทนทั้งชุดใกล้กัน)
//   4) S-curve คอนทราสต์อ่อนๆ + Vibrance เล็กน้อย (ถนอมสีผิว)

export const TONE_SLIDERS = [
  { key: 'b', label: 'ความสว่าง' },
  { key: 'c', label: 'คอนทราสต์' },
  { key: 'v', label: 'ความสดของสี' },
  { key: 'w', label: 'โทนเย็น ↔ อุ่น' },
];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function analyze(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hist = new Uint32Array(256);
  let n = 0;
  let sum = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mn = 0;
  for (let i = 0; i < d.length; i += 8) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
    hist[l]++;
    n++;
    sum += l;
    if (l > 38 && l < 217) {
      mr += r;
      mg += g;
      mb += b;
      mn++;
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
  return {
    mean: sum / n / 255,
    lo: pct(0.005),
    hi: pct(0.995),
    r: mn ? mr / mn : 128,
    g: mn ? mg / mn : 128,
    b: mn ? mb / mn : 128,
  };
}

// ความสว่างเป้าหมายของทั้งชุด = ค่าเฉลี่ยของชุด แต่ไม่ให้มืด/สว่างเกินช่วงที่ดูดี
export function batchTarget(statsList) {
  if (!statsList.length) return 0.46;
  const m = statsList.reduce((a, s) => a + s.mean, 0) / statsList.length;
  return clamp(m, 0.42, 0.52);
}

// รวมค่า auto + ค่าทั้งชุด (global) + ค่ารายรูป (local) เป็น LUT; คืน null ถ้าไม่ต้องปรับ
export function buildParams(stats, target, auto, global, local) {
  const adj = (k) => (global[k] || 0) + (local[k] || 0);
  const B = adj('b');
  const C = adj('c');
  const V = adj('v');
  const Wm = adj('w');
  if (!auto && !B && !C && !V && !Wm) return null;

  let gr = 1;
  let gg = 1;
  let gb = 1;
  let bp = 0;
  let wp = 1;
  let gamma = 1;
  let k = 0;
  let vib = 0;

  if (auto && stats) {
    const gray = (stats.r + stats.g + stats.b) / 3;
    gr = 1 + clamp(gray / stats.r - 1, -0.06, 0.06) * 0.6;
    gg = 1 + clamp(gray / stats.g - 1, -0.06, 0.06) * 0.6;
    gb = 1 + clamp(gray / stats.b - 1, -0.06, 0.06) * 0.6;
    bp = Math.min(stats.lo, 0.05) * 0.8;
    wp = 1 - (1 - Math.max(stats.hi, 0.9)) * 0.8;
    const m = clamp((stats.mean - bp) / (wp - bp), 0.02, 0.98);
    const t = m + (target - m) * 0.8;
    gamma = clamp(Math.log(t) / Math.log(m), 0.62, 1.3);
    k = 0.08;
    vib = 12;
  }

  gamma *= Math.pow(2, -B / 80);
  k = clamp(k + (C / 100) * 0.5, -0.4, 0.5);
  vib += V;
  gr *= 1 + (Wm / 100) * 0.12;
  gb *= 1 - (Wm / 100) * 0.12;

  const lut = (gain) => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let x = (i / 255) * gain;
      x = clamp((x - bp) / (wp - bp), 0, 1);
      x = Math.pow(x, gamma);
      x = x + k * (x - 0.5) * x * (1 - x) * 4;
      out[i] = Math.round(clamp(x, 0, 1) * 255);
    }
    return out;
  };
  return { lr: lut(gr), lg: lut(gg), lb: lut(gb), vib: clamp(vib, -100, 100) / 100 };
}

export function applyTone(imageData, p) {
  const d = imageData.data;
  const { lr, lg, lb, vib } = p;
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]];
    let g = lg[d[i + 1]];
    let b = lb[d[i + 2]];
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

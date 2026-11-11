// ปรับรูปให้ตรง: เอียง (องศา) + มุมมองแนวตั้ง/แนวนอน (แก้ภาพที่ถ่ายเงยหรือถ่ายจากด้านข้าง)
// item.geo = { r: องศา (+ = หมุนตามเข็มนาฬิกา), v: -50..50, h: -50..50 }
// ซูมเข้าให้อัตโนมัติพอดีที่จะไม่เห็นขอบว่างหลังหมุน/บิด

export const GEO_SLIDERS = [
  { key: 'r', label: 'เอียง', min: -15, max: 15, step: 0.1, unit: '°' },
  { key: 'v', label: 'แนวตั้ง', min: -50, max: 50, step: 1, unit: '' },
  { key: 'h', label: 'แนวนอน', min: -50, max: 50, step: 1, unit: '' },
];

export const hasGeom = (it) => !!(it.geo && (it.geo.r || it.geo.v || it.geo.h));

// ค่าคงที่ของการแปลง: จุดในรูปผลลัพธ์ (gx, gy) → จุดในรูปต้นฉบับ (sx, sy)
export function geoParams(geo, sw, sh) {
  const th = (-(geo.r || 0) * Math.PI) / 180;
  const p = {
    cos: Math.cos(th),
    sin: Math.sin(th),
    a: ((geo.v || 0) / 50) * 0.35,
    b: ((geo.h || 0) / 50) * 0.35,
    cx: sw / 2,
    cy: sh / 2,
    k: 1,
  };
  const inside = (k) => {
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      for (const [x, y] of [
        [t * sw, 0],
        [t * sw, sh],
        [0, t * sh],
        [sw, t * sh],
      ]) {
        const [sx, sy] = mapPoint(p, x, y, k);
        if (sx < -0.5 || sx > sw + 0.5 || sy < -0.5 || sy > sh + 0.5) return false;
      }
    }
    return true;
  };
  let lo = 1;
  let hi = 4;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (inside(m)) hi = m;
    else lo = m;
  }
  p.k = hi;
  return p;
}

export function mapPoint(p, x, y, k = p.k) {
  const px = (x - p.cx) / k;
  const py = (y - p.cy) / k;
  const rx = px * p.cos - py * p.sin;
  const ry = px * p.sin + py * p.cos;
  return [p.cx + rx * (1 + (p.a * ry) / p.cy), p.cy + ry * (1 + (p.b * rx) / p.cx)];
}

// ---------- ตั้งตรงอัตโนมัติ: หาเส้นตรงเด่นๆ ที่เกือบแนวนอน/แนวตั้ง แล้ววัดว่าเอียงไปกี่องศา ----------
// คืนค่าองศาที่ต้องหมุนแก้ หรือ null ถ้าไม่พบเส้นตรงชัดเจนพอ
export function detectTilt(canvas) {
  const r = detectTiltInfo(canvas);
  return r ? r.tilt : null;
}

export function detectTiltInfo(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // เบลอเล็กน้อยก่อนวัด: ขอบเส้นเฉียงที่เป็นขั้นบันไดของพิกเซลจะไม่ดึงค่าให้เข้าหา 0°
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let c = 0;
        for (let k = -2; k <= 2; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < W) {
            s += g[y * W + xx];
            c++;
          }
        }
        tmp[y * W + x] = s / c;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let c = 0;
        for (let k = -2; k <= 2; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < H) {
            s += tmp[yy * W + x];
            c++;
          }
        }
        g[y * W + x] = s / c;
      }
  }
  const RANGE = 12;
  const BINS = RANGE * 20 * 2 + 1; // ละเอียด 0.05°
  const hist = new Float64Array(BINS);
  const mags = [];
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const sx = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
      const sy = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
      gx[i] = sx;
      gy[i] = sy;
      if ((x + y) % 7 === 0) mags.push(Math.hypot(sx, sy));
    }
  mags.sort((p, q) => p - q);
  const thr = Math.max(40, mags[Math.floor(mags.length * 0.9)] || 0);
  let total = 0;
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const m = Math.hypot(gx[i], gy[i]);
      if (m < thr) continue;
      const ang = (Math.atan2(gy[i], gx[i]) * 180) / Math.PI;
      let dev = ((ang % 90) + 90) % 90;
      if (dev > 45) dev -= 90;
      total += m;
      if (Math.abs(dev) > RANGE) continue;
      hist[Math.round((dev + RANGE) * 20)] += m;
    }
  if (!total) return null;
  // หาจุดยอดหลังเกลี่ย ±0.25°
  let best = -1;
  let bestV = 0;
  for (let b = 0; b < BINS; b++) {
    let s = 0;
    for (let k = -5; k <= 5; k++) s += hist[b + k] || 0;
    if (s > bestV) {
      bestV = s;
      best = b;
    }
  }
  // ความมั่นใจ: เส้นที่เอียงเท่ากันต้องมีมากพอ
  // ความมั่นใจ: ยอดต้องเด่นกว่าค่าเฉลี่ยของทั้งช่วงชัดเจน
  const inRange = hist.reduce((p, q) => p + q, 0);
  const conf = bestV / ((inRange / BINS) * 11);
  if (conf < 3) return null;
  // ถ่วงหาค่าเฉลี่ยรอบยอด ให้ได้ละเอียดกว่า 0.05°
  let sw = 0;
  let sv = 0;
  for (let k = -5; k <= 5; k++) {
    const v = hist[best + k] || 0;
    sw += v;
    sv += v * ((best + k) / 20 - RANGE);
  }
  const tilt = sv / sw;
  // tilt = มุมที่เส้นในรูปเอียงอยู่ (+ = เอียงตามเข็มนาฬิกา) → ต้องหมุนกลับด้านตรงข้าม
  const fix = Math.abs(tilt) < 0.15 ? 0 : -Math.round(tilt * 10) / 10;
  return { tilt: fix, conf };
}

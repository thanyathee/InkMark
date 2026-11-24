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

// จุดในรูปเดิม → จุดในรูปที่ปรับตรงแล้ว (ย้อน mapPoint ด้วยการวนประมาณค่า)
export function invertPoint(p, sx, sy) {
  const dx0 = sx - p.cx;
  const dy0 = sy - p.cy;
  let gx = p.cx + p.k * (dx0 * p.cos + dy0 * p.sin);
  let gy = p.cy + p.k * (-dx0 * p.sin + dy0 * p.cos);
  for (let i = 0; i < 8; i++) {
    const [mx, my] = mapPoint(p, gx, gy);
    const ex = sx - mx;
    const ey = sy - my;
    gx += p.k * (ex * p.cos + ey * p.sin);
    gy += p.k * (-ex * p.sin + ey * p.cos);
  }
  return [gx, gy];
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

// ---------- ตั้งตรงอัตโนมัติ (แบบหาเส้นตรงจริง) ----------
// หา "เส้นตรงยาว" ที่เกือบตั้ง (เสา ผนัง ประตู) หรือเกือบนอน (โต๊ะ กระเบื้อง ขอบหน้าต่าง) ด้วย Hough transform
// - ขอบแต่ละจุดโหวตเฉพาะมุมที่ใกล้ทิศของขอบตัวเอง (ตัดขอบมั่วๆ จากคน เสื้อผ้า ใบไม้)
// - เส้นแนวตั้งเชื่อถือได้กว่า (และเส้นใกล้กลางภาพเพี้ยนจากมุมกล้องน้อยกว่า)
// - เส้นแนวนอนใช้เมื่อเอียงไปทางเดียวกันจริง (โต๊ะ/กระเบื้องมักเฉียงตามมุมมอง)
// คืน { fix (องศาที่ต้องหมุน), family: 'v'|'h', lines: [[x1,y1,x2,y2] สัดส่วน 0..1], count } หรือ null
export function detectLines(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let g = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // เบลอเล็กน้อยกันสัญญาณรบกวน
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, x - 1);
      const b = Math.min(W - 1, x + 1);
      tmp[y * W + x] = (g[y * W + a] + 2 * g[y * W + x] + g[y * W + b]) / 4;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, y - 1);
      const b = Math.min(H - 1, y + 1);
      g[y * W + x] = (tmp[a * W + x] + 2 * tmp[y * W + x] + tmp[b * W + x]) / 4;
    }
  // ขอบ + ทิศของขอบ
  const mag = new Float32Array(W * H);
  const ang = new Float32Array(W * H); // มุมของเส้นตั้งฉากกับเส้น (องศา 0..180)
  const ms = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
      const gy = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (a < 0) a += 180;
      ang[i] = a;
      if ((x + y) % 5 === 0) ms.push(m);
    }
  g = null;
  ms.sort((p, q) => p - q);
  const thr = Math.max(40, ms[Math.floor(ms.length * 0.85)] || 0);

  // Hough: มุม normal 0..180 ทีละ 0.25° · ระยะ rho ทีละ 1 px
  const TS = 0.25;
  const NT = Math.round(180 / TS);
  const R = Math.ceil(Math.hypot(W, H));
  const NR = 2 * R + 1;
  const acc = new Uint16Array(NT * NR);
  const COS = new Float32Array(NT);
  const SIN = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    COS[t] = Math.cos((t * TS * Math.PI) / 180);
    SIN[t] = Math.sin((t * TS * Math.PI) / 180);
  }
  const RANGE = 20; // รับเฉพาะเส้นที่เอียงจากแนวตั้ง/นอนไม่เกินนี้
  const near = (a) => a <= RANGE || a >= 180 - RANGE || Math.abs(a - 90) <= RANGE;
  const pts = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mag[i] < thr) continue;
      const a = ang[i];
      if (!near(a)) continue;
      pts.push(i);
      const t0 = Math.round(a / TS);
      for (let dt = -6; dt <= 6; dt++) {
        const t = (t0 + dt + NT) % NT;
        const rho = Math.round(x * COS[t] + y * SIN[t]) + R;
        acc[t * NR + rho]++;
      }
    }
  // หายอด (เส้น) ที่ยาวพอ + กดยอดข้างเคียง
  const minVotes = Math.max(25, Math.round(Math.min(W, H) * 0.12));
  const peaks = [];
  for (let t = 0; t < NT; t++) {
    const a = t * TS;
    if (!near(a)) continue;
    for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v >= minVotes) peaks.push({ t, r, v });
    }
  }
  peaks.sort((p, q) => q.v - p.v);
  const lines = [];
  for (const p of peaks) {
    if (lines.length >= 24) break;
    if (lines.some((l) => Math.abs(l.t - p.t) <= 8 && Math.abs(l.r - p.r) <= 10)) continue;
    lines.push(p);
  }
  if (!lines.length) return null;

  // แปลงเป็นค่าเอียง: dev = มุมที่เส้นเอียงอยู่ (+ = ตามเข็มนาฬิกา) → ต้องหมุนกลับ -dev
  const info = lines.map((l) => {
    const a = l.t * TS;
    const vert = a <= RANGE || a >= 180 - RANGE;
    const dev = vert ? (a > 90 ? a - 180 : a) : a - 90;
    // ตำแหน่งแนวนอนของเส้นตั้ง ที่กลางภาพ (เส้นใกล้กลางเพี้ยนจากมุมกล้องน้อย)
    const th = (a * Math.PI) / 180;
    const rho = l.r - R;
    // ตำแหน่งของเส้นที่กลางภาพ: เส้นตั้ง = ตำแหน่ง x (ซ้าย/ขวา), เส้นนอน = ตำแหน่ง y (บน/ล่าง) · ช่วง -0.5..0.5
    let u = 0;
    if (vert && Math.abs(Math.cos(th)) > 1e-3) u = (rho - (H / 2) * Math.sin(th)) / Math.cos(th) / W - 0.5;
    if (!vert && Math.abs(Math.sin(th)) > 1e-3) u = (rho - (W / 2) * Math.cos(th)) / Math.sin(th) / H - 0.5;
    return { ...l, a, vert, dev, u, w: l.v, rho, th };
  });
  const wmed = (arr) => {
    const s = [...arr].sort((p, q) => p.dev - q.dev);
    const tot = s.reduce((p, q) => p + q.w, 0);
    let acc2 = 0;
    for (const x of s) {
      acc2 += x.w;
      if (acc2 >= tot / 2) return x.dev;
    }
    return 0;
  };
  // มุมกล้องทำให้เส้นขนานล้มเข้าหากัน: เสาซ้าย/ขวาเอียงคนละทาง (ถ่ายเงย/ก้ม)
  // และเส้นนอนบน/ล่างเอียงคนละทาง (ยืนถ่ายเฉียง) — เอียงเป็นสัดส่วนกับระยะจากกลางภาพ
  // → ฟิตเส้นตรง dev = เอียงจริง + k × ตำแหน่ง แล้วใช้ค่าที่กลางภาพ (ตัดเส้นที่ไม่เข้าพวกออกทีละรอบ)
  const famFit = (vert) => {
    const L = info.filter((l) => l.vert === vert);
    if (!L.length) return null;
    let a0 = wmed(L);
    let b0 = 0;
    const fit = (arr) => {
      let sw = 0, su = 0, sd = 0, suu = 0, sud = 0;
      for (const l of arr) {
        sw += l.w; su += l.w * l.u; sd += l.w * l.dev; suu += l.w * l.u * l.u; sud += l.w * l.u * l.dev;
      }
      const den = sw * suu - su * su;
      // ต้องมีเส้นกระจายพอถึงจะประเมินการล้มได้ ไม่งั้นใช้ค่าเฉลี่ย
      if (arr.length < 3 || den / (sw * sw) < 0.004) return [sd / sw, 0];
      const b = (sw * sud - su * sd) / den;
      return [(sd - b * su) / sw, Math.max(-12, Math.min(12, b))];
    };
    for (let iter = 0; iter < 4; iter++) {
      const tol = iter === 0 ? 3 : 1.2;
      const inl = L.filter((l) => Math.abs(l.dev - (a0 + b0 * l.u)) <= tol);
      if (!inl.length) break;
      [a0, b0] = fit(inl);
    }
    const resid = (l) => Math.abs(l.dev - (a0 + b0 * l.u));
    const used = L.filter((l) => resid(l) <= 1.2);
    const w = used.reduce((p, q) => p + q.w, 0);
    const mad = used.length ? used.reduce((p, q) => p + resid(q) * q.w, 0) / w : 9;
    return { dev: a0, slope: b0, all: L, used, w, mad, n: used.length };
  };
  const V = famFit(true);
  const Hh = famFit(false);
  const okV = V && V.n >= 1 && V.mad < 2.5;
  const okH = Hh && Hh.n >= 2 && Hh.mad < 2;
  // ทั้งสองแนวบอกตรงกัน → ใช้ร่วมกัน (แนวตั้งน้ำหนักมากกว่า) · ขัดกัน → ใช้แนวที่เชื่อถือได้กว่า
  let dev;
  let usedV = [];
  let usedH = [];
  if (okV && okH && Math.abs(V.dev - Hh.dev) <= 1) {
    dev = (V.dev * V.w * 1.5 + Hh.dev * Hh.w) / (V.w * 1.5 + Hh.w);
    usedV = V.used;
    usedH = Hh.used;
  } else if (okV && (!okH || V.w * 1.5 >= Hh.w || V.mad <= Hh.mad)) {
    dev = V.dev;
    usedV = V.used;
  } else if (okH) {
    dev = Hh.dev;
    usedH = Hh.used;
  } else if (V && V.n >= 2) {
    dev = V.dev;
    usedV = V.used;
  } else return null;
  const pick = { used: [...usedV.slice(0, 8), ...usedH.slice(0, 8)] };
  const unused = [...(V ? V.all : []), ...(Hh ? Hh.all : [])].filter((l) => !pick.used.includes(l)).slice(0, 8);

  // ช่วงจริงของเส้น (ไว้วาดให้เห็นว่าใช้เส้นไหนอ้างอิง)
  const seg = (l) => {
    const c = Math.cos(l.th);
    const s = Math.sin(l.th);
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of pts) {
      const x = i % W;
      const y = (i / W) | 0;
      if (Math.abs(x * c + y * s - l.rho) > 1.5) continue;
      if (Math.abs(((ang[i] - l.a + 270) % 180) - 90) > 4) continue;
      const u = -x * s + y * c; // ตำแหน่งตามแนวเส้น
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    }
    if (lo === Infinity) return null;
    const p = (u) => [(l.rho * c - u * s) / W, (l.rho * s + u * c) / H];
    return [...p(lo), ...p(hi)];
  };
  const fix = -Math.round(dev * 10) / 10;
  // ความไม่สมดุลจากมุมกล้อง: ความชันของการล้ม (องศาต่อระยะจากกลาง) → ค่าแถบ แนวตั้ง/แนวนอน
  // (ดูสูตรใน mapPoint: แกน x ถูกยืดด้วย 1 + a·y/cy, แกน y ด้วย 1 + b·x/cx; a,b = ค่าแถบ/50 × 0.35)
  const rad = Math.PI / 180;
  const sV = okV && usedV.length >= 3 ? V.slope : 0;
  const sH = okH && usedH.length >= 3 ? Hh.slope : 0;
  const toSlider = (k) => Math.max(-50, Math.min(50, Math.round((k / 0.35) * 50)));
  const pv = toSlider((-sV * rad * H) / (2 * W));
  const ph = toSlider((sH * rad * W) / (2 * H));
  return {
    fix: Math.abs(fix) < 0.1 ? 0 : fix,
    persp: { v: Math.abs(pv) >= 3 ? pv : 0, h: Math.abs(ph) >= 3 ? ph : 0 },
    nV: usedV.length,
    nH: usedH.length,
    lines: pick.used.map(seg).filter(Boolean), // เส้นที่ใช้อ้างอิง
    others: unused.map(seg).filter(Boolean), // เส้นที่เห็นแต่ไม่ได้ใช้ (เอียงไม่เข้าพวก)
  };
}

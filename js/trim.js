// ตรวจหาขอบสีดำ/ขาวของภาพแคปหน้าจอ (ใช้ในโหมดตัดขอบ)
// - แถวหรือคอลัมน์ที่เป็นสีขอบเกินครึ่ง นับเป็นขอบ: ตัวเลขเวลา แบต ปุ่มบนแถบจึงไม่ทำให้หยุดตัด
// - กันตัดผิด: ด้านที่ตัดต้อง (1) เป็นสีขอบ "สนิท" แบบหน้าจอเกือบทั้งแถบ และ
//   (2) ขอบเนื้อหาเป็นเส้นตรงเต็มความกว้าง — ท้องฟ้ากลางคืน พื้นมืด ผนังขาวในรูปถ่ายจึงไม่โดนตัด
// คืนกรอบเนื้อหาเป็นสัดส่วน 0..1 ของรูปเต็ม { x, y, w, h } หรือ null ถ้าไม่พบขอบ

const SAMPLE_MAX = 600;
const BORDER_FRAC = 0.5;
const RUN = 4;
const MIN_TRIM = 0.015;

// near = นับเป็นสีขอบ, pure = สีขอบสนิทแบบหน้าจอ
const COLORS = {
  black: {
    near: (mx) => mx <= 24,
    pure: (mx, mn) => mx <= 12 && mx - mn <= 6,
  },
  white: {
    near: (mx, mn) => mn >= 231,
    pure: (mx, mn) => mn >= 238 && mx - mn <= 8,
  },
};

function detectOne(src, sw, sh, color, reg) {
  const R = reg || { x: 0, y: 0, w: 1, h: 1 };
  const rw = R.w * sw;
  const rh = R.h * sh;
  const s = Math.min(1, SAMPLE_MAX / Math.max(rw, rh));
  const W = Math.max(8, Math.round(rw * s));
  const H = Math.max(8, Math.round(rh * s));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, R.x * sw, R.y * sh, rw, rh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  c.width = 0;
  const { near, pure } = COLORS[color];
  const edge = new Uint8Array(W * H);
  const solid = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    edge[p] = near(mx, mn) ? 1 : 0;
    solid[p] = pure(mx, mn) ? 1 : 0;
  }
  const rowFrac = (a, y, x0, x1) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += a[y * W + x];
    return n / (x1 - x0);
  };
  const colFrac = (a, x, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) n += a[y * W + x];
    return n / (y1 - y0);
  };
  const scan = (len, frac, from, step) => {
    for (let i = from, k = 0; k < len; i += step, k++) {
      let ok = true;
      for (let r = 0; r < RUN; r++) {
        const j = i + r * step;
        if (j < 0 || j >= len || frac(j) >= BORDER_FRAC) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
    return -1;
  };

  const top = scan(H, (y) => rowFrac(edge, y, 0, W), 0, 1);
  if (top < 0) return null;
  const bottom = scan(H, (y) => rowFrac(edge, y, 0, W), H - 1, -1);
  const left = scan(W, (x) => colFrac(edge, x, top, bottom + 1), 0, 1);
  const right = scan(W, (x) => colFrac(edge, x, top, bottom + 1), W - 1, -1);
  if (left < 0 || right <= left || bottom <= top) return null;

  // (2) ขอบเนื้อหาเป็นเส้นตรงเต็มความกว้าง
  const runOk = (fn, i, step) => {
    for (let r = 0; r < RUN; r++) if (!fn(i + r * step)) return false;
    return true;
  };
  const cRow = (y) => rowFrac(edge, y, left, right + 1) <= 0.12;
  const cCol = (x) => colFrac(edge, x, top, bottom + 1) <= 0.12;
  if (top > 0 && !runOk(cRow, top, 1)) return null;
  if (bottom < H - 1 && !runOk(cRow, bottom, -1)) return null;
  if (left > 0 && !runOk(cCol, left, 1)) return null;
  if (right < W - 1 && !runOk(cCol, right, -1)) return null;

  // (1) แถบขอบเป็นสีสนิทเกือบทั้งแถบ (มีไอคอนได้บางแถว)
  const band = (n, fn) => {
    if (!n) return true;
    let k = 0;
    for (let i = 0; i < n; i++) if (fn(i) >= 0.98) k++;
    return k / n >= 0.6;
  };
  if (!band(top, (y) => rowFrac(solid, y, 0, W))) return null;
  if (!band(H - 1 - bottom, (i) => rowFrac(solid, H - 1 - i, 0, W))) return null;
  if (!band(left, (x) => colFrac(solid, x, top, bottom + 1))) return null;
  if (!band(W - 1 - right, (i) => colFrac(solid, W - 1 - i, top, bottom + 1))) return null;

  let x0 = left > 0 ? left + 1 : 0;
  let y0 = top > 0 ? top + 1 : 0;
  let x1 = right < W - 1 ? right : W;
  let y1 = bottom < H - 1 ? bottom : H;
  if (x0 / W < MIN_TRIM) x0 = 0;
  if (y0 / H < MIN_TRIM) y0 = 0;
  if ((W - x1) / W < MIN_TRIM) x1 = W;
  if ((H - y1) / H < MIN_TRIM) y1 = H;
  if (!x0 && !y0 && x1 === W && y1 === H) return null;
  if (((x1 - x0) / W) * ((y1 - y0) / H) < 0.2) return null;
  // แปลงกลับเป็นสัดส่วนของรูปเต็ม
  return {
    x: R.x + (x0 / W) * R.w,
    y: R.y + (y0 / H) * R.h,
    w: ((x1 - x0) / W) * R.w,
    h: ((y1 - y0) / H) * R.h,
  };
}

// colors: 'black' | 'white' | 'both' — แบบ both ตัดดำก่อน แล้วตัดขาวที่เหลือ (และดำอีกรอบ)
export function detectBorders(src, sw, sh, colors = 'both') {
  const order = colors === 'both' ? ['black', 'white', 'black'] : [colors];
  let reg = null;
  for (const c of order) {
    const r = detectOne(src, sw, sh, c, reg);
    if (r) reg = r;
  }
  return reg;
}

// ตัดขอบดำอัตโนมัติ (ภาพแคปหน้าจอที่ติดพื้นหลังดำ / แถบสถานะ / ปุ่มของแอปดูรูป)
// แถวหรือคอลัมน์ที่ "ดำเกินครึ่ง" นับเป็นขอบ — ตัวเลขเวลา แบต ปุ่ม ✕ บนแถบดำจึงไม่ทำให้หยุดตัด
// คืนกรอบเนื้อหาเป็นสัดส่วน 0..1 { x, y, w, h } หรือ null ถ้าไม่มีขอบดำชัดเจน

const SAMPLE_MAX = 600;
const DARK = 24; // ค่าสีสูงสุดที่ยังนับว่า "ดำ"
const BORDER_FRAC = 0.5; // แถวที่ดำเกินครึ่ง = ขอบ
const RUN = 4; // เนื้อหาต้องต่อเนื่องอย่างน้อยกี่แถว (กันจุดสว่างเล็กๆ บนแถบดำ)
const MIN_TRIM = 0.015; // ตัดน้อยกว่านี้ไม่นับ

export function detectBorders(src, sw, sh) {
  const s = Math.min(1, SAMPLE_MAX / Math.max(sw, sh));
  const W = Math.max(8, Math.round(sw * s));
  const H = Math.max(8, Math.round(sh * s));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  c.width = 0;
  const dark = new Uint8Array(W * H);
  const black = new Uint8Array(W * H); // ดำสนิทแบบหน้าจอ (เกือบ 0,0,0 และไม่มีสีปน)
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    dark[p] = mx <= DARK ? 1 : 0;
    black[p] = mx <= 12 && mx - Math.min(d[i], d[i + 1], d[i + 2]) <= 6 ? 1 : 0;
  }

  const rowFrac = (y, x0, x1) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += dark[y * W + x];
    return n / (x1 - x0);
  };
  const colFrac = (x, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) n += dark[y * W + x];
    return n / (y1 - y0);
  };
  // หาเส้นแรกที่เป็นเนื้อหาต่อเนื่อง RUN เส้น
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

  const top = scan(H, (y) => rowFrac(y, 0, W), 0, 1);
  if (top < 0) return null; // ดำทั้งรูป
  const bottom = scan(H, (y) => rowFrac(y, 0, W), H - 1, -1);
  const left = scan(W, (x) => colFrac(x, top, bottom + 1), 0, 1);
  const right = scan(W, (x) => colFrac(x, top, bottom + 1), W - 1, -1);
  if (left < 0 || right <= left || bottom <= top) return null;

  // ตรวจว่าขอบเนื้อหาเป็น "เส้นตรงเต็มความกว้าง" แบบภาพแคปหน้าจอจริง
  // (รูปถ่ายกลางคืน ส่วนสว่างจะกินแค่บางส่วนของความกว้าง → ไม่ตัดด้านนั้น)
  const solidRow = (y) => rowFrac(y, left, right + 1) <= 0.12;
  const solidCol = (x) => colFrac(x, top, bottom + 1) <= 0.12;
  const solid = (fn, i, step) => {
    for (let r = 0; r < RUN; r++) if (!fn(i + r * step)) return false;
    return true;
  };
  const tOk = top === 0 || solid(solidRow, top, 1);
  const bOk = bottom === H - 1 || solid(solidRow, bottom, -1);
  const lOk = left === 0 || solid(solidCol, left, 1);
  const rOk = right === W - 1 || solid(solidCol, right, -1);
  if (!tOk || !bOk || !lOk || !rOk) return null;

  // แถบขอบของภาพแคปหน้าจอ "ดำสนิทเกือบทั้งแถบ" (มีแค่ไอคอนไม่กี่แถว)
  // ท้องฟ้ากลางคืน/เงามืดในรูปถ่าย มีรายละเอียดกระจายทั่ว → ไม่ใช่ขอบ
  const blackRow = (y) => {
    let n = 0;
    for (let x = 0; x < W; x++) n += black[y * W + x];
    return n / W;
  };
  const blackCol = (x) => {
    let n = 0;
    for (let y = top; y <= bottom; y++) n += black[y * W + x];
    return n / (bottom - top + 1);
  };
  const pure = (n, fn) => {
    if (!n) return true;
    let k = 0;
    for (let i = 0; i < n; i++) if (fn(i) >= 0.98) k++;
    return k / n >= 0.6;
  };
  if (!pure(top, blackRow)) return null;
  if (!pure(H - 1 - bottom, (i) => blackRow(H - 1 - i))) return null;
  if (!pure(left, blackCol)) return null;
  if (!pure(W - 1 - right, (i) => blackCol(W - 1 - i))) return null;

  // ขยับเข้าอีก 1 พิกเซลของรูปตัวอย่าง กันเส้นดำบางๆ ค้างที่ขอบ
  let x0 = left > 0 ? left + 1 : 0;
  let y0 = top > 0 ? top + 1 : 0;
  let x1 = right < W - 1 ? right : W;
  let y1 = bottom < H - 1 ? bottom : H;
  if (x0 / W < MIN_TRIM) x0 = 0;
  if (y0 / H < MIN_TRIM) y0 = 0;
  if ((W - x1) / W < MIN_TRIM) x1 = W;
  if ((H - y1) / H < MIN_TRIM) y1 = H;
  if (!x0 && !y0 && x1 === W && y1 === H) return null;
  const r = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
  if (r.w * r.h < 0.2) return null; // เหลือน้อยผิดปกติ ไม่ตัด
  return r;
}

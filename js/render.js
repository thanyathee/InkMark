// ขั้นตอนประมวลผลต่อรูป: ตัด/ย่อ → ปรับแสงสี → ลายน้ำ (ลายน้ำทำท้ายสุด สีจะได้ไม่เพี้ยน)
import { outputSize, cropFrac } from './crop.js';
import { analyzeAuto, buildParams, applyTone, emptyTone } from './tone.js';
import { readShotDate } from './exif.js';
import { drawWatermark } from './watermark.js';
import { hasGeom, geoParams } from './geometry.js';

// Safari บน iPhone จำกัดขนาด canvas (~16 ล้านพิกเซล) จึงเก็บต้นฉบับไว้ไม่เกินนี้
const SOURCE_MAX = 3072;
const THUMB_MAX = 720;
// เพดานพิกเซลของ canvas บน iPhone
const CANVAS_MAX_PX = 16e6;

let nextId = 1;

// ช่วงสีกว้าง Display P3 (รูปจาก iPhone) — ใช้ตอนบันทึกถ้าเบราว์เซอร์รองรับ สีสดจะไม่ถูกตัด
const P3 = (() => {
  try {
    const ctx = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' });
    return ctx.getContextAttributes?.().colorSpace === 'display-p3';
  } catch {
    return false;
  }
})();
export const P3_SUPPORTED = P3;
const ctx2d = (c, p3, extra = {}) => c.getContext('2d', p3 && P3 ? { ...extra, colorSpace: 'display-p3' } : extra);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

export function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );
}

function scaledCanvas(src, sw, sh, maxSide) {
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s);
  c.height = Math.round(sh * s);
  drawScaled(c.getContext('2d'), src, { x: 0, y: 0, w: sw, h: sh }, c.width, c.height);
  return c;
}

// ย่อทีละครึ่งเมื่อย่อมากๆ เพื่อไม่ให้ภาพแตกเป็นหยัก
function drawScaled(ctx, src, r, W, H, p3 = false) {
  let cur = src;
  let { x, y, w, h } = r;
  while (w / W > 2 && h / H > 2) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2);
    c.height = Math.round(h / 2);
    const cx = ctx2d(c, p3);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(cur, x, y, w, h, 0, 0, c.width, c.height);
    if (cur !== src) cur.width = 0;
    cur = c;
    x = 0;
    y = 0;
    w = c.width;
    h = c.height;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, x, y, w, h, 0, 0, W, H);
  if (cur !== src) cur.width = 0;
}

// วาดรูปที่หมุน/แก้มุมมองแล้ว: แต่ละพิกเซลผลลัพธ์ย้อนไปหาตำแหน่งในต้นฉบับ (bilinear)
// f = กรอบตัด (สัดส่วน 0..1 ของรูปที่ปรับตรงแล้ว ซึ่งขนาดเท่าต้นฉบับ)
function drawWarped(ctx, src, sw, sh, geo, f, W, H, p3) {
  // ย่อต้นฉบับก่อนให้ใกล้ขนาดที่ต้องใช้ (คมกว่า และไม่กินหน่วยความจำ)
  const need = W / (f.w * sw);
  const ps = Math.min(1, need * 1.3, Math.sqrt(16e6 / (sw * sh)));
  const pw = Math.max(2, Math.round(sw * ps));
  const ph = Math.max(2, Math.round(sh * ps));
  const pre = document.createElement('canvas');
  pre.width = pw;
  pre.height = ph;
  const pctx = ctx2d(pre, p3, { willReadFrequently: true });
  drawScaled(pctx, src, { x: 0, y: 0, w: sw, h: sh }, pw, ph, p3);
  const sd = pctx.getImageData(0, 0, pw, ph).data;
  pre.width = 0;
  const out = ctx.createImageData(W, H);
  const od = out.data;
  const P = geoParams(geo, sw, sh);
  const { cos, sin, a, b, cx, cy, k } = P;
  const sx0 = pw / sw;
  const sy0 = ph / sh;
  for (let v = 0; v < H; v++) {
    const gy = (f.y + ((v + 0.5) / H) * f.h) * sh;
    const py = (gy - cy) / k;
    for (let u = 0; u < W; u++) {
      const gx = (f.x + ((u + 0.5) / W) * f.w) * sw;
      const px = (gx - cx) / k;
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      let x = (cx + rx * (1 + (a * ry) / cy)) * sx0 - 0.5;
      let y = (cy + ry * (1 + (b * rx) / cx)) * sy0 - 0.5;
      if (x < 0) x = 0;
      else if (x > pw - 1.001) x = pw - 1.001;
      if (y < 0) y = 0;
      else if (y > ph - 1.001) y = ph - 1.001;
      const x0 = x | 0;
      const y0 = y | 0;
      const tx = x - x0;
      const ty = y - y0;
      const i00 = (y0 * pw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + pw * 4;
      const i11 = i01 + 4;
      const o = (v * W + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * tx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * tx;
        od[o + c] = top + (bot - top) * ty;
      }
      od[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// รูปเต็มที่ปรับตรงแล้ว (ไว้แสดงในช่อง "รูปเต็ม" ของหน้าแก้ไข)
export function renderStraight(src, item, into, W, H) {
  into.width = W;
  into.height = H;
  const ctx = into.getContext('2d', { willReadFrequently: true });
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  drawWarped(ctx, src, sw, sh, item.geo, { x: 0, y: 0, w: 1, h: 1 }, W, H, false);
  return into;
}

// แปลงไฟล์เป็นรายการรูป: เก็บต้นฉบับย่อ (JPEG) + รูปย่อสำหรับพรีวิว + ผลวิเคราะห์แสง + วันที่ถ่าย
export async function prepareItem(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const full = scaledCanvas(img, w0, h0, SOURCE_MAX);
    const blob = await toBlob(full, 'image/jpeg', 0.95);
    const thumb = scaledCanvas(full, full.width, full.height, THUMB_MAX);
    const item = {
      id: nextId++,
      name: file.name || `photo-${nextId}.jpg`,
      file, // ไฟล์ต้นฉบับ ใช้ตอนบันทึกโหมด "ต้นฉบับ" ให้ได้ขนาดเดิมเต็มๆ
      blob,
      w: full.width,
      h: full.height,
      thumb,
      stats: analyzeAuto(thumb),
      date: await readShotDate(file), // 'YYYYMMDD' หรือ null
      fx: 0.5,
      fy: 0.5,
      zoom: 1,
      tone: emptyTone(),
      auto: null, // { wb, levels } จากตัวช่วยวิเคราะห์
      notes: [],
    };
    full.width = 0;
    return item;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// โหมดต้นฉบับ: เปิดจากไฟล์เดิม (ขนาดเต็ม) ถ้าไม่ได้ค่อยใช้ตัวที่เก็บไว้
export async function loadOriginal(item) {
  if (item.file) {
    const url = URL.createObjectURL(item.file);
    try {
      return await loadImage(url);
    } catch {
      /* ใช้ blob แทน */
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return loadSource(item.blob);
}

// รูปขนาดกลางสำหรับหน้าแก้ไข (คมกว่ารูปย่อในตาราง)
export async function workCanvas(item, maxSide) {
  const src = await loadSource(item.blob);
  const c = scaledCanvas(src, src.width || src.naturalWidth, src.height || src.naturalHeight, maxSide);
  if (src.close) src.close();
  return c;
}

export async function loadSource(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* ใช้ Image แทน */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// opts: { maxSide, tone (default true), into (canvas ที่จะวาดลง), p3 (ใช้ช่วงสี P3) }
export function renderImage(src, item, settings, opts = {}) {
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  const f = cropFrac(settings.mode, sw, sh, item);
  const out = outputSize(settings.mode, settings.size, sw, sh);
  let W = out.w;
  let H = out.h;
  if (settings.mode === 'orig') {
    // ต้นฉบับ + ซูม: ได้เฉพาะส่วนที่เลือก ขนาดตามพิกเซลจริง (ไม่ขยาย จึงคมเต็มที่)
    W = Math.max(1, Math.round(f.w * sw));
    H = Math.max(1, Math.round(f.h * sh));
  }
  if (W * H > CANVAS_MAX_PX) {
    const s = Math.sqrt(CANVAS_MAX_PX / (W * H));
    W = Math.floor(W * s);
    H = Math.floor(H * s);
  }
  if (opts.maxSide) {
    const s = Math.min(1, opts.maxSide / Math.max(W, H));
    W = Math.max(1, Math.round(W * s));
    H = Math.max(1, Math.round(H * s));
  }
  const c = opts.into || document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = ctx2d(c, opts.p3 && !opts.into, { willReadFrequently: true });
  if (hasGeom(item)) drawWarped(ctx, src, sw, sh, item.geo, f, W, H, opts.p3);
  else drawScaled(ctx, src, { x: f.x * sw, y: f.y * sh, w: f.w * sw, h: f.h * sh }, W, H, opts.p3);

  if (opts.tone !== false) {
    const p = buildParams(item.auto, settings.global, item.tone);
    if (p) {
      const id = ctx.getImageData(0, 0, W, H);
      applyTone(id, p);
      ctx.putImageData(id, 0, 0);
    }
  }
  if (settings.wm.on) drawWatermark(ctx, W, H, settings.wm);
  return c;
}

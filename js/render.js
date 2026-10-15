// ขั้นตอนประมวลผลต่อรูป: ตัด/ย่อ → ปรับแสงสี → ลายน้ำ (ลายน้ำทำท้ายสุด สีจะได้ไม่เพี้ยน)
import { outputSize, cropFrac } from './crop.js';
import { analyze, buildParams, applyTone } from './tone.js';
import { drawWatermark } from './watermark.js';

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

// แปลงไฟล์เป็นรายการรูป: เก็บต้นฉบับย่อ (JPEG) + รูปย่อสำหรับพรีวิว + ค่าวิเคราะห์แสง
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
      stats: analyze(thumb),
      fx: 0.5,
      fy: 0.5,
      zoom: 1,
      tone: { b: 0, c: 0, v: 0, w: 0 },
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

// opts: { maxSide, tone (default true), target, into (canvas ที่จะวาดลง), p3 (ใช้ช่วงสี P3) }
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
  drawScaled(ctx, src, { x: f.x * sw, y: f.y * sh, w: f.w * sw, h: f.h * sh }, W, H, opts.p3);

  if (opts.tone !== false) {
    const p = buildParams(item.stats, opts.target, settings.auto, settings.global, item.tone);
    if (p) {
      const id = ctx.getImageData(0, 0, W, H);
      applyTone(id, p);
      ctx.putImageData(id, 0, 0);
    }
  }
  if (settings.wm.on) drawWatermark(ctx, W, H, settings.wm);
  return c;
}

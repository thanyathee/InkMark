// ลายน้ำ: ขนาดและระยะขอบคิดจาก "ด้านสั้น" ของภาพ ทุกรูปจึงได้สัดส่วนเดียวกัน
// ระยะขอบแนวนอน = ระยะขอบแนวตั้ง (วัดจากขอบตัวอักษรจริง ไม่ใช่กล่องข้อความ)
// ตำแหน่ง o.pos = แนวตั้ง (t/m/b) + แนวนอน (l/c/r) เช่น 'br' = ขวาล่าง

export const WM_SIZES = { S: 0.026, M: 0.033, L: 0.042 };
export const WM_MARGIN = 0.035;
export const WM_COLORS = { white: '#ffffff', black: '#1a1a1a', blue: '#0b3d91' };
const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

function hexLum(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

function areaLum(ctx, x, y, w, h) {
  if (w < 1 || h < 1) return 0.5;
  const d = ctx.getImageData(x, y, w, h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4) / 255;
}

export function drawWatermark(ctx, W, H, o) {
  const text = (o.text || '').trim();
  if (!text) return;
  const short = Math.min(W, H);
  const fs = Math.max(6, short * (WM_SIZES[o.size] || WM_SIZES.M));
  const margin = short * WM_MARGIN;

  ctx.save();
  ctx.font = `700 ${fs}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft || 0;
  const right = m.actualBoundingBoxRight || m.width;
  const asc = m.actualBoundingBoxAscent || fs * 0.72;
  const desc = m.actualBoundingBoxDescent || 0;
  const pos = o.pos || 'br';
  const tw = left + right;
  const th = asc + desc;
  const x = pos[1] === 'l' ? margin + left : pos[1] === 'c' ? (W - tw) / 2 + left : W - margin - right;
  const y = pos[0] === 't' ? margin + asc : pos[0] === 'm' ? (H - th) / 2 + asc : H - margin - desc;

  let color = o.color === 'custom' ? o.custom : WM_COLORS[o.color];
  if (!color) {
    // อัตโนมัติ: ดูความสว่างพื้นหลังตรงตำแหน่งลายน้ำ
    const bx = Math.max(0, Math.floor(x - left));
    const by = Math.max(0, Math.floor(y - asc));
    const lum = areaLum(ctx, bx, by, Math.min(W - bx, Math.ceil(left + right)), Math.min(H - by, Math.ceil(asc + desc)));
    color = lum > 0.62 ? WM_COLORS.black : WM_COLORS.white;
  }
  const light = hexLum(color) > 0.5;
  ctx.globalAlpha = o.opacity ?? 0.9;
  ctx.shadowColor = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)';
  ctx.shadowBlur = fs * 0.25;
  ctx.shadowOffsetY = fs * 0.04;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

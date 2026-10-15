// โหมดขนาดภาพ: แบบมีสัดส่วน (ตัดกรอบ) หรือแบบกำหนดกว้าง/สูงอย่างเดียว (ไม่ตัด)
export const SIZE_MODES = [
  { id: '4:5', label: '4:5 แนวตั้ง', ratio: 4 / 5 },
  { id: '1:1', label: '1:1 จัตุรัส', ratio: 1 },
  { id: '3:2', label: '3:2 แนวนอน', ratio: 3 / 2 },
  { id: '16:9', label: '16:9 กว้าง', ratio: 16 / 9 },
  { id: 'w', label: 'กว้างเท่ากัน' },
  { id: 'h', label: 'สูงเท่ากัน' },
];

export const SIZES = [1080, 1440, 2048];

export function modeOf(id) {
  return SIZE_MODES.find((m) => m.id === id) || SIZE_MODES[0];
}

export function isCropMode(id) {
  return !!modeOf(id).ratio;
}

// ขนาดไฟล์ผลลัพธ์ (px)
export function outputSize(id, size, sw, sh) {
  const m = modeOf(id);
  if (m.ratio) return { w: size, h: Math.round(size / m.ratio) };
  if (m.id === 'w') return { w: size, h: Math.round((size * sh) / sw) };
  return { w: Math.round((size * sw) / sh), h: size };
}

// กรอบตัดภาพเป็นสัดส่วน 0..1 ของภาพต้นฉบับ
// item.fx / item.fy = ตำแหน่งกรอบ (0 = ชิดซ้าย/บน, 1 = ชิดขวา/ล่าง), item.zoom >= 1
export function cropFrac(id, sw, sh, item) {
  const m = modeOf(id);
  if (!m.ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const S = sw / sh;
  let cw = 1;
  let ch = 1;
  if (S > m.ratio) cw = m.ratio / S;
  else ch = S / m.ratio;
  const z = item.zoom || 1;
  cw /= z;
  ch /= z;
  return { x: (1 - cw) * item.fx, y: (1 - ch) * item.fy, w: cw, h: ch };
}

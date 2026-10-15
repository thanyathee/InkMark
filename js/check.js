// หน้าตรวจเครื่อง: รันขั้นตอนจริงของแอป (นำเข้า → ตัด/ย่อ → แสงสี → ลายน้ำ → JPEG) บนเครื่องผู้ใช้
import { prepareItem, loadOriginal, renderImage, toBlob, P3_SUPPORTED } from './render.js';

const $ = (s) => document.querySelector(s);
const list = $('#list');
$('#ua').textContent = navigator.userAgent;

function row(label) {
  const li = document.createElement('li');
  li.textContent = `⏳ ${label}`;
  list.append(li);
  return (ok, detail = '') => {
    li.innerHTML = `${ok === true ? '✅' : ok === false ? '❌' : '⚠️'} ${label}${detail ? `<small>${detail}</small>` : ''}`;
    return ok;
  };
}

// สร้างรูปทดสอบขนาดเท่ารูปจาก iPhone (สีสด + รายละเอียดเล็กๆ ไว้ดูความคม)
async function makeTestFile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1b2a3a');
  g.addColorStop(1, '#c8643c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `hsl(${i * 37} 80% 55%)`;
    ctx.beginPath();
    ctx.arc((i * 997) % w, (i * 613) % h, 40 + (i % 7) * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const blob = await toBlob(c, 'image/jpeg', 0.9);
  c.width = 0;
  return new File([blob], 'test_iphone.jpg', { type: 'image/jpeg' });
}

// อ่านโปรไฟล์สีที่ฝังใน JPEG: คืน 'Display P3' / 'sRGB' / null
async function jpegProfile(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const sig = [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0]; // "ICC_PROFILE\0"
  let i = -1;
  for (let k = 0; k < Math.min(b.length, 200000) && i < 0; k++) {
    if (sig.every((v, j) => b[k + j] === v)) i = k + 14;
  }
  if (i < 0) return null;
  const dv = new DataView(b.buffer, i);
  const n = dv.getUint32(128);
  for (let t = 0; t < n; t++) {
    const o = 132 + t * 12;
    if (String.fromCharCode(b[i + o], b[i + o + 1], b[i + o + 2], b[i + o + 3]) === 'rXYZ') {
      const x = dv.getInt32(dv.getUint32(o + 4) + 8) / 65536;
      return x > 0.48 ? 'Display P3' : 'sRGB';
    }
  }
  return 'ไม่ทราบ';
}

const base = {
  size: 2048,
  auto: true,
  global: { b: 0, c: 0, v: 0, w: 0 },
  wm: { on: true, text: '#TISCOFOUNDATION', pos: 'br', size: 'M', color: 'auto', custom: '#ffffff', opacity: 0.9 },
};

async function run() {
  list.textContent = '';
  $('#result').textContent = '';
  $('#run').disabled = true;
  const results = [];
  const step = async (label, fn) => {
    const done = row(label);
    try {
      const [ok, detail] = await fn();
      results.push(done(ok, detail));
    } catch (e) {
      results.push(done(false, String(e && e.message ? e.message : e)));
    }
    await new Promise((r) => setTimeout(r, 30));
  };

  let file;
  let item;
  await step('สร้างรูปทดสอบ 4032×3024 (เท่ารูป 12MP)', async () => {
    file = await makeTestFile(4032, 3024);
    return [true, `${(file.size / 1e6).toFixed(1)} MB`];
  });
  await step('นำรูปเข้าแอป', async () => {
    item = await prepareItem(file);
    return [true, `เก็บไว้ ${item.w}×${item.h}`];
  });

  const exportCase = async (label, settings, edit, expect) =>
    step(label, async () => {
      const it = { ...item, ...edit };
      const t0 = performance.now();
      const src = await loadOriginal(it);
      const c = renderImage(src, it, settings, { target: 0.46, p3: true });
      const blob = await toBlob(c, 'image/jpeg', 0.92);
      const dims = `${c.width}×${c.height}`;
      c.width = 0;
      const ms = Math.round(performance.now() - t0);
      return [dims === expect, `ได้ ${dims} (ควรเป็น ${expect}) · ${(blob.size / 1e6).toFixed(1)} MB · ${ms} ms`];
    });

  await exportCase('บันทึก 4:5 ที่ 2048 จากรูปแนวนอน', { ...base, mode: '4:5' }, {}, '2048×2560');
  await exportCase('บันทึกโหมดต้นฉบับ', { ...base, mode: 'orig' }, {}, '4032×3024');
  await exportCase('ต้นฉบับ + ซูม 125%', { ...base, mode: 'orig' }, { zoom: 1.25, fx: 1, fy: 0 }, '3226×2419');

  await step('รูป 48MP (8064×6048) โหมดต้นฉบับ', async () => {
    const big = await prepareItem(await makeTestFile(8064, 6048));
    const src = await loadOriginal(big);
    const c = renderImage(src, big, { ...base, mode: 'orig' }, { target: 0.46, p3: true });
    const dims = `${c.width}×${c.height}`;
    const px = c.width * c.height;
    c.width = 0;
    big.thumb.width = 0;
    return [px > 15e6, `ได้ ${dims} (ย่อลงให้ไม่เกินเพดาน iPhone ~16 ล้านพิกเซล)`];
  });

  await step('ช่วงสีกว้าง Display P3', async () => {
    const src = await loadOriginal(item);
    const c = renderImage(src, item, { ...base, mode: '4:5' }, { target: 0.46, p3: true });
    const prof = await jpegProfile(await toBlob(c, 'image/jpeg', 0.92));
    c.width = 0;
    if (!P3_SUPPORTED) return [null, 'เบราว์เซอร์นี้ไม่รองรับ P3 ในแอป — บันทึกเป็น sRGB แทน (ใช้ได้ปกติ)'];
    return [prof === 'Display P3', `canvas รองรับ P3 · โปรไฟล์ในไฟล์: ${prof ?? 'ไม่มี'}`];
  });

  await step('ปุ่มแชร์ / บันทึกลงคลังรูป', async () => {
    const f = new File([new Blob([new Uint8Array(10)], { type: 'image/jpeg' })], 'a.jpg', { type: 'image/jpeg' });
    const ok = !!(navigator.canShare && navigator.canShare({ files: [f, f] }));
    return [ok ? true : null, ok ? 'แชร์หลายไฟล์ได้' : 'แชร์ไฟล์ไม่ได้ — ใช้ปุ่มดาวน์โหลดแทน'];
  });

  await step('ติดตั้งบนหน้าโฮม / ใช้ออฟไลน์', async () => {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    return [reg ? true : null, `${reg ? 'ระบบออฟไลน์ทำงาน' : 'ยังไม่ได้ลงระบบออฟไลน์ (เปิดหน้าแอปก่อนครั้งหนึ่ง)'} · ${standalone ? 'เปิดจากไอคอนหน้าโฮม' : 'เปิดจากเบราว์เซอร์'}`];
  });

  const fails = results.filter((r) => r === false).length;
  $('#result').textContent = fails ? `❌ มีปัญหา ${fails} ข้อ — แคปหน้าจอส่งให้ได้เลย` : '✅ ใช้งานได้ครบ';
  $('#run').disabled = false;
}

$('#run').addEventListener('click', run);

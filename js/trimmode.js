// โหมดตัดขอบ: ตัดขอบดำ/ขาวของภาพแคปหน้าจออย่างเดียว
// ไม่ใส่ลายน้ำ ไม่ปรับสี ไม่ย่อขนาด · บันทึกจากไฟล์ต้นฉบับ (PNG คงเป็น PNG) · ชื่อไฟล์ = ชื่อเดิม_crop
import { loadImage, loadOriginal, toBlob, ensureDecodable } from './render.js';
import { detectBorders } from './trim.js';

const $ = (s) => document.querySelector(s);
const THUMB_MAX = 900;
const TILE_MAX = 480;
const WORK_MAX = 1600;
const STORE_KEY = 'inkmark.trim.v1';
const COLOR_OPTS = [
  { value: 'black', label: 'ขอบดำ' },
  { value: 'white', label: 'ขอบขาว' },
  { value: 'both', label: 'ดำและขาว' },
];
const FULL = { x: 0, y: 0, w: 1, h: 1 };

export function initTrimMode(h) {
  const st = { items: [], colors: 'both', exported: null, edit: -1, work: null };
  let nextId = 1;
  try {
    st.colors = JSON.parse(localStorage.getItem(STORE_KEY))?.colors || 'both';
  } catch {
    /* ใช้ค่าเริ่มต้น */
  }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ colors: st.colors }));
    } catch {
      /* โหมดส่วนตัว */
    }
  };
  const invalidate = () => {
    st.exported = null;
    $('#trimPrepare').hidden = false;
    $('#trimShare').hidden = true;
  };
  const detect = (it) => detectBorders(it.thumb, it.thumb.width, it.thumb.height, st.colors);

  // ---------- ตัวเลือกสีขอบ ----------
  const seg = $('#trimColorSeg');
  for (const o of COLOR_OPTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = o.value;
    b.textContent = o.label;
    b.addEventListener('click', () => {
      st.colors = o.value;
      save();
      refreshSeg();
      // ตรวจใหม่ทุกรูปที่ยังไม่ได้ปรับขอบเอง
      for (const it of st.items) {
        it.auto = detect(it);
        if (!it.manual) it.rect = it.auto;
      }
      invalidate();
      renderGrid();
    });
    seg.append(b);
  }
  const refreshSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === st.colors));
  refreshSeg();

  // ---------- นำเข้า ----------
  async function addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      h.progress('กำลังโหลดรูป', i, files.length);
      await h.nextFrame();
      let f = files[i];
      try {
        f = await ensureDecodable(f); // HEIC → JPEG ถ้าเบราว์เซอร์เปิดเองไม่ได้
      } catch {
        h.toast('แปลงไฟล์ HEIC ไม่สำเร็จ — ครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อโหลดตัวแปลง', 5000);
        continue;
      }
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        const w = img.naturalWidth;
        const hh = img.naturalHeight;
        const s = Math.min(1, THUMB_MAX / Math.max(w, hh));
        const thumb = document.createElement('canvas');
        thumb.width = Math.round(w * s);
        thumb.height = Math.round(hh * s);
        const tctx = thumb.getContext('2d', { willReadFrequently: true });
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(img, 0, 0, thumb.width, thumb.height);
        const it = { id: nextId++, file: f, name: f.name || `screenshot-${nextId}.png`, w, h: hh, thumb, manual: false };
        it.auto = detect(it);
        it.rect = it.auto;
        st.items.push(it);
      } catch {
        failed.push(f.name);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    h.progressDone();
    invalidate();
    renderGrid();
    if (failed.length) h.toast(`เปิดไม่ได้ ${failed.length} รูป`, 4000);
    const found = st.items.filter((it) => it.rect).length;
    h.toast(`✂︎ ตัดขอบได้ ${found} จาก ${st.items.length} รูป`);
  }

  function clear() {
    for (const it of st.items) it.thumb.width = 0;
    st.items = [];
    invalidate();
    renderGrid();
  }

  // ---------- ตาราง ----------
  function drawTile(it, canvas) {
    const r = it.rect || FULL;
    const t = it.thumb;
    const sw = r.w * t.width;
    const sh = r.h * t.height;
    const s = Math.min(1, TILE_MAX / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * s));
    canvas.height = Math.max(1, Math.round(sh * s));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, r.x * t.width, r.y * t.height, sw, sh, 0, 0, canvas.width, canvas.height);
  }

  function renderGrid() {
    const grid = $('#trimGrid');
    grid.textContent = '';
    st.items.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'tile';
      const canvas = document.createElement('canvas');
      drawTile(it, canvas);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      const badges = document.createElement('div');
      badges.className = 'badges';
      const b = document.createElement('span');
      b.className = it.rect ? 'trimmed' : 'notrim';
      b.textContent = it.rect ? (it.manual ? 'ปรับขอบเอง' : 'ตัดขอบแล้ว') : 'ไม่ได้ตัด';
      badges.append(b);
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.setAttribute('aria-label', 'ลบรูปนี้');
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        it.thumb.width = 0;
        st.items.splice(st.items.indexOf(it), 1);
        invalidate();
        renderGrid();
      });
      el.append(canvas, num, badges, del);
      el.addEventListener('click', () => openEditor(st.items.indexOf(it)));
      grid.append(el);
    });
    const n = st.items.length;
    $('#trimEmpty').hidden = n > 0;
    $('#trimHint').hidden = !n;
    $('#trimBar').hidden = !n;
    const cut = st.items.filter((it) => it.rect).length;
    $('#trimSummary').innerHTML = `<strong>${n} รูป</strong> · ตัดขอบ ${cut} รูป`;
    h.setTop(n);
  }

  // ---------- ปรับขอบเอง ----------
  const cv = $('#tEdCanvas');
  let geo = null;
  let drag = null;

  async function openEditor(i) {
    if (i < 0 || i >= st.items.length) return;
    st.edit = i;
    $('#trimEditor').hidden = false;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('editing');
    const it = st.items[i];
    $('#tEdTitle').textContent = `${i + 1}/${st.items.length} · ${it.name}`;
    $('#tEdPrev').disabled = i === 0;
    $('#tEdNext').disabled = i === st.items.length - 1;
    if (st.work) st.work.width = 0;
    st.work = null;
    draw();
    // รูปละเอียดกว่าไว้ดูขอบชัดๆ
    const url = URL.createObjectURL(it.file);
    try {
      const img = await loadImage(url);
      if (st.edit !== i) return;
      const s = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      st.work = c;
      draw();
    } catch {
      /* ใช้รูปย่อ */
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function closeEditor() {
    $('#trimEditor').hidden = true;
    document.body.style.overflow = '';
    document.body.classList.remove('editing');
    st.edit = -1;
    if (st.work) st.work.width = 0;
    st.work = null;
    renderGrid();
  }

  function draw() {
    const it = st.items[st.edit];
    if (!it) return;
    const src = st.work || it.thumb;
    const box = cv.parentElement;
    const s = Math.min((box.clientWidth - 24) / src.width, (box.clientHeight - 24) / src.height);
    const cw = Math.max(1, Math.floor(src.width * s));
    const ch = Math.max(1, Math.floor(src.height * s));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.width = `${cw}px`;
    cv.style.height = `${ch}px`;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
    const f = it.rect || FULL;
    const r = { x: f.x * cw, y: f.y * ch, w: f.w * cw, h: f.h * ch };
    ctx.fillStyle = 'rgba(255,0,80,0.28)'; // ส่วนที่จะตัดทิ้ง (เห็นชัดทั้งบนพื้นดำและขาว)
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ff2d6f';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    // ที่จับกลางแต่ละด้าน
    ctx.fillStyle = '#ff2d6f';
    const hb = (x, y, w, hh) => ctx.fillRect(x - w / 2, y - hh / 2, w, hh);
    hb(r.x + r.w / 2, r.y, 36, 6);
    hb(r.x + r.w / 2, r.y + r.h, 36, 6);
    hb(r.x, r.y + r.h / 2, 6, 36);
    hb(r.x + r.w, r.y + r.h / 2, 6, 36);
    geo = { cw, ch };
    const out = `${Math.round(f.w * it.w)}×${Math.round(f.h * it.h)} px`;
    $('#tEdInfo').textContent = it.rect
      ? `ผลลัพธ์ ${out} · ส่วนสีชมพูจะถูกตัดออก`
      : `ไม่ได้ตัด · ${out} · ลากเส้นขอบเพื่อตัดเอง`;
  }

  cv.addEventListener('pointerdown', (e) => {
    const it = st.items[st.edit];
    if (!it || !geo) return;
    const b = cv.getBoundingClientRect();
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const f = { ...(it.rect || FULL) };
    const r = { l: f.x * geo.cw, t: f.y * geo.ch, rr: (f.x + f.w) * geo.cw, bb: (f.y + f.h) * geo.ch };
    const tol = 28;
    const near = (a, v) => Math.abs(a - v) < tol;
    const edges = {
      l: near(px, r.l) && py > r.t - tol && py < r.bb + tol,
      r: near(px, r.rr) && py > r.t - tol && py < r.bb + tol,
      t: near(py, r.t) && px > r.l - tol && px < r.rr + tol,
      b: near(py, r.bb) && px > r.l - tol && px < r.rr + tol,
    };
    const any = edges.l || edges.r || edges.t || edges.b;
    const inside = px > r.l && px < r.rr && py > r.t && py < r.bb;
    if (!any && !inside) return;
    cv.setPointerCapture(e.pointerId);
    drag = { x: px, y: py, f, edges, move: !any };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const it = st.items[st.edit];
    const b = cv.getBoundingClientRect();
    const dx = (e.clientX - b.left - drag.x) / geo.cw;
    const dy = (e.clientY - b.top - drag.y) / geo.ch;
    const MIN = 0.05;
    let { x, y, w, h: hh } = drag.f;
    if (drag.move) {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - hh, Math.max(0, y + dy));
    } else {
      let x1 = x + w;
      let y1 = y + hh;
      if (drag.edges.l) x = Math.min(x1 - MIN, Math.max(0, x + dx));
      if (drag.edges.r) x1 = Math.max(x + MIN, Math.min(1, x1 + dx));
      if (drag.edges.t) y = Math.min(y1 - MIN, Math.max(0, y + dy));
      if (drag.edges.b) y1 = Math.max(y + MIN, Math.min(1, y1 + dy));
      w = x1 - x;
      hh = y1 - y;
    }
    it.rect = { x, y, w, h: hh };
    it.manual = true;
    invalidate();
    draw();
  });
  const end = () => (drag = null);
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  $('#tEdAuto').addEventListener('click', () => {
    const it = st.items[st.edit];
    it.auto = detect(it);
    it.rect = it.auto;
    it.manual = false;
    invalidate();
    draw();
    if (!it.auto) h.toast('ไม่พบขอบดำ/ขาวชัดเจน ลากเส้นขอบเพื่อตัดเองได้');
  });
  $('#tEdNone').addEventListener('click', () => {
    const it = st.items[st.edit];
    it.rect = null;
    it.manual = true;
    invalidate();
    draw();
  });
  $('#tEdClose').addEventListener('click', closeEditor);
  $('#tEdPrev').addEventListener('click', () => openEditor(st.edit - 1));
  $('#tEdNext').addEventListener('click', () => openEditor(st.edit + 1));
  window.addEventListener('resize', () => st.edit >= 0 && draw());
  document.addEventListener('keydown', (e) => {
    if (st.edit < 0) return;
    if (e.key === 'Escape') closeEditor();
    else if (e.key === 'ArrowLeft' && st.edit > 0) openEditor(st.edit - 1);
    else if (e.key === 'ArrowRight' && st.edit < st.items.length - 1) openEditor(st.edit + 1);
  });

  // ---------- บันทึก ----------
  function outName(it) {
    const m = /^(.*?)(\.[^.]+)?$/.exec(it.name);
    const png = it.file.type === 'image/png' || /\.png$/i.test(it.name);
    return { name: `${m[1]}_crop.${png ? 'png' : 'jpg'}`, type: png ? 'image/png' : 'image/jpeg' };
  }
  async function prepare() {
    if (st.exported) return st.exported;
    const files = [];
    try {
      for (let i = 0; i < st.items.length; i++) {
        h.progress('กำลังสร้างไฟล์', i, st.items.length);
        await h.nextFrame();
        const it = st.items[i];
        const src = await loadOriginal({ file: it.file, trim: it.rect });
        let c = src;
        if (!(src instanceof HTMLCanvasElement)) {
          c = document.createElement('canvas');
          c.width = src.naturalWidth || src.width;
          c.height = src.naturalHeight || src.height;
          c.getContext('2d').drawImage(src, 0, 0);
        }
        const o = outName(it);
        const blob = await toBlob(c, o.type, 0.95);
        c.width = 0;
        files.push(new File([blob], o.name, { type: o.type }));
      }
    } catch (err) {
      h.progressDone();
      h.toast('สร้างไฟล์ไม่สำเร็จ', 4000);
      console.error(err);
      return null;
    }
    h.progressDone();
    st.exported = files;
    return files;
  }
  $('#trimPrepare').addEventListener('click', async () => {
    if (!(await prepare())) return;
    $('#trimPrepare').hidden = true;
    $('#trimShare').hidden = false;
  });
  $('#trimShare').addEventListener('click', () => st.exported && h.shareFiles(st.exported));
  $('#trimZip').addEventListener('click', async () => {
    const files = await prepare();
    if (!files) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    h.downloadZip(files, `crop_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip`);
  });
  $('#trimFiles').addEventListener('click', async () => {
    const files = await prepare();
    if (files) h.downloadAll(files);
  });

  renderGrid();
  return { addFiles, clear, refresh: renderGrid, state: st };
}

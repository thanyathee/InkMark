import { SIZE_MODES, SIZES, isCropMode, canFrame, outputSize, cropFrac } from './crop.js';
import { TONE_SLIDERS, batchTarget } from './tone.js';
import { WM_COLORS } from './watermark.js';
import { makeZip } from './zip.js';
import { prepareItem, loadOriginal, renderImage, toBlob } from './render.js';

const $ = (s) => document.querySelector(s);
const PREVIEW_MAX = 520;
const EDITOR_MAX = 1000;
const JPEG_QUALITY = 0.92;
const STORE_KEY = 'inkmark.settings.v1';
const APP_VERSION = '1.8';
// จอคอม: แผงเครื่องมือด้านขวาเปิดค้าง (ต้องตรงกับ media query ใน style.css)
const desktop = window.matchMedia('(min-width: 1024px)');

const DEFAULTS = {
  mode: '4:5',
  size: 1080,
  auto: true,
  global: { b: 0, c: 0, v: 0, w: 0 },
  wm: { on: true, text: '#TISCOFOUNDATION', pos: 'br', size: 'M', color: 'auto', custom: '#ffffff', opacity: 0.9 },
};

const state = {
  items: [],
  settings: loadSettings(),
  sheet: null,
  editIndex: -1,
  exported: null,
};

// ---------- ตั้งค่า (จำค่าล่าสุดไว้ในเครื่อง) ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return {
      ...DEFAULTS,
      ...s,
      global: { ...DEFAULTS.global, ...s.global },
      wm: { ...DEFAULTS.wm, ...s.wm },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.settings));
  } catch {
    /* โหมดส่วนตัว: ไม่จำค่า */
  }
}
function settingsChanged() {
  saveSettings();
  updateExportSummary();
  invalidateExport();
  scheduleRender();
}

// ---------- แจ้งเตือน / ความคืบหน้า ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function progress(text, done, total) {
  $('#progress').hidden = false;
  $('#progressText').textContent = `${text} ${done}/${total}`;
  $('#progressBar').style.width = `${total ? (done / total) * 100 : 0}%`;
}
function progressDone() {
  $('#progress').hidden = true;
}
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

// ---------- นำเข้ารูป ----------
async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!files.length) return;
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    progress('กำลังโหลดรูป', i, files.length);
    await nextFrame();
    try {
      state.items.push(await prepareItem(files[i]));
    } catch {
      failed.push(files[i].name);
    }
  }
  progressDone();
  invalidateExport();
  rebuildGrid();
  if (failed.length) toast(`เปิดไม่ได้ ${failed.length} รูป: ${failed.slice(0, 3).join(', ')}`, 4000);
}

for (const id of ['#fileInput', '#fileInput2']) {
  $(id).addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
}

$('#clearBtn').addEventListener('click', () => {
  if (!confirm('ล้างรูปทั้งหมด?')) return;
  for (const it of state.items) it.thumb.width = 0;
  state.items = [];
  invalidateExport();
  closeSheet();
  rebuildGrid();
});

// ---------- ตารางรูป ----------
const tiles = new Map(); // id -> { el, canvas }

function rebuildGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  tiles.clear();
  state.items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'tile';
    const canvas = document.createElement('canvas');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const badge = document.createElement('span');
    badge.className = 'edited';
    badge.textContent = 'ปรับแล้ว';
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.setAttribute('aria-label', 'ลบรูปนี้');
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(it);
    });
    el.append(canvas, num, badge, del);
    el.addEventListener('click', () => openEditor(state.items.indexOf(it)));
    grid.append(el);
    tiles.set(it.id, { el, canvas, badge });
  });
  const has = state.items.length > 0;
  $('#empty').hidden = has;
  $('#gridHint').hidden = !has;
  $('#tabbar').hidden = !has;
  $('#clearBtn').hidden = !has;
  document.body.classList.toggle('has-items', has);
  $('#count').textContent = has ? `${state.items.length} รูป` : '';
  updateExportSummary();
  scheduleRender();
}

function removeItem(it) {
  const i = state.items.indexOf(it);
  if (i < 0) return;
  it.thumb.width = 0;
  state.items.splice(i, 1);
  invalidateExport();
  rebuildGrid();
  if (!state.items.length) closeSheet();
}

function isEdited(it) {
  return it.fx !== 0.5 || it.fy !== 0.5 || it.zoom !== 1 || Object.values(it.tone).some((v) => v);
}

const target = () => batchTarget(state.items.map((i) => i.stats));

function renderTile(it, tgt = target()) {
  const t = tiles.get(it.id);
  if (!t) return;
  renderImage(it.thumb, it, state.settings, { maxSide: PREVIEW_MAX, target: tgt, into: t.canvas });
  t.badge.hidden = !isEdited(it);
}

// วาดพรีวิวทีละรูปโดยไม่ค้างหน้าจอ; ถ้ามีการเปลี่ยนค่าระหว่างวาด จะเริ่มรอบใหม่
let renderGen = 0;
function scheduleRender() {
  const gen = ++renderGen;
  (async () => {
    await nextFrame();
    const tgt = target();
    for (const it of state.items) {
      if (gen !== renderGen) return;
      renderTile(it, tgt);
      await nextFrame();
    }
  })();
}

// ---------- แผงตั้งค่า ----------
const SHEET_TITLES = { size: 'ขนาดรูป', tone: 'แสงและสี', wm: 'ลายน้ำ', export: 'บันทึกรูป' };

function openSheet(name) {
  if (state.sheet === name) return closeSheet();
  state.sheet = name;
  $('#sheet').hidden = false;
  $('#sheetTitle').textContent = SHEET_TITLES[name];
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.sheet === name));
  document.body.classList.add('sheet-open');
  if (name === 'export') updateExportSummary();
}
function closeSheet() {
  state.sheet = null;
  $('#sheet').hidden = true;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.remove('active'));
  document.body.classList.remove('sheet-open');
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
$('#sheetClose').addEventListener('click', closeSheet);

function segment(container, options, getValue, onPick) {
  container.textContent = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = o.value;
    if (o.html) b.innerHTML = o.html;
    else b.textContent = o.label;
    b.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      onPick(o.value);
      refreshSeg();
    });
    container.append(b);
  }
  const refreshSeg = () =>
    container.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(getValue()) === b.dataset.value));
  refreshSeg();
  return refreshSeg;
}

function sliders(container, getObj, onChange) {
  container.textContent = '';
  const inputs = {};
  for (const s of TONE_SLIDERS) {
    const row = document.createElement('label');
    row.className = 'sl';
    row.innerHTML = `<span>${s.label}</span><output></output><input type="range" min="-50" max="50" step="1">`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', () => {
      getObj()[s.key] = +input.value;
      out.textContent = fmt(+input.value);
      onChange();
    });
    // แตะสองครั้งเพื่อรีเซ็ตเป็น 0
    input.addEventListener('dblclick', () => {
      input.value = 0;
      input.dispatchEvent(new Event('input'));
    });
    inputs[s.key] = { input, out };
    container.append(row);
  }
  const refresh = () => {
    const o = getObj();
    if (!o) return;
    for (const k in inputs) {
      inputs[k].input.value = o[k] || 0;
      inputs[k].out.textContent = fmt(o[k] || 0);
    }
  };
  refresh();
  return refresh;
}
const fmt = (v) => (v > 0 ? `+${v}` : `${v}`);

// ขนาด
const S = state.settings;
segment(
  $('#modeSeg'),
  SIZE_MODES.map((m) => ({ value: m.id, label: m.label })),
  () => S.mode,
  (v) => {
    S.mode = v;
    updateSizeLabels();
    settingsChanged();
  },
);
segment(
  $('#sizeSeg'),
  SIZES.map((v) => ({ value: v, label: String(v) })),
  () => S.size,
  (v) => {
    S.size = v;
    updateSizeLabels();
    settingsChanged();
  },
);
function updateSizeLabels() {
  $('#sizeLabel').textContent = S.mode === 'h' ? 'ความสูง (px)' : 'ความกว้าง (px)';
  const crop = isCropMode(S.mode);
  const orig = S.mode === 'orig';
  $('#sizeLabel').hidden = orig;
  $('#sizeSeg').hidden = orig;
  if (orig) {
    $('#sizeHint').textContent = 'ไม่ตัด ไม่ย่อ · ทุกรูปคงขนาดเดิม · อยากได้เฉพาะบางส่วน แตะที่รูปแล้วซูม (สัดส่วนเท่าเดิม ไม่ขยายภาพ)';
  } else if (crop) {
    const o = outputSize(S.mode, S.size, 1, 1);
    $('#sizeHint').textContent = `ทุกรูปจะเป็น ${o.w}×${o.h} px · แตะที่รูปเพื่อเลื่อนกรอบให้ไม่ค่อนซ้าย/ขวา/บน/ล่าง`;
  } else {
    $('#sizeHint').textContent = `ไม่ตัดรูป · ย่อให้${S.mode === 'w' ? 'ความกว้าง' : 'ความสูง'}เท่ากันที่ ${S.size} px อีกด้านตามสัดส่วนเดิม`;
  }
  $('#gridHint').textContent = orig
    ? 'แตะที่รูปเพื่อซูมเลือกเฉพาะส่วน หรือปรับแสงสีเฉพาะรูป'
    : crop
    ? 'แตะที่รูปเพื่อเลื่อนตำแหน่งกรอบ หรือปรับแสงสีเฉพาะรูป'
    : 'แตะที่รูปเพื่อปรับแสงสีเฉพาะรูป';
}
updateSizeLabels();

// แสงสี
$('#autoToggle').checked = S.auto;
$('#autoToggle').addEventListener('change', (e) => {
  S.auto = e.target.checked;
  settingsChanged();
});
const refreshGlobal = sliders($('#globalSliders'), () => S.global, settingsChanged);
$('#globalReset').addEventListener('click', () => {
  S.global = { b: 0, c: 0, v: 0, w: 0 };
  refreshGlobal();
  settingsChanged();
});

// ลายน้ำ
$('#wmToggle').checked = S.wm.on;
$('#wmToggle').addEventListener('change', (e) => {
  S.wm.on = e.target.checked;
  settingsChanged();
});
$('#wmText').value = S.wm.text;
$('#wmText').addEventListener('input', (e) => {
  S.wm.text = e.target.value;
  settingsChanged();
});
segment(
  $('#wmPosGrid'),
  ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((v) => ({ value: v, html: '<i></i>' })),
  () => S.wm.pos,
  (v) => {
    S.wm.pos = v;
    settingsChanged();
  },
);
segment(
  $('#wmSizeSeg'),
  [
    { value: 'S', label: 'เล็ก' },
    { value: 'M', label: 'กลาง' },
    { value: 'L', label: 'ใหญ่' },
  ],
  () => S.wm.size,
  (v) => {
    S.wm.size = v;
    settingsChanged();
  },
);
const dot = (c) => `<i class="dot" style="background:${c}"></i>`;
segment(
  $('#wmColorSeg'),
  [
    { value: 'auto', label: 'อัตโนมัติ' },
    { value: 'white', html: `${dot(WM_COLORS.white)}ขาว` },
    { value: 'black', html: `${dot(WM_COLORS.black)}ดำ` },
    { value: 'blue', html: `${dot(WM_COLORS.blue)}น้ำเงิน` },
    { value: 'custom', html: `<input type="color" id="wmCustom" aria-label="เลือกสีเอง">เลือกเอง` },
  ],
  () => S.wm.color,
  (v) => {
    S.wm.color = v;
    settingsChanged();
  },
);
$('#wmCustom').value = S.wm.custom;
$('#wmCustom').addEventListener('input', (e) => {
  S.wm.custom = e.target.value;
  S.wm.color = 'custom';
  $('#wmColorSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === 'custom'));
  settingsChanged();
});
$('#wmOpacity').value = Math.round(S.wm.opacity * 100);
$('#wmOpacityVal').textContent = `${$('#wmOpacity').value}%`;
$('#wmOpacity').addEventListener('input', (e) => {
  S.wm.opacity = +e.target.value / 100;
  $('#wmOpacityVal').textContent = `${e.target.value}%`;
  settingsChanged();
});

// ---------- ตัวแก้ไขรายรูป ----------
const ed = {
  crop: $('#edCrop'),
  preview: $('#edPreview'),
  geo: null,
  compare: false,
  raf: 0,
};
const cur = () => state.items[state.editIndex];

const refreshEdSliders = sliders($('#edSliders'), () => cur()?.tone, () => {
  invalidateExport();
  queueEditorRender();
});

function openEditor(i) {
  if (i < 0 || i >= state.items.length) return;
  state.editIndex = i;
  $('#editor').hidden = false;
  document.body.style.overflow = 'hidden';
  updateEditor();
}
function closeEditor() {
  const it = cur();
  $('#editor').hidden = true;
  document.body.style.overflow = '';
  state.editIndex = -1;
  if (it) renderTile(it);
}
function updateEditor() {
  const it = cur();
  $('#edTitle').textContent = `${state.editIndex + 1}/${state.items.length} · ${it.name}`;
  $('#edPrev').disabled = state.editIndex === 0;
  $('#edNext').disabled = state.editIndex === state.items.length - 1;
  $('#edCropWrap').hidden = !canFrame(S.mode);
  $('#edCropLabel').textContent =
    S.mode === 'orig' ? 'ซูม แล้วลากกรอบเลือกส่วนที่ต้องการ (สัดส่วนเท่าต้นฉบับ)' : 'ลากกรอบเพื่อเลือกตำแหน่ง';
  $('#edZoom').value = it.zoom;
  refreshEdSliders();
  drawCrop();
  drawPreview();
}
function queueEditorRender() {
  cancelAnimationFrame(ed.raf);
  ed.raf = requestAnimationFrame(() => {
    drawCrop();
    drawPreview();
  });
}

function fitCanvas(canvas, w, h) {
  const box = canvas.parentElement;
  const maxW = box.clientWidth - 16;
  const maxH = window.innerHeight * (desktop.matches ? 0.72 : 0.42);
  const s = Math.min(maxW / w, maxH / h);
  canvas.style.width = `${Math.round(w * s)}px`;
  canvas.style.height = `${Math.round(h * s)}px`;
  return s;
}

function drawCrop() {
  const it = cur();
  if (!it || !canFrame(S.mode)) return;
  const t = it.thumb;
  const c = ed.crop;
  const s = fitCanvas(c, t.width, t.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.round(t.width * s);
  const ch = Math.round(t.height * s);
  c.width = Math.round(cw * dpr);
  c.height = Math.round(ch * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.drawImage(t, 0, 0, cw, ch);
  const f = cropFrac(S.mode, t.width, t.height, it);
  const r = { x: f.x * cw, y: f.y * ch, w: f.w * cw, h: f.h * ch };
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k < 3; k++) {
    ctx.moveTo(r.x + (r.w * k) / 3, r.y);
    ctx.lineTo(r.x + (r.w * k) / 3, r.y + r.h);
    ctx.moveTo(r.x, r.y + (r.h * k) / 3);
    ctx.lineTo(r.x + r.w, r.y + (r.h * k) / 3);
  }
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ed.geo = { cw, ch, f };
}

function drawPreview() {
  const it = cur();
  if (!it) return;
  renderImage(it.thumb, it, S, { maxSide: EDITOR_MAX, target: target(), tone: !ed.compare, into: ed.preview });
  fitCanvas(ed.preview, ed.preview.width, ed.preview.height);
}

// ลากกรอบ
let drag = null;
ed.crop.addEventListener('pointerdown', (e) => {
  ed.crop.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, fx: cur().fx, fy: cur().fy };
});
ed.crop.addEventListener('pointermove', (e) => {
  if (!drag || !ed.geo) return;
  const it = cur();
  const { cw, ch, f } = ed.geo;
  const slackX = cw * (1 - f.w);
  const slackY = ch * (1 - f.h);
  if (slackX > 0.5) it.fx = Math.min(1, Math.max(0, drag.fx + (e.clientX - drag.x) / slackX));
  if (slackY > 0.5) it.fy = Math.min(1, Math.max(0, drag.fy + (e.clientY - drag.y) / slackY));
  invalidateExport();
  queueEditorRender();
});
const endDrag = () => (drag = null);
ed.crop.addEventListener('pointerup', endDrag);
ed.crop.addEventListener('pointercancel', endDrag);

$('#edZoom').addEventListener('input', (e) => {
  cur().zoom = +e.target.value;
  invalidateExport();
  queueEditorRender();
});
$('#edCropReset').addEventListener('click', () => {
  Object.assign(cur(), { fx: 0.5, fy: 0.5, zoom: 1 });
  $('#edZoom').value = 1;
  invalidateExport();
  queueEditorRender();
});
$('#edToneReset').addEventListener('click', () => {
  cur().tone = { b: 0, c: 0, v: 0, w: 0 };
  refreshEdSliders();
  invalidateExport();
  queueEditorRender();
});
$('#edRemove').addEventListener('click', () => {
  const i = state.editIndex;
  removeItem(state.items[i]);
  if (!state.items.length) return closeEditor();
  state.editIndex = Math.min(i, state.items.length - 1);
  updateEditor();
});

// กดค้างเพื่อเทียบก่อน/หลัง
const setCompare = (v) => {
  if (ed.compare === v) return;
  ed.compare = v;
  drawPreview();
};
ed.preview.addEventListener('pointerdown', () => setCompare(true));
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ed.preview.addEventListener(ev, () => setCompare(false));
ed.preview.addEventListener('contextmenu', (e) => e.preventDefault());

$('#edClose').addEventListener('click', closeEditor);
$('#edPrev').addEventListener('click', () => {
  renderTile(cur());
  openEditor(state.editIndex - 1);
});
$('#edNext').addEventListener('click', () => {
  renderTile(cur());
  openEditor(state.editIndex + 1);
});
document.addEventListener('keydown', (e) => {
  if (state.editIndex < 0 || e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') closeEditor();
  else if (e.key === 'ArrowLeft' && state.editIndex > 0) $('#edPrev').click();
  else if (e.key === 'ArrowRight' && state.editIndex < state.items.length - 1) $('#edNext').click();
});

// ลากไฟล์มาวาง (คอม)
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#dropZone').hidden = false;
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropZone').hidden = true;
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropZone').hidden = true;
  addFiles(e.dataTransfer.files);
});

window.addEventListener('resize', () => {
  if (state.editIndex >= 0) queueEditorRender();
});

// ---------- บันทึก ----------
function updateExportSummary() {
  const n = state.items.length;
  $('#deskZipBtn').disabled = !n;
  $('#deskFilesBtn').disabled = !n;
  if (!n) {
    $('#exportSummary').textContent = 'ยังไม่มีรูป';
    return;
  }
  const first = state.items[0];
  const o = outputSize(S.mode, S.size, first.w, first.h);
  const dims =
    S.mode === 'orig'
      ? 'ขนาดเดิมของแต่ละรูป (รูปที่ซูมจะได้เฉพาะส่วนที่เลือก)'
      : isCropMode(S.mode)
        ? `${o.w}×${o.h} px`
        : `${S.mode === 'w' ? 'กว้าง' : 'สูง'} ${S.size} px`;
  $('#exportSummary').innerHTML = `<strong>${n} รูป</strong> · ${dims} · JPEG`;
}

function invalidateExport() {
  state.exported = null;
  $('#exportReady').hidden = true;
  $('#exportBtn').hidden = false;
}

function outName(it, i) {
  const base = it.name.replace(/\.[^.]+$/, '').replace(/[^\w฀-๿-]+/g, '_');
  return `${String(i + 1).padStart(2, '0')}_${base}.jpg`;
}

// สร้างไฟล์ทีละรูป (iPhone จะไม่ค้าง); ถ้าไม่ได้แก้อะไรหลังสร้างครั้งก่อน ใช้ไฟล์เดิม
async function prepareFiles() {
  if (state.exported) return state.exported;
  const items = state.items;
  const tgt = target();
  const files = [];
  try {
    for (let i = 0; i < items.length; i++) {
      progress('กำลังสร้างไฟล์', i, items.length);
      await nextFrame();
      const it = items[i];
      // ตัดจากไฟล์ต้นฉบับโดยตรงทุกโหมด: บีบอัดรอบเดียว และไม่ต้องขยายภาพ
      const src = await loadOriginal(it);
      const canvas = renderImage(src, it, S, { target: tgt, p3: true });
      const blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      canvas.width = 0;
      if (src.close) src.close();
      files.push(new File([blob], outName(it, i), { type: 'image/jpeg' }));
    }
  } catch (err) {
    progressDone();
    toast('สร้างไฟล์ไม่สำเร็จ ลองลดจำนวนรูปหรือขนาดลง', 4000);
    console.error(err);
    return null;
  }
  progressDone();
  state.exported = files;
  return files;
}

// มือถือ ขั้นที่ 1: เตรียมไฟล์ แล้วค่อยกดแชร์ (Safari ต้องให้ผู้ใช้กดปุ่มแชร์เอง)
$('#exportBtn').addEventListener('click', async () => {
  if (!(await prepareFiles())) return;
  $('#exportBtn').hidden = true;
  $('#exportReady').hidden = false;
});

// คอม: กดครั้งเดียว สร้างไฟล์แล้วดาวน์โหลดเลย
$('#deskZipBtn').addEventListener('click', async () => {
  const files = await prepareFiles();
  if (files) downloadZip(files);
});
$('#deskFilesBtn').addEventListener('click', async () => {
  const files = await prepareFiles();
  if (files) downloadAll(files);
});

function zipName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `InkMark_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
async function downloadZip(files) {
  const zip = await makeZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = zipName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ขั้นที่ 2: แชร์ (ต้องกดจากผู้ใช้โดยตรง Safari จึงยอมเปิดหน้าต่างแชร์)
$('#shareBtn').addEventListener('click', async () => {
  const files = state.exported;
  if (!files) return;
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ ลองใช้ "ดาวน์โหลดเป็นไฟล์"');
    }
  } else {
    downloadAll(files);
  }
});
$('#downloadBtn').addEventListener('click', () => state.exported && downloadAll(state.exported));

async function downloadAll(files) {
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------- ออฟไลน์ ----------
// ---------- อัปเดตอัตโนมัติ ----------
// แอปที่เพิ่มไว้หน้าโฮมของ iPhone ไม่โหลดหน้าใหม่เอง: เช็กเวอร์ชันทุกครั้งที่เปิดกลับมา
// ถ้ามีเวอร์ชันใหม่และยังไม่มีรูปค้างอยู่ จะโหลดใหม่ให้ทันที
if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  let updatePending = false;
  const applyUpdate = () => {
    if (state.items.length) {
      updatePending = true;
      $('#updateBar').hidden = false;
    } else {
      location.reload();
    }
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) applyUpdate();
  });
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (updatePending && !state.items.length) location.reload();
        else reg.update().catch(() => {});
      });
    })
    .catch(() => {});
  $('#updateBar').addEventListener('click', () => location.reload());
}
$('#version').textContent = `เวอร์ชัน ${APP_VERSION}`;

rebuildGrid();

// สำหรับทดสอบอัตโนมัติ
window.__inkmark = { state, addFiles };

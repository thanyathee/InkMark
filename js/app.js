import { SIZE_MODES, SIZES, isCropMode, canFrame, outputSize, cropFrac } from './crop.js';
import { TONE_SLIDERS, emptyTone, autoAdjust } from './tone.js';
import { WM_COLORS } from './watermark.js';
import { makeZip } from './zip.js';
import { prepareItem, loadOriginal, renderImage, toBlob, workCanvas } from './render.js';

const $ = (s) => document.querySelector(s);
const PREVIEW_MAX = 520;
const WORK_MAX = 1800; // ความละเอียดรูปในหน้าแก้ไข
const JPEG_QUALITY = 0.92;
const STORE_KEY = 'inkmark.settings.v1';
const APP_VERSION = '2.2';
// จอคอม: แผงเครื่องมือด้านขวาเปิดค้าง (ต้องตรงกับ media query ใน style.css)
const desktop = window.matchMedia('(min-width: 1024px)');

const DEFAULTS = {
  mode: '4:5',
  size: 1080,
  autoImport: true,
  prefix: 'ADS',
  global: emptyTone(),
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
      global: { ...emptyTone(), ...s.global },
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
      const it = await prepareItem(files[i]);
      if (state.settings.autoImport) applyAuto(it);
      state.items.push(it);
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

// ตัวช่วยวิเคราะห์: ใส่ค่าที่แนะนำลงแถบเลื่อนของรูปนั้น (ปรับต่อเองได้)
function applyAuto(it) {
  const r = autoAdjust(it.stats);
  it.tone = r.tone;
  it.auto = { wb: r.wb, levels: r.levels };
  it.notes = r.notes;
}
function clearTone(it) {
  it.tone = emptyTone();
  it.auto = null;
  it.notes = [];
}

// ---------- ตารางรูป ----------
const tiles = new Map(); // id -> { el, canvas, num, badge }
let suppressClick = false;

function rebuildGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  tiles.clear();
  state.items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = it.id;
    const canvas = document.createElement('canvas');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const badges = document.createElement('div');
    badges.className = 'badges';
    const badge = document.createElement('span');
    badge.className = 'edited';
    badge.textContent = 'ปรับเอง';
    badges.append(badge);
    if (!it.date) {
      const nd = document.createElement('span');
      nd.className = 'nodate';
      nd.textContent = 'ไม่มีวันที่ถ่าย';
      badges.append(nd);
    }
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.setAttribute('aria-label', 'ลบรูปนี้');
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(it);
    });
    el.append(canvas, num, badges, del);
    el.addEventListener('click', () => {
      if (!suppressClick) openEditor(state.items.indexOf(it));
    });
    setupReorder(el);
    grid.append(el);
    tiles.set(it.id, { el, canvas, num, badge });
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

function renumber() {
  state.items.forEach((it, i) => (tiles.get(it.id).num.textContent = i + 1));
}

// ---------- ลากเพื่อเรียงลำดับ: iPhone แตะค้าง / คอม คลิกค้างแล้วลาก ----------
const LONG_PRESS_MS = 380;
let reorder = null;
let ghost = null;

function setupReorder(el) {
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || e.target.closest('.del')) return;
      const t = e.touches[0];
      reorder = { el, x: t.clientX, y: t.clientY, active: false };
      reorder.timer = setTimeout(() => startReorder(t.clientX, t.clientY), LONG_PRESS_MS);
    },
    { passive: true },
  );
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.del')) return;
    e.preventDefault();
    reorder = { el, x: e.clientX, y: e.clientY, active: false, mouse: true };
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function startReorder(x, y) {
  if (!reorder) return;
  reorder.active = true;
  const r = reorder.el.getBoundingClientRect();
  reorder.dx = x - r.left;
  reorder.dy = y - r.top;
  ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.style.width = `${r.width}px`;
  const src = reorder.el.querySelector('canvas');
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.getContext('2d').drawImage(src, 0, 0);
  ghost.append(copy);
  document.body.append(ghost);
  reorder.el.classList.add('drag-src');
  navigator.vibrate?.(15);
  moveReorder(x, y);
}

function moveReorder(x, y) {
  ghost.style.left = `${x - reorder.dx}px`;
  ghost.style.top = `${y - reorder.dy}px`;
  const over = document.elementFromPoint(x, y)?.closest('.tile');
  if (over && over !== reorder.el) {
    const r = over.getBoundingClientRect();
    const after = x > r.left + r.width / 2;
    $('#grid').insertBefore(reorder.el, after ? over.nextSibling : over);
  }
  if (y < 70) window.scrollBy(0, -12);
  else if (y > window.innerHeight - 90) window.scrollBy(0, 12);
}

function endReorder() {
  if (!reorder) return;
  clearTimeout(reorder.timer);
  if (reorder.active) {
    ghost.remove();
    ghost = null;
    reorder.el.classList.remove('drag-src');
    const order = [...$('#grid').children].map((el) => +el.dataset.id);
    state.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renumber();
    invalidateExport();
    updateExportSummary();
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 80);
  }
  reorder = null;
}

document.addEventListener(
  'touchmove',
  (e) => {
    if (!reorder || reorder.mouse) return;
    const t = e.touches[0];
    if (!reorder.active) {
      if (Math.hypot(t.clientX - reorder.x, t.clientY - reorder.y) > 10) {
        clearTimeout(reorder.timer);
        reorder = null; // เลื่อนจอ ไม่ใช่ลากรูป
      }
      return;
    }
    e.preventDefault();
    moveReorder(t.clientX, t.clientY);
  },
  { passive: false },
);
document.addEventListener('touchend', endReorder);
document.addEventListener('touchcancel', endReorder);
document.addEventListener('mousemove', (e) => {
  if (!reorder || !reorder.mouse) return;
  if (!reorder.active) {
    if (Math.hypot(e.clientX - reorder.x, e.clientY - reorder.y) < 6) return;
    startReorder(e.clientX, e.clientY);
  }
  moveReorder(e.clientX, e.clientY);
});
document.addEventListener('mouseup', endReorder);

function removeItem(it) {
  const i = state.items.indexOf(it);
  if (i < 0) return;
  it.thumb.width = 0;
  state.items.splice(i, 1);
  invalidateExport();
  rebuildGrid();
  if (!state.items.length) closeSheet();
}

function renderTile(it) {
  const t = tiles.get(it.id);
  if (!t) return;
  renderImage(it.thumb, it, state.settings, { maxSide: PREVIEW_MAX, into: t.canvas });
  t.badge.hidden = !it.manual;
}

// วาดพรีวิวทีละรูปโดยไม่ค้างหน้าจอ; ถ้ามีการเปลี่ยนค่าระหว่างวาด จะเริ่มรอบใหม่
let renderGen = 0;
function scheduleRender() {
  const gen = ++renderGen;
  (async () => {
    await nextFrame();
    for (const it of state.items) {
      if (gen !== renderGen) return;
      renderTile(it);
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
    row.innerHTML = `<span>${s.label}</span><output></output><input type="range" min="${s.min}" max="${s.max}" step="1">`;
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
$('#autoImport').checked = S.autoImport;
$('#autoImport').addEventListener('change', (e) => {
  S.autoImport = e.target.checked;
  saveSettings();
});
$('#autoAllBtn').addEventListener('click', () => {
  for (const it of state.items) applyAuto(it);
  toast(`✨ ปรับอัตโนมัติแล้ว ${state.items.length} รูป`);
  invalidateExport();
  scheduleRender();
});
$('#resetAllBtn').addEventListener('click', () => {
  for (const it of state.items) clearTone(it);
  invalidateExport();
  scheduleRender();
});
const refreshGlobal = sliders($('#globalSliders'), () => S.global, settingsChanged);
$('#globalReset').addEventListener('click', () => {
  S.global = emptyTone();
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

// ---------- ตัวแก้ไขรายรูป: รูปใหญ่เต็มพื้นที่ ลากเลื่อน/ซูมบนรูปได้เลย ----------
const ed = {
  crop: $('#edCrop'),
  preview: $('#edPreview'),
  stage: $('#edStage'),
  compare: false,
  interacting: false,
  raf: 0,
  work: null,
  workId: null,
  ptrs: new Map(),
  start: null,
};
const cur = () => state.items[state.editIndex];
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
const touchUI = window.matchMedia('(hover: none)').matches;

function markManual(it) {
  it.manual = true;
  invalidateExport();
}

const refreshDeskSliders = sliders($('#edSliders'), () => cur()?.tone, () => {
  markManual(cur());
  refreshChips();
  queueEditorRender();
});

// มือถือ: ชิปเลือกค่า + แถบเลื่อนเดียว
ed.chip = 'b';
const chipEls = {};
for (const sl of TONE_SLIDERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `${sl.label} <small></small>`;
  b.addEventListener('click', () => {
    ed.chip = sl.key;
    refreshChips();
  });
  b.addEventListener('dblclick', () => {
    cur().tone[sl.key] = 0;
    markManual(cur());
    refreshEdTone();
    queueEditorRender();
  });
  chipEls[sl.key] = b;
  $('#edChips').append(b);
}
function refreshChips() {
  const it = cur();
  if (!it) return;
  for (const sl of TONE_SLIDERS) {
    const v = it.tone[sl.key] || 0;
    const el = chipEls[sl.key];
    el.querySelector('small').textContent = fmt(v);
    el.classList.toggle('on', ed.chip === sl.key);
    el.classList.toggle('changed', v !== 0);
  }
  const sl = TONE_SLIDERS.find((x) => x.key === ed.chip);
  const one = $('#edOne');
  one.min = sl.min;
  one.max = sl.max;
  one.value = it.tone[sl.key] || 0;
}
$('#edOne').addEventListener('input', (e) => {
  const it = cur();
  it.tone[ed.chip] = +e.target.value;
  chipEls[ed.chip].querySelector('small').textContent = fmt(+e.target.value);
  chipEls[ed.chip].classList.toggle('changed', +e.target.value !== 0);
  markManual(it);
  queueEditorRender();
});
$('#edOne').addEventListener('change', () => refreshDeskSliders());
function refreshEdTone() {
  refreshDeskSliders();
  refreshChips();
}

// มือถือ: แท็บ "ตำแหน่ง" (รูปเต็ม+กรอบ) / "แสงสี" (ผลลัพธ์)
ed.tab = 'frame';
function setTab(t) {
  const el = $('#editor');
  el.classList.toggle('tab-frame', t === 'frame');
  el.classList.toggle('tab-tone', t === 'tone');
  document.querySelectorAll('#edTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  queueEditorRender();
}
document.querySelectorAll('#edTabs button').forEach((b) =>
  b.addEventListener('click', () => {
    ed.tab = b.dataset.tab; // จำแท็บล่าสุดไว้ใช้กับรูปถัดไป
    setTab(ed.tab);
  }),
);

async function ensureWork(it) {
  if (ed.workId === it.id) return;
  if (ed.work) ed.work.width = 0;
  ed.work = null;
  ed.workId = it.id;
  try {
    const c = await workCanvas(it, WORK_MAX);
    if (ed.workId === it.id) {
      ed.work = c;
      queueEditorRender();
    } else c.width = 0;
  } catch {
    /* ใช้รูปย่อแทน */
  }
}

function openEditor(i) {
  if (i < 0 || i >= state.items.length) return;
  state.editIndex = i;
  $('#editor').hidden = false;
  document.body.style.overflow = 'hidden';
  updateEditor();
  ensureWork(cur());
}
function closeEditor() {
  const it = cur();
  $('#editor').hidden = true;
  document.body.style.overflow = '';
  state.editIndex = -1;
  if (ed.work) ed.work.width = 0;
  ed.work = null;
  ed.workId = null;
  if (it) renderTile(it);
}
function renderNotes() {
  const it = cur();
  const ul = $('#edNotes');
  ul.textContent = '';
  for (const n of it.notes || []) {
    const li = document.createElement('li');
    li.textContent = n;
    ul.append(li);
  }
  ul.hidden = !ul.children.length;
}
function updateEditor() {
  const it = cur();
  $('#edTitle').textContent = `${state.editIndex + 1}/${state.items.length} · ${it.name}`;
  $('#edPrev').disabled = state.editIndex === 0;
  $('#edNext').disabled = state.editIndex === state.items.length - 1;
  const frame = canFrame(S.mode);
  $('#edFrame').hidden = !frame;
  $('#edCropPane').hidden = !frame;
  const zoomHow = touchUI ? 'สองนิ้วเพื่อซูม' : 'ลูกกลิ้งเพื่อซูม';
  $('#edCropLabel').textContent =
    S.mode === 'orig'
      ? `รูปเต็ม · ซูมแล้วลากกรอบเลือกส่วนที่ต้องการ · ${zoomHow}`
      : `รูปเต็ม · ลากกรอบเพื่อเลือกตำแหน่ง · ${zoomHow}`;
  $('#edZoom').value = it.zoom;
  $('#edTabs [data-tab="frame"]').hidden = !frame;
  setTab(frame ? ed.tab : 'tone');
  refreshEdTone();
  renderNotes();
  drawEditor();
}
function drawEditor() {
  drawCrop();
  drawPreview();
}
function queueEditorRender() {
  cancelAnimationFrame(ed.raf);
  ed.raf = requestAnimationFrame(drawEditor);
}

// ซ้าย: รูปเต็ม + กรอบที่จะตัด (เห็นว่าส่วนไหนถูกตัดออก)
function drawCrop() {
  const it = cur();
  if (!it || !canFrame(S.mode)) return;
  const src = ed.work || it.thumb;
  const box = ed.crop.parentElement;
  if (box.clientWidth < 10) return; // ซ่อนอยู่ (แท็บแสงสีบนมือถือ)
  const s = Math.min((box.clientWidth - 4) / src.width, (box.clientHeight - 4) / src.height);
  const cw = Math.max(1, Math.floor(src.width * s));
  const ch = Math.max(1, Math.floor(src.height * s));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = ed.crop;
  c.width = Math.round(cw * dpr);
  c.height = Math.round(ch * dpr);
  c.style.width = `${cw}px`;
  c.style.height = `${ch}px`;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  const f = cropFrac(S.mode, src.width, src.height, it);
  const r = { x: f.x * cw, y: f.y * ch, w: f.w * cw, h: f.h * ch };
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
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
}

// ขวา: ผลลัพธ์จริง (ตัด + แสงสี + ลายน้ำ)
function drawPreview() {
  const it = cur();
  if (!it) return;
  const box = ed.preview.parentElement;
  if (box.clientWidth < 10) return;
  const sw = Math.max(50, box.clientWidth - 4);
  const sh = Math.max(50, box.clientHeight - 4);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // ระหว่างลาก/ซูม วาดความละเอียดต่ำลงให้ลื่น ปล่อยมือแล้ววาดเต็ม
  const maxSide = ed.interacting ? 720 : Math.min(WORK_MAX, Math.round(Math.max(sw, sh) * dpr));
  renderImage(ed.work || it.thumb, it, S, { maxSide, tone: !ed.compare, into: ed.preview });
  const w = ed.preview.width;
  const h = ed.preview.height;
  const s = Math.min(sw / w, sh / h);
  ed.preview.style.width = `${Math.floor(w * s)}px`;
  ed.preview.style.height = `${Math.floor(h * s)}px`;
}

// ลากกรอบ = เลือกตำแหน่ง, สองนิ้ว/ลูกกลิ้ง = ซูม (ทำที่รูปเต็มฝั่งซ้าย)
function beginGesture() {
  const it = cur();
  const src = ed.work || it.thumb;
  const pts = [...ed.ptrs.values()].map((p) => ({ ...p }));
  ed.start = {
    fx: it.fx,
    fy: it.fy,
    zoom: it.zoom,
    pts,
    f: cropFrac(S.mode, src.width, src.height, it),
    cw: ed.crop.clientWidth,
    ch: ed.crop.clientHeight,
    dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
  };
  ed.interacting = true;
  ed.crop.classList.add('dragging');
}
ed.crop.addEventListener('pointerdown', (e) => {
  if (!canFrame(S.mode)) return;
  ed.crop.setPointerCapture(e.pointerId);
  ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  beginGesture();
});
ed.crop.addEventListener('pointermove', (e) => {
  if (!ed.ptrs.has(e.pointerId)) return;
  ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const it = cur();
  const pts = [...ed.ptrs.values()];
  const st = ed.start;
  if (pts.length >= 2 && st.dist) {
    it.zoom = clampN((st.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / st.dist, 1, 4);
  } else if (pts.length === 1) {
    const dx = pts[0].x - st.pts[0].x;
    const dy = pts[0].y - st.pts[0].y;
    // กรอบเคลื่อนตามนิ้ว/เมาส์
    if (st.f.w < 0.999) it.fx = clampN(st.fx + dx / (st.cw * (1 - st.f.w)), 0, 1);
    if (st.f.h < 0.999) it.fy = clampN(st.fy + dy / (st.ch * (1 - st.f.h)), 0, 1);
  }
  markManual(it);
  queueEditorRender();
});
function endGesture(e) {
  if (!ed.ptrs.delete(e.pointerId)) return;
  if (ed.ptrs.size) return beginGesture();
  ed.interacting = false;
  ed.crop.classList.remove('dragging');
  $('#edZoom').value = cur().zoom;
  queueEditorRender();
}
ed.crop.addEventListener('pointerup', endGesture);
ed.crop.addEventListener('pointercancel', endGesture);
let wheelTimer = 0;
ed.crop.addEventListener(
  'wheel',
  (e) => {
    if (!canFrame(S.mode)) return;
    e.preventDefault();
    const it = cur();
    it.zoom = clampN(it.zoom * Math.exp(-e.deltaY * 0.0015), 1, 4);
    $('#edZoom').value = it.zoom;
    markManual(it);
    ed.interacting = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      ed.interacting = false;
      queueEditorRender();
    }, 180);
    queueEditorRender();
  },
  { passive: false },
);
ed.crop.addEventListener('contextmenu', (e) => e.preventDefault());
ed.preview.addEventListener('contextmenu', (e) => e.preventDefault());
// กดค้างที่รูปผลลัพธ์ = ดูก่อนปรับ (สะดวกบนมือถือ)
ed.preview.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setCompare(true);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ed.preview.addEventListener(ev, () => setCompare(false));

$('#edZoom').addEventListener('input', (e) => {
  cur().zoom = +e.target.value;
  markManual(cur());
  queueEditorRender();
});
$('#edCropReset').addEventListener('click', () => {
  Object.assign(cur(), { fx: 0.5, fy: 0.5, zoom: 1 });
  $('#edZoom').value = 1;
  markManual(cur());
  queueEditorRender();
});
$('#edAuto').addEventListener('click', () => {
  applyAuto(cur());
  refreshEdTone();
  renderNotes();
  invalidateExport();
  queueEditorRender();
});
$('#edToneReset').addEventListener('click', () => {
  clearTone(cur());
  refreshEdTone();
  renderNotes();
  markManual(cur());
  queueEditorRender();
});
$('#edRemove').addEventListener('click', () => {
  const i = state.editIndex;
  removeItem(state.items[i]);
  if (!state.items.length) return closeEditor();
  state.editIndex = Math.min(i, state.items.length - 1);
  updateEditor();
  ensureWork(cur());
});

// กดค้างเพื่อเทียบก่อน/หลังปรับแสงสี
const setCompare = (v) => {
  if (ed.compare === v) return;
  ed.compare = v;
  $('#edCompare').classList.toggle('on', v);
  drawPreview();
};
const cmp = $('#edCompare');
cmp.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setCompare(true);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cmp.addEventListener(ev, () => setCompare(false));
cmp.addEventListener('contextmenu', (e) => e.preventDefault());

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
    $('#namePreview').textContent = `ตัวอย่าง: ${['00', cleanPrefix(), todayStr(), '01'].filter(Boolean).join('_')}.jpg`;
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
  const noDate = state.items.filter((it) => !it.date).length;
  $('#namePreview').textContent =
    `ตัวอย่าง: ${fileNames()[0]}` + (noDate ? ` · ${noDate} รูปไม่มีวันที่ถ่าย ใช้วันนี้แทน` : '');
}

// ชื่อไฟล์: 00_คำค้นหา_วันที่ถ่าย_ลำดับ (ลำดับตามหน้าแอป เริ่มนับใหม่ทุกวันที่)
const pad2 = (n) => String(n).padStart(2, '0');
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
function cleanPrefix() {
  return (S.prefix || '')
    .trim()
    .replace(/[^\w\u0E00-\u0E7F-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
function fileNames() {
  const today = todayStr();
  const pre = cleanPrefix();
  const count = {};
  return state.items.map((it) => {
    const d = it.date || today;
    count[d] = (count[d] || 0) + 1;
    return `${['00', pre, d, pad2(count[d])].filter(Boolean).join('_')}.jpg`;
  });
}
$('#prefixInput').value = S.prefix;
$('#prefixInput').addEventListener('input', (e) => {
  S.prefix = e.target.value;
  saveSettings();
  invalidateExport();
  updateExportSummary();
});

function invalidateExport() {
  state.exported = null;
  $('#exportReady').hidden = true;
  $('#exportBtn').hidden = false;
}

// สร้างไฟล์ทีละรูป (iPhone จะไม่ค้าง); ถ้าไม่ได้แก้อะไรหลังสร้างครั้งก่อน ใช้ไฟล์เดิม
async function prepareFiles() {
  if (state.exported) return state.exported;
  const items = state.items;
  const names = fileNames();
  const files = [];
  try {
    for (let i = 0; i < items.length; i++) {
      progress('กำลังสร้างไฟล์', i, items.length);
      await nextFrame();
      const it = items[i];
      // ตัดจากไฟล์ต้นฉบับโดยตรงทุกโหมด: บีบอัดรอบเดียว และไม่ต้องขยายภาพ
      const src = await loadOriginal(it);
      const canvas = renderImage(src, it, S, { p3: true });
      const blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      canvas.width = 0;
      if (src.close) src.close();
      files.push(new File([blob], names[i], { type: 'image/jpeg' }));
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
  return `${['00', cleanPrefix(), state.items[0]?.date || todayStr()].filter(Boolean).join('_')}.zip`;
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

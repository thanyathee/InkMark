// โหมดต่อภาพ: ต่อภาพแคปหน้าจอหลายภาพเป็นภาพยาวภาพเดียว (แทนแอป Tailor)
// เรียงจากบนลงล่างตามลำดับที่เลือก (สลับลำดับได้) · หาส่วนซ้อนอัตโนมัติ · ปรับรอยต่อเองได้
// บันทึกเป็น PNG ความละเอียดเต็ม ชื่อ = ชื่อภาพแรก_stitch.png
import { loadImage, toBlob, ensureDecodable } from './render.js';
import { makeSig, matchPair, detectBars, isDuplicate, bestOrder } from './stitch.js';

const $ = (s) => document.querySelector(s);
const THUMB_W = 720;
const MAX_PX = 16e6; // เพดานพิกเซลของ canvas บน iPhone

export function initStitchMode(h) {
  const st = { items: [], seams: [], exported: null, bars: null, cache: new Map(), keepHeader: true, keepFooter: true };
  let nextId = 1;
  const invalidate = () => {
    st.exported = null;
    $('#stitchPrepare').hidden = false;
    $('#stitchShare').hidden = true;
  };

  async function addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      h.progress('กำลังโหลดภาพ', i, files.length);
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
        const s = Math.min(1, THUMB_W / w);
        const thumb = document.createElement('canvas');
        thumb.width = Math.round(w * s);
        thumb.height = Math.round(hh * s);
        const tctx = thumb.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(img, 0, 0, thumb.width, thumb.height);
        st.items.push({ id: nextId++, file: f, name: f.name || `screenshot-${nextId}.png`, w, h: hh, thumb, sig: makeSig(img) });
      } catch {
        h.toast(`เปิดไม่ได้: ${f.name}`);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    h.progressDone();
    await autoArrange();
  }

  // แถบบน/ล่าง: เทียบจากทุกภาพพร้อมกัน (เปลี่ยนเมื่อเพิ่ม/ลบภาพ)
  function updateBars() {
    const b = detectBars(st.items.map((it) => it.sig));
    const key = JSON.stringify(b);
    if (key !== st.barsKey) st.cache.clear();
    st.bars = b;
    st.barsKey = key;
  }
  function pairMatch(a, b) {
    const k = `${a.id}>${b.id}`;
    if (!st.cache.has(k)) st.cache.set(k, matchPair(a.sig, b.sig, st.bars));
    return st.cache.get(k);
  }

  // เรียงอัตโนมัติ: ตัดภาพซ้ำ → จับคู่ทุกภาพ → หาลำดับที่ต่อได้ดีที่สุด
  async function autoArrange() {
    const n0 = st.items.length;
    if (n0 < 2) return rematch();
    updateBars();
    const keep = [];
    for (const it of st.items) {
      if (keep.some((k) => isDuplicate(k.sig, it.sig, st.bars))) it.thumb.width = 0;
      else keep.push(it);
    }
    const dups = n0 - keep.length;
    st.items = keep;
    updateBars();
    const n = st.items.length;
    const match = Array.from({ length: n }, () => new Array(n).fill(null));
    const total = n * (n - 1);
    let done = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (done % 4 === 0) {
          h.progress('กำลังหาลำดับภาพ', done, total);
          await h.nextFrame();
        }
        match[i][j] = pairMatch(st.items[i], st.items[j]);
        done++;
      }
    h.progressDone();
    const names = st.items.map((it) => it.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rank = names.map((nm) => sorted.indexOf(nm));
    const before = st.items.map((it) => it.id).join();
    st.items = bestOrder(n, match, rank).map((i) => st.items[i]);
    const moved = before !== st.items.map((it) => it.id).join();
    rematch();
    const bad = st.seams.filter((x) => !x.found).length;
    const msg = [];
    if (dups) msg.push(`ตัดภาพซ้ำ ${dups} ภาพ`);
    if (moved) msg.push('จัดลำดับให้ใหม่');
    msg.push(bad ? `⚠️ หาส่วนซ้อนไม่เจอ ${bad} รอยต่อ` : `⧉ ต่อสำเร็จ ${n} ภาพ`);
    h.toast(msg.join(' · '), 4000);
  }

  // คำนวณรอยต่อของภาพที่อยู่ติดกัน (เมื่อเพิ่ม/ลบ/สลับลำดับ)
  function rematch() {
    if (st.items.length > 1) updateBars();
    st.seams = [];
    for (let i = 0; i < st.items.length - 1; i++) st.seams.push({ ...pairMatch(st.items[i], st.items[i + 1]), adj: 0 });
    invalidate();
    render();
  }

  // ช่วงแถวที่ใช้จากแต่ละภาพ (พิกเซลจริง)
  function pieces() {
    const n = st.items.length;
    return st.items.map((it, i) => {
      const top = st.keepHeader || !st.bars ? 0 : st.bars.fHeader;
      const bot = st.keepFooter || !st.bars ? it.h : it.h - st.bars.fFooter;
      let y0 = i === 0 ? top : st.seams[i - 1].startB + st.seams[i - 1].adj;
      let y1 = i === n - 1 ? bot : st.seams[i].cutA;
      y0 = Math.max(0, Math.min(it.h - 1, y0));
      y1 = Math.max(y0 + 1, Math.min(it.h, y1));
      return { it, y0, y1 };
    });
  }
  function outSize() {
    if (!st.items.length) return { W: 0, H: 0 };
    const W = st.items[0].w;
    const H = pieces().reduce((a, p) => a + ((p.y1 - p.y0) * W) / p.it.w, 0);
    return { W, H: Math.round(H) };
  }

  // ---------- หน้าจอ ----------
  function render() {
    const n = st.items.length;
    $('#stitchEmpty').hidden = n > 0;
    $('#stitchWork').hidden = !n;
    $('#stitchBar').hidden = n < 2;
    h.setTop(n);
    renderStrip();
    renderPreview();
    renderSeams();
    const { W, H } = outSize();
    const scaled = W * H > MAX_PX;
    $('#stitchSummary').innerHTML =
      `<strong>${n} ภาพ</strong> → ${W}×${H} px` + (scaled ? '<br><small class="muted">ยาวมาก จะย่อลงให้พอดีกับ iPhone</small>' : '');
    const b = st.bars;
    $('#stitchBars').textContent =
      n > 1 && b
        ? `ตรวจพบแถบบน ${b.fHeader} px · แถบล่าง ${b.fFooter} px (เหมือนกันทุกภาพ)`
        : 'เพิ่มภาพอย่างน้อย 2 ภาพ';
  }

  function renderStrip() {
    const strip = $('#stitchStrip');
    strip.textContent = '';
    st.items.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'strip-item';
      const c = document.createElement('canvas');
      const s = 84 / it.thumb.width;
      c.width = 84;
      c.height = Math.round(Math.min(it.thumb.height * s, 150));
      c.getContext('2d').drawImage(it.thumb, 0, 0, it.thumb.width, c.height / s, 0, 0, 84, c.height);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      const bar = document.createElement('div');
      bar.className = 'strip-btns';
      const mk = (txt, label, fn, dis) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = txt;
        b.setAttribute('aria-label', label);
        b.disabled = dis;
        b.addEventListener('click', fn);
        bar.append(b);
      };
      const move = (d) => () => {
        const j = i + d;
        [st.items[i], st.items[j]] = [st.items[j], st.items[i]];
        rematch();
      };
      mk('◀', 'เลื่อนขึ้นก่อน', move(-1), i === 0);
      mk('✕', 'ลบภาพนี้', () => {
        st.items[i].thumb.width = 0;
        st.items.splice(i, 1);
        rematch();
      });
      mk('▶', 'เลื่อนไปหลัง', move(1), i === st.items.length - 1);
      el.append(c, num, bar);
      strip.append(el);
    });
  }

  function renderPreview() {
    const cv = $('#stitchCanvas');
    if (!st.items.length) return;
    const box = $('#stitchPreviewBox');
    const cssW = Math.min(box.clientWidth - 16 || 360, 420);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const PW = Math.round(cssW * dpr);
    const ps = pieces();
    const total = ps.reduce((a, p) => a + ((p.y1 - p.y0) * PW) / p.it.w, 0);
    const PH = Math.min(Math.round(total), 30000);
    cv.width = PW;
    cv.height = PH;
    cv.style.width = `${cssW}px`;
    cv.style.height = `${Math.round(PH / dpr)}px`;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    let y = 0;
    const seamsY = [];
    ps.forEach((p, i) => {
      const k = p.it.thumb.width / p.it.w; // พิกเซลจริง → รูปย่อ
      const dh = ((p.y1 - p.y0) * PW) / p.it.w;
      ctx.drawImage(p.it.thumb, 0, p.y0 * k, p.it.thumb.width, (p.y1 - p.y0) * k, 0, y, PW, dh);
      y += dh;
      if (i < ps.length - 1) seamsY.push(y);
    });
    // เส้นรอยต่อ
    seamsY.forEach((sy, i) => {
      const ok = st.seams[i].found;
      ctx.strokeStyle = ok ? 'rgba(46,125,50,0.9)' : 'rgba(230,81,0,0.95)';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([8 * dpr, 6 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(PW, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ok ? 'rgba(46,125,50,0.9)' : 'rgba(230,81,0,0.95)';
      ctx.font = `600 ${12 * dpr}px -apple-system, sans-serif`;
      const label = ` รอยต่อ ${i + 1} `;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(PW - tw - 6 * dpr, sy - 18 * dpr, tw, 16 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, PW - tw - 6 * dpr, sy - 6 * dpr);
    });
    st.seamY = seamsY.map((v) => v / dpr);
  }

  function renderSeams() {
    const box = $('#stitchSeams');
    box.textContent = '';
    if (st.seams.length === 0) {
      box.innerHTML = '<p class="hint">เพิ่มภาพอย่างน้อย 2 ภาพเพื่อต่อกัน</p>';
      return;
    }
    st.seams.forEach((sm, i) => {
      const row = document.createElement('div');
      row.className = `seam ${sm.found ? 'ok' : 'warn'}`;
      row.innerHTML = `
        <div class="seam-head">
          <strong>รอยต่อ ${i + 1}</strong> <span class="muted">ภาพ ${i + 1} → ${i + 2}</span>
          <button type="button" class="ghost small seam-go">ดู</button>
        </div>
        <p class="seam-status">${sm.found ? '✓ หาส่วนซ้อนเจอ ต่ออัตโนมัติ' : '⚠️ หาส่วนซ้อนไม่เจอ ต่อแบบชนกัน — เลื่อนปรับเองได้'}</p>
        <label class="sl"><span>เลื่อนรอยต่อ</span><output>${sm.adj > 0 ? '+' : ''}${sm.adj} px</output>
          <input type="range" min="-600" max="600" step="2" value="${sm.adj}"></label>`;
      const input = row.querySelector('input');
      const out = row.querySelector('output');
      input.addEventListener('input', () => {
        sm.adj = +input.value;
        out.textContent = `${sm.adj > 0 ? '+' : ''}${sm.adj} px`;
        invalidate();
        renderPreview();
        const { W, H } = outSize();
        $('#stitchSummary').innerHTML = `<strong>${st.items.length} ภาพ</strong> → ${W}×${H} px`;
      });
      input.addEventListener('dblclick', () => {
        input.value = 0;
        input.dispatchEvent(new Event('input'));
      });
      row.querySelector('.seam-go').addEventListener('click', () => {
        const pb = $('#stitchPreviewBox');
        const y = (st.seamY?.[i] || 0) - pb.clientHeight / 2;
        pb.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      });
      box.append(row);
    });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'เลื่อน + = ตัดส่วนซ้ำของภาพล่างออกมากขึ้น · − = เก็บไว้มากขึ้น · แตะสองครั้งที่แถบเพื่อกลับเป็น 0';
    box.append(hint);
  }

  $('#stitchAuto').addEventListener('click', () => autoArrange());
  $('#stitchKeepHeader').checked = st.keepHeader;
  $('#stitchKeepFooter').checked = st.keepFooter;
  $('#stitchKeepHeader').addEventListener('change', (e) => {
    st.keepHeader = e.target.checked;
    invalidate();
    render();
  });
  $('#stitchKeepFooter').addEventListener('change', (e) => {
    st.keepFooter = e.target.checked;
    invalidate();
    render();
  });

  window.addEventListener('resize', () => h.isActive() && st.items.length && renderPreview());

  // ---------- บันทึก ----------
  function outName() {
    const m = /^(.*?)(\.[^.]+)?$/.exec(st.items[0].name);
    return `${m[1]}_stitch.png`;
  }
  async function prepare() {
    if (st.exported) return st.exported;
    try {
      const ps = pieces();
      let { W, H } = outSize();
      const s = W * H > MAX_PX ? Math.sqrt(MAX_PX / (W * H)) : 1;
      const OW = Math.round(W * s);
      const OH = Math.round(H * s);
      const c = document.createElement('canvas');
      c.width = OW;
      c.height = OH;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      let y = 0;
      for (let i = 0; i < ps.length; i++) {
        h.progress('กำลังต่อภาพ', i, ps.length);
        await h.nextFrame();
        const p = ps[i];
        const url = URL.createObjectURL(p.it.file);
        try {
          const img = await loadImage(url);
          const dh = ((p.y1 - p.y0) * OW) / p.it.w;
          ctx.drawImage(img, 0, p.y0, p.it.w, p.y1 - p.y0, 0, Math.round(y), OW, Math.ceil(dh));
          y += dh;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const blob = await toBlob(c, 'image/png');
      c.width = 0;
      h.progressDone();
      st.exported = [new File([blob], outName(), { type: 'image/png' })];
      return st.exported;
    } catch (err) {
      h.progressDone();
      h.toast('ต่อภาพไม่สำเร็จ', 4000);
      console.error(err);
      return null;
    }
  }
  $('#stitchPrepare').addEventListener('click', async () => {
    if (!(await prepare())) return;
    $('#stitchPrepare').hidden = true;
    $('#stitchShare').hidden = false;
  });
  $('#stitchShare').addEventListener('click', () => st.exported && h.shareFiles(st.exported));
  $('#stitchDownload').addEventListener('click', async () => {
    const files = await prepare();
    if (files) h.downloadAll(files);
  });

  function clear() {
    for (const it of st.items) it.thumb.width = 0;
    st.items = [];
    rematch();
  }

  render();
  return { addFiles, clear, refresh: render, state: st };
}

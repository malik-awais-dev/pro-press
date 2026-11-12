const state = { files: [], nextId: 0, lastBlob: null, selId: null, editing: false, shownRenameTip: false };
const $ = id => document.getElementById(id);
const fmtB = b => !b ? '0 B' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const extOf = f => ({ webp: 'webp', avif: 'avif', jpeg: 'jpg', png: 'png' }[f]);
const mimeOf = f => ({ webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }[f]);
const baseName = n => n.replace(/\.[^.]+$/, '');
const gFmt = () => $('gFmt').value;
const gQ = () => parseInt($('gQ').value) / 100;
const gMaxw = () => 0;

const qMap = [[10, 'Very low — heavy artifacts'], [20, 'Low — visible loss'], [30, 'Low'], [40, 'Fair'], [50, 'Moderate'], [60, 'Moderate'], [70, 'Good'], [80, 'Good — recommended'], [90, 'Excellent'], [95, 'Near lossless'], [100, 'Maximum quality']];
function qLabel(v) { let r = qMap[0][1]; for (const [k, l] of qMap) if (v >= k) r = l; return r; }

// ── Toasts (log() is now user-visible) ──

(function injectToastStyle() {
  const s = document.createElement('style');
  s.textContent = '@keyframes ppToastIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}' +
    '@keyframes ppBarSlide{0%{margin-left:-35%}100%{margin-left:100%}}';
  document.head.appendChild(s);
})();

const toastWrap = document.createElement('div');
toastWrap.style.cssText = 'position:fixed;top:14px;right:14px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(340px,86vw);pointer-events:none;';
document.body.appendChild(toastWrap);

function log(msg, type) {
  if (!msg) return;
  const t = document.createElement('div');
  const accent = type === 'err' ? '#F26D6D' : type === 'ok' ? '#5AD78E' : 'var(--secondary, #8B7FD4)';
  t.style.cssText = 'pointer-events:auto;padding:10px 14px 10px 12px;border-radius:10px;font-size:12.5px;font-weight:500;line-height:1.45;color:#EDEAF6;background:#262038;border-left:3px solid ' + accent + ';box-shadow:0 8px 28px rgba(0,0,0,.4);animation:ppToastIn .25s ease;';
  t.textContent = msg;
  toastWrap.appendChild(t);
  while (toastWrap.children.length > 4) toastWrap.firstChild.remove();
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, type === 'err' ? 4200 : 2600);
}

// ── Quality & Format Controls ──

$('gQ').addEventListener('input', () => {
  const v = parseInt($('gQ').value);
  $('gQout').textContent = v + '%';
  $('qHint').textContent = qLabel(v);
  applySettingsToPending();
});

$('gFmt').addEventListener('change', () => {
  const p = gFmt() === 'png';
  $('gQ').disabled = p;
  $('gQout').style.opacity = p ? .3 : 1;
  $('qHint').textContent = p ? 'Lossless — quality setting ignored' : qLabel(parseInt($('gQ').value));
  applySettingsToPending();
});

// Settings changes now live-apply to queued (not yet converted) files,
// instead of being silently frozen at the values captured when files were added.
function applySettingsToPending() {
  if (state.editing) return;
  const fmt = gFmt();
  const q = parseInt($('gQ').value);
  let changed = false;
  state.files.forEach(e => {
    if (e.status === 'pending' || e.status === 'error') {
      if (e.fmt !== fmt) { e.fmt = fmt; changed = true; }
      if (e.quality !== q) { e.quality = q; changed = true; }
    }
  });
  if (changed) rebuildTable();
}

// ── Encode support detection (AVIF/WebP are not encodable in every browser) ──

const fmtSupport = { webp: true, avif: true, jpeg: true, png: true };

function detectEncodeSupport(mime) {
  return new Promise(resolve => {
    try {
      const c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      c.toBlob(b => resolve(!!(b && b.type === mime)), mime);
    } catch (e) { resolve(false); }
  });
}

(async function detectFormats() {
  fmtSupport.webp = await detectEncodeSupport('image/webp');
  fmtSupport.avif = await detectEncodeSupport('image/avif');
  ['webp', 'avif'].forEach(f => {
    if (fmtSupport[f]) return;
    const chip = document.querySelector('#fmtChips .chip[data-val="' + f + '"]');
    if (chip) {
      chip.disabled = true;
      chip.title = 'Not supported in this browser';
      chip.style.opacity = '.35';
      chip.style.cursor = 'not-allowed';
    }
    const opt = $('gFmt').querySelector('option[value="' + f + '"]');
    if (opt) opt.disabled = true;
    if (gFmt() === f) {
      const fallback = fmtSupport.webp ? 'webp' : (fmtSupport.avif ? 'avif' : 'jpeg');
      const fbChip = document.querySelector('#fmtChips .chip[data-val="' + fallback + '"]');
      if (fbChip && typeof setChip === 'function') setChip('gFmt', 'fmtChips', fbChip);
    }
  });
})();

// ── Drop Zone ──

const dz = $('dz');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
$('fi').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

// ── Convert FAB Attention Pulse ──

function pulseConvertBtn() {
  const btn = $('btnConvert');
  btn.classList.remove('fab-attention');
  void btn.offsetWidth;
  btn.classList.add('fab-attention');
  btn.addEventListener('animationend', () => btn.classList.remove('fab-attention'), { once: true });
}

function showRenameTip() {
  const firstName = $('fileBody').querySelector('.file-name');
  if (!firstName) return;
  firstName.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'rename-tooltip';
  tip.textContent = 'Click name to rename';
  firstName.appendChild(tip);
  tip.addEventListener('animationend', () => tip.remove());
}

// ── File Management ──

function addFiles(files) {
  let added = 0, skip = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) { skip++; continue; }
    if (f.size > 50 * 1024 * 1024) { log('Too large, skipped: ' + f.name, 'err'); skip++; continue; }
    const id = ++state.nextId;
    state.files.push({ id, file: f, status: 'pending', blob: null, outSize: 0, outName: null, resolvedName: null, fmt: gFmt(), quality: parseInt($('gQ').value) });
    added++;
  }
  if (added) {
    log('Added ' + added + ' file(s)' + (skip ? ' · ' + skip + ' skipped' : ''), 'info');
    rebuildTable(); updateUI();
    setTimeout(pulseConvertBtn, 300);
    if (!state.shownRenameTip) {
      state.shownRenameTip = true;
      setTimeout(showRenameTip, 600);
    }
  } else {
    if (skip) log('No images added — ' + skip + ' file(s) skipped (unsupported type or over 50 MB)', 'err');
    rebuildTable(); updateUI();
  }
}

function rebuildTable() {
  if (state.editing) return;
  const container = $('fileBody'); container.innerHTML = '';
  const qb = $('queueBadge'); if (qb) qb.textContent = state.files.length || '';
  if (!state.files.length) {
    container.innerHTML = '<div class="empty-hint">No images yet — drop files or browse above</div>';
    return;
  }
  state.files.forEach(e => {
    if (!e.thumbUrl) e.thumbUrl = URL.createObjectURL(e.file);
    const card = document.createElement('div');
    card.id = 'tr-' + e.id;
    let cls = 'file-row';
    if (state.selId === e.id) cls += ' sel';
    if (e.status === 'done') cls += ' done-row';
    if (e.status === 'error') cls += ' error-row';
    if (e.status === 'converting') cls += ' converting-row';
    card.className = cls;
    card.addEventListener('click', () => { if (state.editing) return; state.selId = e.id; rebuildTable(); $('btnRemSel').disabled = false; });

    const diff = e.file.size - (e.outSize || 0);
    const pct = e.outSize ? Math.abs(Math.round(diff / e.file.size * 100)) : null;
    const outTxt = e.outSize ? fmtB(e.outSize) : '';
    const ext = extOf(e.fmt || gFmt());
    const dispBase = e.outName || baseName(e.file.name);

    const thumbHtml = e.status === 'converting'
      ? `<img src="${e.thumbUrl}" alt=""><div class="spinner"><span class="mi">sync</span></div>`
      : `<img src="${e.thumbUrl}" alt="">`;

    let metaLine = fmtB(e.file.size);
    if (e.status === 'converting') metaLine = 'Compressing…';
    else if (e.status === 'done' && e.outSize) metaLine = fmtB(e.file.size) + ' → ' + outTxt + ' · ' + ext.toUpperCase();
    else if (e.status === 'pending') metaLine = fmtB(e.file.size) + ' · waiting';
    else if (e.status === 'error') metaLine = fmtB(e.file.size) + ' · error';

    let pctHtml = '';
    if (e.status === 'done' && pct !== null) {
      const sign = diff >= 0 ? '−' : '+';
      pctHtml = `<span class="file-pct ${diff >= 0 ? 'pct-done' : 'pct-neg'}">${sign}${pct}%</span>`;
    } else if (e.status === 'converting') {
      pctHtml = `<span class="file-pct pct-working">…</span>`;
    } else if (e.status === 'pending') {
      pctHtml = `<span class="file-pct pct-wait">—</span>`;
    } else if (e.status === 'error') {
      pctHtml = `<span class="file-pct pct-error">!</span>`;
    }

    let acts = '';
    if (e.status === 'done' && e.blob) {
      acts += `<button class="btn-icon" onclick="event.stopPropagation();openPreview(${e.id})" title="Preview"><span class="mi">visibility</span></button>`;
      acts += `<button class="btn-icon" onclick="event.stopPropagation();dlOne(${e.id})" title="Download"><span class="mi">download</span></button>`;
    }
    if (e.status !== 'converting') {
      const altBtnId = 'altBtn-' + e.id;
      acts += `<button class="btn-icon btn-icon-alt" id="${altBtnId}" onclick="event.stopPropagation();genAlt(${e.id})" title="Generate Alt Text">Alt</button>`;
    }
    acts += `<button class="btn-icon danger" onclick="event.stopPropagation();removeOne(${e.id})" title="Remove"><span class="mi">close</span></button>`;

    // Honest indeterminate bar while converting (no fake 50%).
    const progHtml = e.status === 'converting'
      ? '<div class="file-progress" style="overflow:hidden"><div class="file-progress-bar" style="width:35%;animation:ppBarSlide 1.1s ease-in-out infinite"></div></div>'
      : '';

    card.innerHTML = `
      <div class="file-thumb">${thumbHtml}</div>
      <div class="file-info">
        <div class="file-name" title="${e.file.name}">
          <span class="file-name-text" data-id="${e.id}">${dispBase}</span><span class="file-ext">.${ext}</span>
          <span class="mi edit-hint">edit</span>
        </div>
        <div class="file-meta"><span class="mono">${metaLine}</span></div>
        ${progHtml}
      </div>
      ${pctHtml}
      <div class="file-actions">${acts}</div>`;

    card.querySelector('.file-name-text').addEventListener('click', ev => {
      ev.stopPropagation();
      startInlineRename(e.id, card);
    });
    container.appendChild(card);
  });
}

function removeOne(id) {
  const e = state.files.find(x => x.id === id);
  if (e) { if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl); log('Removed: ' + e.file.name); }
  state.files = state.files.filter(x => x.id !== id);
  if (state.selId === id) { state.selId = null; $('btnRemSel').disabled = true; }
  rebuildTable(); updateUI();
}

// ── Inline Rename ──

function startInlineRename(id, card) {
  if (state.editing) return;
  const entry = state.files.find(x => x.id === id);
  if (!entry) return;

  state.editing = true;
  const nameEl = card.querySelector('.file-name');
  const currentBase = entry.outName || baseName(entry.file.name);
  const ext = extOf(entry.fmt || gFmt());

  nameEl.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'file-name-input';
  input.value = currentBase;
  nameEl.appendChild(input);

  const extSpan = document.createElement('span');
  extSpan.style.cssText = 'color:var(--outline);font-weight:400;font-size:14px;flex-shrink:0';
  extSpan.textContent = '.' + ext;
  nameEl.appendChild(extSpan);

  input.focus();
  input.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const val = input.value.trim();
    if (val && val !== baseName(entry.file.name)) {
      entry.outName = val;
      if (entry.resolvedName) entry.resolvedName = val + '.' + ext;
      log('Renamed → ' + val + '.' + ext, 'ok');
    } else if (!val) {
      entry.outName = null;
      entry.resolvedName = null;
    }
    state.editing = false;
    rebuildTable();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { ev.preventDefault(); committed = true; state.editing = false; rebuildTable(); }
  });
  input.addEventListener('click', ev => ev.stopPropagation());
}

// ── Download Single ──

function dlOne(id) {
  const e = state.files.find(x => x.id === id); if (!e || !e.blob) return;
  const url = URL.createObjectURL(e.blob);
  const a = document.createElement('a'); a.href = url; a.download = e.resolvedName || baseName(e.file.name) + '.' + extOf(e.fmt || gFmt());
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  log('Downloaded: ' + (e.resolvedName || e.file.name), 'ok');
}

// ── Preview ──

let prevH = 320;
const prevSteps = [200, 320, 440, 560];

function openPreview(id) {
  const e = state.files.find(x => x.id === id); if (!e || !e.blob) return;
  const ph = $('prevPlaceholder'); if (ph) ph.style.display = 'none';
  $('prevWrap').style.height = prevH + 'px';
  $('prevOrig').src = URL.createObjectURL(e.file);
  $('prevComp').src = URL.createObjectURL(e.blob);
  $('prevComp').className = 'prev-after';
  $('prevLblL').textContent = 'Original · ' + fmtB(e.file.size);
  $('prevLblR').textContent = (e.fmt || gFmt()).toUpperCase() + ' · ' + fmtB(e.outSize);
  const saved = Math.round((e.file.size - e.outSize) / e.file.size * 100);
  $('prevFooter').textContent = fmtB(e.file.size) + ' → ' + fmtB(e.outSize) + '  ·  ' + saved + '% saved';
  setSlider(50);
  setTimeout(() => $('prevCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function setSlider(pct) {
  $('prevComp').style.clipPath = 'inset(0 0 0 ' + pct + '%)';
  $('prevLine').style.left = pct + '%';
  $('prevKnob').style.left = pct + '%';
}

let dragging = false;
$('prevWrap').addEventListener('mousedown', e => { dragging = true; movePrev(e.clientX); });
$('prevWrap').addEventListener('touchstart', e => { dragging = true; movePrev(e.touches[0].clientX); }, { passive: true });
window.addEventListener('mousemove', e => { if (dragging) movePrev(e.clientX); });
window.addEventListener('touchmove', e => { if (dragging) movePrev(e.touches[0].clientX); }, { passive: true });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('touchend', () => dragging = false);

function movePrev(x) {
  const r = $('prevWrap').getBoundingClientRect();
  setSlider(Math.max(2, Math.min(98, ((x - r.left) / r.width) * 100)));
}

$('btnPrevSm').addEventListener('click', () => {
  const idx = prevSteps.indexOf(prevH);
  if (idx > 0) { prevH = prevSteps[idx - 1]; $('prevWrap').style.height = prevH + 'px'; }
});
$('btnPrevLg').addEventListener('click', () => {
  const idx = prevSteps.indexOf(prevH);
  if (idx < prevSteps.length - 1) { prevH = prevSteps[idx + 1]; $('prevWrap').style.height = prevH + 'px'; }
});

// ── UI State ──

function convertLabel() {
  return '<span class="mi">bolt</span> ' + (state.files.length === 1 ? 'Convert It' : 'Convert All');
}

function updateUI() {
  const any = state.files.length > 0;
  const allDone = any && state.files.every(e => e.status === 'done');
  const btn = $('btnConvert');
  btn.disabled = !any || allDone;
  btn.innerHTML = convertLabel();
  $('btnClear').disabled = !any;
  updateStats();
}

function updateStats() {
  const n = state.files.length;
  const orig = state.files.reduce((s, e) => s + e.file.size, 0);
  const out = state.files.reduce((s, e) => s + (e.outSize || 0), 0);
  const done = state.files.some(e => e.status === 'done');
  const allDone = n > 0 && state.files.every(e => e.status === 'done' || e.status === 'error');
  $('stFiles').textContent = n;
  const qb = $('queueBadge'); if (qb) qb.textContent = n || '';
  $('stOrig').textContent = fmtB(orig) || '—';
  $('stComp').textContent = done ? fmtB(out) : '—';
  if (done && out > 0) {
    const saved = orig - out; const pct = Math.round(saved / orig * 100);
    $('stSaved').textContent = fmtB(saved) + ' (' + pct + '%)';
  } else { $('stSaved').textContent = '—'; }
  $('btnDlAll').disabled = !allDone || !done;
  $('btnCopyLast').disabled = !state.lastBlob;
}

// ── Compression ──

async function compressEntry(entry) {
  return new Promise(resolve => {
    const f = entry.fmt || gFmt();
    if (!fmtSupport[f]) {
      entry.status = 'error';
      log(f.toUpperCase() + ' encoding not supported in this browser: ' + entry.file.name, 'err');
      resolve();
      return;
    }
    const url = URL.createObjectURL(entry.file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      const mw = entry.maxw || gMaxw();
      if (mw && w > mw) { h = Math.round(h * mw / w); w = mw; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const q = f === 'png' ? undefined : entry.quality / 100 || gQ();
      canvas.toBlob(blob => {
        if (!blob) { entry.status = 'error'; log('Error: ' + entry.file.name, 'err'); resolve(); return; }
        entry.blob = blob; entry.outSize = blob.size; entry.status = 'done';
        state.lastBlob = blob;
        const oname = baseName(entry.outName || entry.file.name) + '.' + extOf(f);
        entry.resolvedName = oname;
        const diff = entry.file.size - blob.size;
        const pct = Math.abs(Math.round(diff / entry.file.size * 100));
        const sign = diff >= 0 ? '−' : '+';
        log(baseName(entry.file.name) + ' · ' + fmtB(entry.file.size) + ' → ' + fmtB(blob.size) + ' (' + sign + pct + '%)', 'ok');
        resolve();
      }, mimeOf(f), q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); entry.status = 'error'; log('Could not load: ' + entry.file.name, 'err'); resolve(); };
    img.src = url;
  });
}

// ── Action Buttons ──

// Convert up to a few images at once (instead of strictly one-by-one).
const CONVERT_CONCURRENCY = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let converting = false;

$('btnConvert').addEventListener('click', async () => {
  if (converting) return;
  const btn = $('btnConvert');
  const todo = state.files.filter(e => e.status === 'pending' || e.status === 'error');
  if (!todo.length) { updateUI(); return; }

  converting = true;
  btn.disabled = true;
  $('stStatus').style.color = 'var(--secondary)';
  const total = todo.length;
  let finished = 0;
  let next = 0;
  let autoPreviewDone = false;

  // Real batch progress: finished / total, on the button and the status line.
  function setProgress() {
    btn.innerHTML = '<span class="mi" style="animation:spin 0.8s linear infinite">sync</span> ' + finished + '/' + total;
    $('stStatus').textContent = 'Converting ' + finished + '/' + total;
  }
  setProgress();

  async function worker() {
    while (next < todo.length) {
      const entry = todo[next++];
      entry.status = 'converting';
      rebuildTable();
      await compressEntry(entry);
      finished++;
      setProgress();
      rebuildTable(); updateStats();
      if (!autoPreviewDone && entry.status === 'done') {
        openPreview(entry.id);
        autoPreviewDone = true;
      }
    }
  }

  const lanes = Math.min(CONVERT_CONCURRENCY, todo.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  converting = false;
  const anyErr = state.files.some(e => e.status === 'error');
  $('stStatus').textContent = anyErr ? 'Done — some files failed' : 'Done';
  $('stStatus').style.color = 'var(--tertiary)';
  updateUI(); updateStats();
});

$('btnRemSel').addEventListener('click', () => {
  if (!state.selId) return;
  const e = state.files.find(x => x.id === state.selId);
  if (e) log('Removed: ' + e.file.name);
  state.files = state.files.filter(x => x.id !== state.selId);
  state.selId = null; $('btnRemSel').disabled = true;
  rebuildTable(); updateUI();
});

$('btnClear').addEventListener('click', () => {
  if (converting) { log('Wait for the conversion to finish first', 'err'); return; }
  state.files = []; state.selId = null; state.lastBlob = null;
  rebuildTable(); updateUI();
  $('prevOrig').src = ''; $('prevComp').src = '';
  const ph = $('prevPlaceholder'); if (ph) ph.style.display = 'flex';
  $('stStatus').textContent = 'Ready'; $('stStatus').style.color = 'var(--tertiary)';
  log('Cleared', 'info');
});

$('btnDlAll').addEventListener('click', async () => {
  const btn = $('btnDlAll'); btn.disabled = true; btn.innerHTML = '<span class="mi">sync</span> Zipping…';
  log('Building ZIP…', 'info');
  const zip = new JSZip();
  for (const entry of state.files) {
    if (entry.blob) {
      const ab = await entry.blob.arrayBuffer();
      zip.file(entry.resolvedName || baseName(entry.file.name) + '.' + extOf(entry.fmt || gFmt()), ab);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'compressed.zip';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  log('ZIP downloaded · ' + fmtB(blob.size), 'ok');
  btn.innerHTML = '<span class="mi">download</span> Download ZIP'; btn.disabled = false; updateStats();
});

$('btnCopyLast').addEventListener('click', async () => {
  if (!state.lastBlob) return;
  try {
    let b = state.lastBlob;
    if (b.type !== 'image/png') {
      const bmp = await createImageBitmap(b);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      b = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    log('Copied to clipboard', 'ok');
    const btn = $('btnCopyLast'); const orig = btn.innerHTML;
    btn.innerHTML = '<span class="mi" style="font-size:16px">check</span> Copied!'; setTimeout(() => btn.innerHTML = orig, 1800);
  } catch (e) { log('Clipboard failed — use Chrome or Edge', 'err'); }
});

// ── Alt Text ──

let altEntryId = null;
let altBusy = false;

const altToast = document.createElement('div');
altToast.className = 'alt-toast';
altToast.textContent = 'Copied!';
document.body.appendChild(altToast);

function showAltToast(msg) {
  altToast.textContent = msg || 'Copied!';
  altToast.classList.add('show');
  setTimeout(() => altToast.classList.remove('show'), 1400);
}

function copyAlt(id) {
  const el = $(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => showAltToast('Copied!'));
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function resizeForAlt(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function genAlt(id) {
  if (altBusy) return;
  const e = state.files.find(x => x.id === id);
  if (!e) return;
  altEntryId = id;
  altBusy = true;

  const btn = $('altBtn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mi" style="font-size:16px;animation:spin 0.8s linear infinite">sync</span>'; }

  $('altCard').style.display = 'block';
  $('altLoading').style.display = 'flex';
  $('altResults').style.display = 'none';
  $('altFileName').textContent = e.file.name;
  setTimeout(() => $('altCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  try {
    const resized = await resizeForAlt(e.file);
    if (!resized) throw new Error('Could not read image');

    const res = await fetch('/api/generate-alt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: resized.base64, mediaType: resized.mediaType, altStyle: $('altStyle').value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Something went wrong.' }));
      throw new Error(err.error || 'Something went wrong');
    }
    const data = await res.json();
    showAltResult(data);
    log('Alt text generated for ' + e.file.name, 'ok');
  } catch (err) {
    $('altLoading').style.display = 'none';
    $('altResults').style.display = 'block';
    $('altResults').innerHTML = `<div class="alt-error">${escHtml(err.message)}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="btn btn-secondary btn-sm" onclick="genAlt(${id})"><span class="mi" style="font-size:14px">refresh</span> Retry</button>
      </div>`;
    log('Alt text error: ' + err.message, 'err');
  } finally {
    altBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Alt'; }
  }
}

function showAltResult(data) {
  $('altLoading').style.display = 'none';
  $('altResults').style.display = 'block';

  const alt = data.alt || '';
  const title = data.title || '';
  const chars = alt.length;
  const charColor = chars > 125 ? 'var(--secondary)' : 'var(--tertiary)';

  $('altResults').innerHTML = `
    <div class="alt-field">
      <div class="alt-field-top">
        <span class="alt-label">Alt Text</span>
        <button class="btn btn-secondary btn-sm" onclick="copyAlt('altVal')"><span class="mi" style="font-size:14px">content_copy</span> Copy</button>
      </div>
      <div class="alt-val" id="altVal">${escHtml(alt)}</div>
      <div class="alt-chars"><span style="color:${charColor}">${chars} chars</span> · under 125 recommended</div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
      <button class="btn btn-secondary btn-sm" onclick="genAlt(${altEntryId})"><span class="mi" style="font-size:14px">refresh</span> Regenerate</button>
    </div>`;
}

$('btnCloseAlt').addEventListener('click', () => {
  $('altCard').style.display = 'none';
});

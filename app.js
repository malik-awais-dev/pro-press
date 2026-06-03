const state = { files: [], nextId: 0, lastBlob: null, selId: null, editing: false, shownRenameTip: false };
const $ = id => document.getElementById(id);
const fmtB = b => !b ? '0 B' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const extOf = f => ({ webp: 'webp', avif: 'avif', jpeg: 'jpg', png: 'png' }[f]);
const mimeOf = f => ({ webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }[f]);
const baseName = n => n.replace(/\.[^.]+$/, '');
const gFmt = () => $('gFmt').value;
const gQ = () => parseInt($('gQ').value) / 100;
const gMaxw = () => parseInt($('gMaxw').value) || 0;

const qMap = [[10, 'Very low — heavy artifacts'], [20, 'Low — visible loss'], [30, 'Low'], [40, 'Fair'], [50, 'Moderate'], [60, 'Moderate'], [70, 'Good'], [80, 'Good — recommended'], [90, 'Excellent'], [95, 'Near lossless'], [100, 'Maximum quality']];
function qLabel(v) { let r = qMap[0][1]; for (const [k, l] of qMap) if (v >= k) r = l; return r; }

// ── Quality & Format Controls ──

$('gQ').addEventListener('input', () => {
  const v = parseInt($('gQ').value);
  $('gQout').textContent = v + '%';
  $('qHint').textContent = qLabel(v);
});

$('gFmt').addEventListener('change', () => {
  const p = gFmt() === 'png';
  $('gQ').disabled = p;
  $('gQout').style.opacity = p ? .3 : 1;
  $('qHint').textContent = p ? 'Lossless — quality setting ignored' : qLabel(parseInt($('gQ').value));
});

// ── Logging ──

function log(msg, type = '') {
  const box = $('logBox');
  const d = document.createElement('div'); d.className = 'log-line';
  const t = new Date().toTimeString().slice(0, 8);
  d.innerHTML = `<span class="log-t">${t}</span><span class="log-m ${type}">${msg}</span>`;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}
$('btnClearLog').addEventListener('click', () => $('logBox').innerHTML = '');

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
    state.files.push({ id, file: f, status: 'pending', blob: null, outSize: 0, outName: null, resolvedName: null, fmt: gFmt(), quality: parseInt($('gQ').value), maxw: gMaxw() });
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
    rebuildTable(); updateUI();
  }
}

function rebuildTable() {
  if (state.editing) return;
  const container = $('fileBody'); container.innerHTML = '';
  if (!state.files.length) {
    container.innerHTML = '<div class="empty-hint">No images yet — drop files or click Browse above</div>';
    return;
  }
  state.files.forEach((e, i) => {
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
    const savedTxt = e.outSize ? (diff >= 0 ? '−' : '+') + pct + '%' : '';
    const savedCls = e.outSize ? (diff >= 0 ? 'saved-pos' : 'saved-neg') : '';
    const ext = extOf(e.fmt || gFmt());
    const dispBase = e.outName || baseName(e.file.name);
    const dispName = dispBase + '.' + ext;
    const bcls = { pending: 'b-p', converting: 'b-c', done: 'b-d', error: 'b-e' }[e.status] || 'b-p';
    const btxt = { pending: 'Pending', converting: 'Working…', done: 'Done', error: 'Error' }[e.status];
    const fbcls = e.status === 'done' ? 'fb-done' : 'fb-pending';

    let thumbContent = '';
    if (e.status === 'converting') {
      thumbContent = `<span class="mi" style="color:var(--outline);font-size:20px">image</span><div class="spinner"><span class="mi">sync</span></div>`;
    } else {
      thumbContent = `<span class="mi" style="color:var(--outline);font-size:20px">image</span>`;
    }

    let metaLine = fmtB(e.file.size);
    if (e.outSize) metaLine += ` → ${outTxt}`;

    let acts = '';
    if (e.status === 'done' && e.blob) {
      acts = `<button class="btn-icon" onclick="event.stopPropagation();dlOne(${e.id})" title="Download"><span class="mi">download</span></button><button class="btn-icon" onclick="event.stopPropagation();openPreview(${e.id})" title="Preview"><span class="mi">visibility</span></button>`;
    }

    card.innerHTML = `
      <div class="file-thumb">${thumbContent}</div>
      <div class="file-info">
        <div class="file-name" title="${e.file.name}">
          <span class="file-name-text" data-id="${e.id}">${dispBase}</span><span style="color:var(--outline);font-weight:400">.${ext}</span>
          <span class="mi edit-hint">edit</span>
        </div>
        <div class="file-meta">
          <span class="mono">${metaLine}</span>
          <span class="format-badge ${fbcls}">${ext.toUpperCase()}</span>
          ${savedTxt ? `<span class="file-saved ${savedCls}">${savedTxt}</span>` : ''}
        </div>
        ${e.status === 'converting' ? '<div class="file-progress"><div class="file-progress-bar" style="width:50%"></div></div>' : ''}
      </div>
      <span class="badge ${bcls}">${btxt}</span>
      <div class="file-actions">${acts}</div>`;

    card.querySelector('.file-name-text').addEventListener('click', ev => {
      ev.stopPropagation();
      startInlineRename(e.id, card);
    });

    container.appendChild(card);
  });
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
}

// ── Preview ──

let prevH = 280;
const prevSteps = [160, 280, 380, 480, 580];

function openPreview(id) {
  const e = state.files.find(x => x.id === id); if (!e || !e.blob) return;
  $('prevCard').style.display = 'block';
  $('prevWrap').style.height = prevH + 'px';
  $('prevOrig').src = URL.createObjectURL(e.file);
  $('prevComp').src = URL.createObjectURL(e.blob);
  $('prevComp').className = 'prev-after';
  $('prevLblL').textContent = 'Before · ' + fmtB(e.file.size);
  $('prevLblR').textContent = 'After · ' + fmtB(e.outSize);
  $('prevFooter').textContent = 'Before: ' + fmtB(e.file.size) + '  →  After: ' + fmtB(e.outSize) + '  ·  Drag the line to compare';
  setSlider(50);
  setTimeout(() => $('prevCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
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
  setSlider(Math.max(5, Math.min(95, ((x - r.left) / r.width) * 100)));
}

$('btnPrevSm').addEventListener('click', () => {
  const idx = prevSteps.indexOf(prevH);
  if (idx > 0) { prevH = prevSteps[idx - 1]; $('prevWrap').style.height = prevH + 'px'; }
});
$('btnPrevLg').addEventListener('click', () => {
  const idx = prevSteps.indexOf(prevH);
  if (idx < prevSteps.length - 1) { prevH = prevSteps[idx + 1]; $('prevWrap').style.height = prevH + 'px'; }
});
$('btnClosePreview').addEventListener('click', () => {
  $('prevCard').style.display = 'none';
  $('prevOrig').src = ''; $('prevComp').src = '';
});

// ── UI State ──

function convertLabel() {
  return '<span class="mi">bolt</span> ' + (state.files.length === 1 ? 'Convert It' : 'Convert All');
}

function updateUI() {
  const any = state.files.length > 0;
  const btn = $('btnConvert');
  btn.disabled = !any;
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
      const f = entry.fmt || gFmt();
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

$('btnConvert').addEventListener('click', async () => {
  const btn = $('btnConvert');
  btn.disabled = true; btn.innerHTML = '<span class="mi">sync</span> Working…';
  $('stStatus').textContent = 'Converting'; $('stStatus').style.color = 'var(--secondary)';
  log('Starting — ' + state.files.filter(e => e.status !== 'done').length + ' file(s)', 'info');
  for (const entry of state.files) {
    if (entry.status === 'done') continue;
    entry.status = 'converting'; rebuildTable();
    await compressEntry(entry);
    rebuildTable(); updateStats();
  }
  log('All done — click Preview on any row to compare', 'info');
  btn.innerHTML = convertLabel(); btn.disabled = false;
  $('stStatus').textContent = 'Done'; $('stStatus').style.color = 'var(--tertiary)';
  updateStats();
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
  state.files = []; state.selId = null; state.lastBlob = null;
  rebuildTable(); updateUI();
  $('prevCard').style.display = 'none';
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


// ── Init ──
log('Ready — drop images above to get started', 'info');

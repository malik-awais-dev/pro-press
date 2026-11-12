const state = { files: [], nextId: 0, lastBlob: null, selId: null, editing: false };
const $ = id => document.getElementById(id);
const fmtB = b => !b ? '0 B' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const extOf = f => ({ webp: 'webp', avif: 'avif', jpeg: 'jpg', png: 'png' }[f]);
const mimeOf = f => ({ webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }[f]);
const baseName = n => n.replace(/\.[^.]+$/, '');
const gFmt = () => $('gFmt').value;
const gQ = () => parseInt($('gQ').value) / 100;
// Max output width: 0 = keep original dimensions, otherwise scale images
// wider than this down (e.g. a 3300px photo → 800px web-ready image).
const gMaxw = () => parseInt($('gMaxw').value) || 0;

const qMap = [[10, 'Very low — heavy artifacts'], [20, 'Low — visible loss'], [30, 'Low'], [40, 'Fair'], [50, 'Moderate'], [60, 'Moderate'], [70, 'Good'], [80, 'Good — recommended'], [90, 'Excellent'], [95, 'Near lossless'], [100, 'Maximum quality']];
function qLabel(v) { let r = qMap[0][1]; for (const [k, l] of qMap) if (v >= k) r = l; return r; }

// ── Lazy JSZip loader ──
// The ZIP library (~100 KB) is NOT loaded on page load anymore — it only
// downloads the first time a visitor actually builds a ZIP. Single-file
// downloads and everything else need no extra library at all.
let jsZipPromise = null;
function ensureJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jsZipPromise) {
    jsZipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.2/jszip.min.js';
      s.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('ZIP library unavailable'));
      s.onerror = () => { jsZipPromise = null; reject(new Error('Could not download the ZIP library')); };
      document.head.appendChild(s);
    });
  }
  return jsZipPromise;
}

// ── Notifications ──
// Owner decision: NO user-facing toasts at all. The queue rows themselves
// (spinner → size result → green % badge), the status line in the Queue
// card, and the download button's ready-pulse already tell the user
// everything they need — toasts just repeated the UI and cluttered phones.
// log() stays as a developer-console trace so failures are still
// diagnosable in DevTools, but nothing renders from here.
// The ONE on-screen error channel left: when files are rejected outright
// (not an image, or over 50 MB), the queue status line says so in red —
// otherwise a dropped file would vanish with no explanation at all.
function log(msg, type) {
  if (type === 'err') console.error('[pro-press]', msg);
  else console.log('[pro-press]', msg);
}

function showStatusError(msg) {
  $('stStatus').textContent = msg;
  $('stStatus').style.color = 'var(--error, #DC2626)';
}

// ── Filename slug from alt text (for auto-rename) ──

function slugify(text, maxWords) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, maxWords || 6)
    .join('-')
    .slice(0, 60);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Alt-text metadata embedding (best-effort; many tools read it, WordPress does not
//    auto-fill its own Alt field from it — Copy button remains the reliable WP path) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function embedAltPNG(bytes, alt) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return bytes;
  let pos = 8, insertAt = -1;
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (type === 'IEND') { insertAt = pos; break; }
    pos += 12 + len;
  }
  if (insertAt < 0) return bytes;
  const enc = new TextEncoder();
  const textBytes = enc.encode('Description\0' + alt);
  const chunk = new Uint8Array(12 + textBytes.length);
  const cdv = new DataView(chunk.buffer);
  cdv.setUint32(0, textBytes.length);
  chunk.set(enc.encode('tEXt'), 4);
  chunk.set(textBytes, 12);
  cdv.setUint32(8 + textBytes.length, crc32(chunk.subarray(4, 8 + textBytes.length)));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt));
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return out;
}

function embedAltJPEG(bytes, alt) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes;
  const enc = new TextEncoder();
  const xmp = enc.encode(
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">' + escapeXml(alt) + '</rdf:li></rdf:Alt></dc:description>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>');
  const ns = enc.encode('http://ns.adobe.com/xap/1.0/\0');
  const segDataLen = ns.length + xmp.length;
  const seg = new Uint8Array(4 + segDataLen);
  const sdv = new DataView(seg.buffer);
  sdv.setUint16(0, 0xFFE1);
  sdv.setUint16(2, segDataLen + 2);
  seg.set(ns, 4);
  seg.set(xmp, 4 + ns.length);
  let at = 2;
  if (bytes.length > 4 && bytes[2] === 0xFF && bytes[3] === 0xE0) {
    const l = (bytes[4] << 8) | bytes[5];
    at = 2 + 2 + l;
  }
  const out = new Uint8Array(bytes.length + seg.length);
  out.set(bytes.subarray(0, at));
  out.set(seg, at);
  out.set(bytes.subarray(at), at + seg.length);
  return out;
}

async function blobWithAlt(blob, entry) {
  if (!entry || !entry.altText) return blob;
  const f = entry.fmt || gFmt();
  if (f !== 'png' && f !== 'jpeg') return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const out = f === 'png' ? embedAltPNG(bytes, entry.altText) : embedAltJPEG(bytes, entry.altText);
    return new Blob([out], { type: mimeOf(f) });
  } catch (err) {
    console.error('Alt embed failed:', err);
    return blob;
  }
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

$('gMaxw').addEventListener('change', applySettingsToPending);

// QA: sync the hint with the slider's actual default on first load, so the page
// never starts with a hint that disagrees with the 80% default position.
$('qHint').textContent = qLabel(parseInt($('gQ').value));

// Settings live-apply to EVERYTHING — including files that were already
// converted. If a done file's format/quality/resize no longer matches the
// current settings, it goes back to pending and re-converts automatically.
// That is the whole promise: "all formats work, even after conversion".
function applySettingsToPending() {
  if (state.editing) return;
  const fmt = gFmt();
  const q = parseInt($('gQ').value);
  const mw = gMaxw();
  let changed = false;
  let needReconvert = false;
  state.files.forEach(e => {
    if (e.status === 'pending' || e.status === 'error') {
      if (e.fmt !== fmt) { e.fmt = fmt; changed = true; }
      if (e.quality !== q) { e.quality = q; changed = true; }
      if ((e.maxw || 0) !== mw) { e.maxw = mw; changed = true; }
    } else if (e.status === 'done') {
      if (e.fmt !== fmt || e.quality !== q || (e.maxw || 0) !== mw) {
        e.fmt = fmt; e.quality = q; e.maxw = mw;
        e.status = 'pending';
        changed = true;
        needReconvert = true;
      }
    }
  });
  if (changed) rebuildTable();
  if (needReconvert) autoConvert();
}

// ── Encode support detection ──

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

// ── Attention pulses ──

function pulseDownloadBtn() {
  ['btnDlAll', 'btnDlQueue'].forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.classList.remove('dl-ready');
    void btn.offsetWidth;
    btn.classList.add('dl-ready');
  });
}

// ── Alt spotlight ──
// The moment images land in the queue, their Alt buttons light up: a soft
// rotating gradient ring plus a gently pulsing icon, for about 8 seconds.
// Enough for a new user to feel "there is something here to try", without
// shouting. It stops for a row the instant that row's Alt button is tapped,
// and never shows on a row that already has alt text.
let altSpotlightTimer = null;
function spotlightAltButtons() {
  state.files.forEach(e => { if (!e.altText) e.altSpotlight = true; });
  rebuildTable();
  clearTimeout(altSpotlightTimer);
  altSpotlightTimer = setTimeout(() => {
    state.files.forEach(e => { e.altSpotlight = false; });
    rebuildTable();
  }, 8000);
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
    log('Added ' + added + ' file(s)' + (skip ? ' · ' + skip + ' skipped' : ''));
    rebuildTable(); updateUI();
    spotlightAltButtons();
    autoConvert();
  } else {
    // Nothing made it in. With toasts gone this MUST still be visible —
    // otherwise a rejected file disappears with zero explanation. The
    // queue status line (right under the file list) carries the reason.
    if (skip) showStatusError(skip + ' not added — image over 50 MB or unsupported type');
    rebuildTable(); updateUI();
  }
}

// Alt button markup: a proper labelled pill with an icon, not a cryptic "Alt" square.
function altBtnHtml(entry) {
  const done = !!(entry && entry.altText);
  return '<span class="mi" style="font-size:14px">' + (done ? 'check' : 'auto_awesome') + '</span> Alt';
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
    else if (e.status === 'done' && e.outSize) {
      const dimTxt = (e.outW && e.wasResized) ? e.wasResized : '';
      metaLine = fmtB(e.file.size) + ' → ' + outTxt + ' · ' + ext.toUpperCase() + (dimTxt ? ' · ' + dimTxt : '');
    }
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
      const altCls = 'alt-pill' + (e.altText ? ' alt-done' : '') + (!e.altText && e.altSpotlight ? ' alt-spotlight' : '');
      acts += `<button class="${altCls}" id="altBtn-${e.id}" onclick="event.stopPropagation();genAlt(${e.id})" title="Write alt text with AI">${altBtnHtml(e)}</button>`;
    }
    acts += `<button class="btn-icon danger" onclick="event.stopPropagation();removeOne(${e.id})" title="Remove"><span class="mi">close</span></button>`;

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
  extSpan.style.cssText = 'color:var(--text-muted);font-weight:400;font-size:14px;flex-shrink:0';
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
      entry.autoNamed = false; // manual rename wins over auto-alt-rename from now on
      if (entry.resolvedName) entry.resolvedName = val + '.' + ext;
      log('Renamed → ' + val + '.' + ext);
    } else if (!val) {
      entry.outName = null;
      entry.autoNamed = false;
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

async function dlOne(id) {
  const e = state.files.find(x => x.id === id);
  if (!e || !e.blob) return;
  const out = await blobWithAlt(e.blob, e);
  const name = e.resolvedName || baseName(e.file.name) + '.' + extOf(e.fmt || gFmt());
  const url = URL.createObjectURL(out);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  log('Downloaded: ' + name);
}

// ── Preview ──

let prevH = 320;
const prevSteps = [200, 320, 440, 560];
// QA: preview object URLs are tracked so each new preview revokes the previous
// pair — repeated eye-icon clicks no longer leak two blobs per click.
let prevUrls = [];

// True desktop = two-column layout (981px+). A phone in landscape is ~850px
// wide, which is NOT desktop even though it passes a naive innerWidth > 760
// check — that check auto-opened the preview on landscape phones even though
// the CSS hides the card on every small screen. Match the CSS breakpoint
// exactly so JS and CSS agree on what "desktop" means.
const isDesktopLayout = () => window.matchMedia('(min-width: 981px)').matches;

function openPreview(id) {
  const e = state.files.find(x => x.id === id); if (!e || !e.blob) return;
  // On mobile the preview card is hidden by default (CSS); reveal it on demand.
  $('prevCard').classList.add('mobile-show');
  const ph = $('prevPlaceholder'); if (ph) ph.style.display = 'none';
  $('prevWrap').style.height = prevH + 'px';
  prevUrls.forEach(u => URL.revokeObjectURL(u));
  prevUrls = [URL.createObjectURL(e.file), URL.createObjectURL(e.blob)];
  $('prevOrig').src = prevUrls[0];
  $('prevComp').src = prevUrls[1];
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

function downloadLabel(doneCount) {
  const txt = doneCount === 1 ? 'Download image' : 'Download ZIP';
  return '<span class="mi" style="font-size:16px">download</span> ' + txt;
}

function updateUI() {
  const any = state.files.length > 0;
  $('btnClear').disabled = !any;
  updateStats();
}

function updateStats() {
  const n = state.files.length;
  const orig = state.files.reduce((s, e) => s + e.file.size, 0);
  const out = state.files.reduce((s, e) => s + (e.outSize || 0), 0);
  const done = state.files.some(e => e.status === 'done');
  const allDone = n > 0 && state.files.every(e => e.status === 'done' || e.status === 'error');
  const doneCount = state.files.filter(e => e.status === 'done').length;
  $('stFiles').textContent = n;
  const qb = $('queueBadge'); if (qb) qb.textContent = n || '';
  $('stOrig').textContent = fmtB(orig) || '—';
  $('stComp').textContent = done ? fmtB(out) : '—';
  if (done && out > 0) {
    const saved = orig - out; const pct = Math.round(saved / orig * 100);
    $('stSaved').textContent = fmtB(saved) + ' (' + pct + '%)';
  } else { $('stSaved').textContent = '—'; }
  // Both download buttons (queue on desktop, pinned bar on mobile) stay in sync.
  ['btnDlAll', 'btnDlQueue'].forEach(id => {
    const dl = $(id);
    if (!dl) return;
    dl.disabled = !allDone || !done;
    dl.innerHTML = downloadLabel(dl.disabled ? 0 : doneCount);
  });
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
      const origW = w;
      const mw = entry.maxw || gMaxw();
      if (mw && w > mw) { h = Math.round(h * mw / w); w = mw; }
      entry.wasResized = (mw && origW > mw) ? (origW + '→' + w + 'px') : null;
      entry.outW = w;
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
        log(baseName(entry.file.name) + ' · ' + fmtB(entry.file.size) + ' → ' + fmtB(blob.size) + (entry.wasResized ? ' · resized ' + entry.wasResized : ''));
        resolve();
      }, mimeOf(f), q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); entry.status = 'error'; log('Could not load: ' + entry.file.name, 'err'); resolve(); };
    img.src = url;
  });
}

// ── Auto-conversion engine ──
// There is no Convert button anymore. Files convert themselves the moment
// they land in the queue (WebP 80% by default), and any settings change
// re-converts finished files automatically. If files are added or reset
// while a run is already going, the tail check at the end of the run picks
// them up — nothing is ever left sitting in "waiting".

const CONVERT_CONCURRENCY = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let converting = false;

function autoConvert() {
  if (!state.files.some(e => e.status === 'pending')) return;
  runConversion();
}

async function runConversion() {
  if (converting) return;
  const todo = state.files.filter(e => e.status === 'pending' || e.status === 'error');
  if (!todo.length) { updateUI(); return; }

  converting = true;
  $('stStatus').style.color = 'var(--secondary)';
  const total = todo.length;
  let finished = 0;
  let next = 0;
  let autoPreviewDone = false;

  function setProgress() {
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
      // Auto-open the preview ONLY on the true desktop layout. On phones and
      // tablets the card stays hidden until the user taps the eye icon —
      // isDesktopLayout() matches the CSS breakpoint exactly, so a phone in
      // landscape (~850px) no longer slips through a naive width check.
      if (!autoPreviewDone && entry.status === 'done' && isDesktopLayout()) {
        openPreview(entry.id);
        autoPreviewDone = true;
      }
    }
  }

  const lanes = Math.min(CONVERT_CONCURRENCY, todo.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  converting = false;
  const anyErr = state.files.some(e => e.status === 'error');
  const okCount = state.files.filter(e => e.status === 'done').length;
  $('stStatus').textContent = anyErr ? 'Done — some files failed' : 'Done';
  $('stStatus').style.color = 'var(--tertiary)';
  updateUI(); updateStats();
  // The download button's green ready-pulse is the only "it worked" signal
  // a user needs — no toast, no popup.
  if (okCount) pulseDownloadBtn();
  // Files added (or re-queued by a settings change) while we were busy:
  // convert them right away instead of leaving them "waiting".
  if (state.files.some(e => e.status === 'pending')) runConversion();
}

$('btnRemSel').addEventListener('click', () => {
  if (!state.selId) return;
  const e = state.files.find(x => x.id === state.selId);
  if (e) { if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl); log('Removed: ' + e.file.name); }
  state.files = state.files.filter(x => x.id !== state.selId);
  state.selId = null; $('btnRemSel').disabled = true;
  rebuildTable(); updateUI();
});

$('btnClear').addEventListener('click', () => {
  if (converting) { log('Wait for the conversion to finish first', 'err'); return; }
  state.files.forEach(e => { if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl); });
  prevUrls.forEach(u => URL.revokeObjectURL(u)); prevUrls = [];
  state.files = []; state.selId = null; state.lastBlob = null;
  rebuildTable(); updateUI();
  $('prevOrig').removeAttribute('src'); $('prevComp').removeAttribute('src');
  $('prevCard').classList.remove('mobile-show');
  const ph = $('prevPlaceholder'); if (ph) ph.style.display = 'flex';
  $('stStatus').textContent = 'Ready'; $('stStatus').style.color = 'var(--tertiary)';
  log('Cleared');
});

// ── Download All (works from BOTH buttons: queue on desktop, pinned bar on mobile) ──

async function downloadAll() {
  const doneFiles = state.files.filter(e => e.status === 'done' && e.blob);
  if (!doneFiles.length) return;
  const bars = ['btnDlAll', 'btnDlQueue'].map($).filter(Boolean);

  if (doneFiles.length === 1) {
    bars.forEach(b => { b.disabled = true; b.innerHTML = '<span class="mi">sync</span> Saving…'; });
    await dlOne(doneFiles[0].id);
    bars.forEach(b => { b.disabled = false; });
    updateStats();
    return;
  }

  bars.forEach(b => { b.disabled = true; b.innerHTML = '<span class="mi">sync</span> Zipping…'; });
  log('Building ZIP…');
  let JSZip;
  try {
    JSZip = await ensureJSZip();
  } catch (e) {
    bars.forEach(b => { b.disabled = false; });
    updateStats();
    log('Could not load the ZIP library — check your connection and try again', 'err');
    return;
  }
  const zip = new JSZip();
  for (const entry of doneFiles) {
    const ab = await (await blobWithAlt(entry.blob, entry)).arrayBuffer();
    zip.file(entry.resolvedName || baseName(entry.file.name) + '.' + extOf(entry.fmt || gFmt()), ab);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'compressed.zip';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  log('ZIP downloaded · ' + fmtB(blob.size));
  bars.forEach(b => { b.disabled = false; });
  updateStats();
}

$('btnDlAll').addEventListener('click', downloadAll);
$('btnDlQueue').addEventListener('click', downloadAll);

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
    log('Copied to clipboard');
    const btn = $('btnCopyLast'); const orig = btn.innerHTML;
    btn.innerHTML = '<span class="mi" style="font-size:16px">check</span> Copied!'; setTimeout(() => btn.innerHTML = orig, 1800);
  } catch (e) { log('Clipboard failed — use Chrome or Edge', 'err'); }
});

// ── Alt Text ──

let altEntryId = null;
let altBusy = false;

const altBackdrop = document.createElement('div');
altBackdrop.id = 'altBackdrop';
document.body.appendChild(altBackdrop);

function openAltPanel() {
  $('altCard').style.display = 'block';
  altBackdrop.style.display = 'block';
}

function closeAltPanel() {
  $('altCard').style.display = 'none';
  altBackdrop.style.display = 'none';
}

altBackdrop.addEventListener('click', closeAltPanel);

// The only remaining on-screen confirmation: a tiny "Copied!" bubble when the
// user copies alt text. Clipboard writes give no feedback of their own, so
// without this a tap on Copy would feel completely dead.
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

function applyAltToEntry(entry, alt) {
  entry.altText = alt;
  entry.altSpotlight = false; // has alt now — never draw attention again
  if (!entry.outName || entry.autoNamed) {
    entry.autoNamed = true;
    const ext = extOf(entry.fmt || gFmt());
    const newName = slugify(alt, 6);
    if (newName && newName !== entry.outName) {
      entry.outName = newName;
      if (entry.resolvedName) entry.resolvedName = newName + '.' + ext;
      log('Renamed to match alt text: ' + newName + '.' + ext);
      rebuildTable();
    }
  }
}

async function genAlt(id) {
  if (altBusy) return;
  const e = state.files.find(x => x.id === id);
  if (!e) return;
  altEntryId = id;
  altBusy = true;
  e.altSpotlight = false; // the user engaged with this row — stop the spotlight

  const btn = $('altBtn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mi" style="font-size:14px;animation:spin 0.8s linear infinite">sync</span> Alt'; }

  openAltPanel();
  $('altLoading').style.display = 'flex';
  $('altResults').style.display = 'none';
  $('altFileName').textContent = e.file.name;

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
    applyAltToEntry(e, data.alt || '');
    log('Alt text ready');
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
    rebuildTable(); // restores correct Alt button state (icon + done check)
  }
}

function showAltResult(data) {
  $('altLoading').style.display = 'none';
  $('altResults').style.display = 'block';

  const alt = data.alt || '';
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

$('btnCloseAlt').addEventListener('click', closeAltPanel);

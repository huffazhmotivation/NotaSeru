/* =========================================================
   NOTASERU — MODE KASIR (offline, IndexedDB)
   Data: notaseru-kasir -> products | sales | meta
   Foto produk: dikompres otomatis ke WebP (persegi, maks 600px)
   ========================================================= */
(function () {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp\u00a0' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = v => Number(String(v == null ? '' : v).replace(/\D/g, '')) || 0;
const fmtNum = n => n ? Math.round(n).toLocaleString('id-ID') : '';
const uid = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const MODE_KEY = 'ns3_appMode', CART_KEY = 'ns3_ksrCart';

const IC = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  swap: '<path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
};
const ic = (n, s = 20, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

/* ---------- state ---------- */
const S = { prods: [], sales: [], cfg: { tax: 0, name: '', addr: '', kasir: '', foot: 'Terima kasih atas kunjungan Anda' },
  cart: {}, disc: { t: 'rp', v: 0 }, pay: 'tunai', cash: 0, note: '',
  cat: 'all', q: '', pq: '', tab: 'jual', range: 'today', ready: false, dbOk: true };
let readyRes; const ready = new Promise(r => readyRes = r);

/* ---------- IndexedDB ---------- */
let _db;
function idb() {
  return _db || (_db = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('notaseru-kasir', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('products', { keyPath: 'id' }); d.createObjectStore('sales', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
function dbRun(store, fn) {
  return idb().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, 'readwrite'); fn(t.objectStore(store));
    t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const dbAll = st => idb().then(d => new Promise((res, rej) => { const r = d.transaction(st).objectStore(st).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }));
function persist(p) { return p.catch(e => { console.error('[kasir]', e); toastK('Gagal menyimpan ke perangkat', 'err'); }); }
const saveProd = p => persist(dbRun('products', s => s.put(p)));
const saveSale = x => persist(dbRun('sales', s => s.put(x)));
const saveCfg = () => persist(dbRun('meta', s => s.put({ k: 'cfg', v: S.cfg })));

async function load() {
  try {
    S.prods = (await dbAll('products')).sort((a, b) => (a.at || 0) - (b.at || 0));
    S.sales = (await dbAll('sales')).sort((a, b) => b.t - a.t);
    const m = (await dbAll('meta')).find(x => x.k === 'cfg'); if (m) Object.assign(S.cfg, m.v);
  } catch (e) { S.dbOk = false; console.error('[kasir] db', e); }
  try { const c = JSON.parse(localStorage.getItem(CART_KEY) || '{}'); Object.keys(c).forEach(id => { if (prod(id) && c[id] > 0) S.cart[id] = c[id]; }); } catch (e) {}
  S.ready = true; readyRes();
}
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(S.cart)); } catch (e) {} };

/* ---------- util ---------- */
const prod = id => S.prods.find(p => p.id === id);
const cats = () => { const o = []; S.prods.forEach(p => { const c = p.cat || 'Lainnya'; if (!o.includes(c)) o.push(c); }); return o; };
const storeName = () => S.cfg.name || (typeof DB !== 'undefined' && (DB.get('settings', {}).storeName)) || 'Toko Saya';
const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();
function toastK(m, type) { const t = document.createElement('div'); t.className = 'ksr-toast' + (type === 'err' ? ' err' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2300); }
const fmtDT = ts => { const d = new Date(ts); return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); };
const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const dayLbl = ts => { const d = new Date(ts), n = new Date(); if (dayKey(ts) === dayKey(n)) return 'Hari ini'; const y = new Date(n); y.setDate(n.getDate() - 1); if (dayKey(ts) === dayKey(y)) return 'Kemarin'; return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }); };
const thumb = p => p.img ? `<img src="${p.img}" alt="" loading="lazy">` : esc(initial(p.name));
const PAYN = { tunai: 'Tunai', qris: 'QRIS', transfer: 'Transfer', debit: 'Debit' };

/* ---------- foto -> WebP (dengan atur posisi & zoom) ---------- */
async function loadBmp(src) {   // src: File atau URL data
  if (typeof src !== 'string') {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch (e) {}
  }
  return new Promise((res, rej) => {
    const isF = typeof src !== 'string', u = isF ? URL.createObjectURL(src) : src, im = new Image();
    im.onload = () => { if (isF) URL.revokeObjectURL(u); res(im); };
    im.onerror = rej; im.src = u;
  });
}
/* Editor crop persegi: geser (drag), cubit / scroll / slider untuk zoom. Hasil: {sx, sy, side} dalam piksel foto asli, atau null bila batal. */
function cropPhoto(bmp) {
  return new Promise(resolve => {
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const Z = Math.max(220, Math.min(innerWidth - 32, innerHeight - 270, 400)), dpr = Math.min(devicePixelRatio || 1, 2);
    const ov = document.createElement('div'); ov.className = 'ksr-crop';
    ov.innerHTML = `<div class="cb"><b>Atur foto</b><small>Geser untuk memindah, cubit / geser slider untuk zoom</small>
      <div class="cs" style="width:${Z}px;height:${Z}px"><canvas width="${Math.round(Z * dpr)}" height="${Math.round(Z * dpr)}" style="width:${Z}px;height:${Z}px"></canvas><i></i></div>
      <input type="range" min="0" max="100" value="0" aria-label="Zoom">
      <div class="ca"><button class="ksr-btn ghost" data-c="x">Batal</button><button class="ksr-btn" data-c="ok">Pakai foto</button></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), cx = cv.getContext('2d'), rg = ov.querySelector('input'), st = ov.querySelector('.cs');
    const MIN = Z / Math.min(w, h), MAX = MIN * 5;
    let sc = MIN, x = (Z - w * sc) / 2, y = (Z - h * sc) / 2;
    const clamp = () => { x = Math.min(0, Math.max(Z - w * sc, x)); y = Math.min(0, Math.max(Z - h * sc, y)); };
    const draw = () => {
      clamp(); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = '#fff'; cx.fillRect(0, 0, Z, Z);
      cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, x, y, w * sc, h * sc);
      rg.value = Math.round((sc / MIN - 1) / 4 * 100);
    };
    const zoomAt = (ns, px, py) => { ns = Math.min(MAX, Math.max(MIN, ns)); x = px - (px - x) * ns / sc; y = py - (py - y) * ns / sc; sc = ns; draw(); };
    const P = new Map(); let last = null;
    const info = () => { const a = [...P.values()]; return a.length > 1 ? { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 } : { d: 0, cx: a[0].x, cy: a[0].y }; };
    st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = info(); });
    st.addEventListener('pointermove', e => {
      if (!P.has(e.pointerId)) return; P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const n = info(), r = st.getBoundingClientRect();
      x += n.cx - last.cx; y += n.cy - last.cy;
      if (n.d && last.d) zoomAt(sc * n.d / last.d, n.cx - r.left, n.cy - r.top); else draw();
      last = n;
    });
    const up = e => { P.delete(e.pointerId); last = P.size ? info() : null; };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('wheel', e => { e.preventDefault(); const r = st.getBoundingClientRect(); zoomAt(sc * Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    rg.addEventListener('input', () => zoomAt(MIN * (1 + rg.value / 100 * 4), Z / 2, Z / 2));
    const done = v => { ov.remove(); resolve(v); };
    ov.addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (!c) return; done(c.dataset.c === 'ok' ? { sx: -x / sc, sy: -y / sc, side: Z / sc } : null); });
    draw();
  });
}
function renderCrop(bmp, c) {
  const out = Math.max(64, Math.min(600, Math.round(c.side)));
  const cv = document.createElement('canvas'); cv.width = cv.height = out;
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, out, out);
  cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, c.sx, c.sy, c.side, c.side, 0, 0, out, out);
  let fmt = 'image/webp', q = .8, url = cv.toDataURL(fmt, q);
  if (url.indexOf('data:image/webp') !== 0) { fmt = 'image/jpeg'; url = cv.toDataURL(fmt, q); }   // browser lama tanpa encoder WebP
  while (url.length * .75 > 60000 && q > .4) { q -= .1; url = cv.toDataURL(fmt, q); }
  return { url, kb: Math.max(1, Math.round(url.length * .75 / 1024)), type: fmt === 'image/webp' ? 'WebP' : 'JPEG' };
}

/* ---------- hitung ---------- */
function calc() {
  let sub = 0, n = 0; const lines = [];
  Object.keys(S.cart).forEach(id => { const p = prod(id); if (!p) return; const q = S.cart[id]; sub += p.price * q; n += q; lines.push({ p, q }); });
  const dv = S.disc.v || 0;
  const disc = S.disc.t === 'pct' ? Math.round(sub * Math.min(dv, 100) / 100) : Math.min(dv, sub);
  const base = sub - disc, tax = Math.round(base * (S.cfg.tax || 0) / 100);
  return { sub, n, lines, disc, base, tax, total: base + tax };
}

/* ---------- DOM dasar ---------- */
function build() {
  const root = document.createElement('div'); root.id = 'ksr';
  root.innerHTML = `
  <div class="ksr-hero"><div class="ksr-hero-top"><div class="ksr-hero-t"><small id="ksrGreet">Kasir</small><b id="ksrStore"></b></div>
    <button class="ksr-hb" data-a="swap" aria-label="Ganti ke Mode Invoice" title="Ganti ke Mode Invoice">${ic('swap', 18)}</button>
    <button class="ksr-hb" data-a="cfg" aria-label="Pengaturan kasir">${ic('gear', 18)}</button></div>
    <div class="ksr-hero-st"><div><small>Penjualan hari ini</small><b id="ksrToday">Rp 0</b></div><div class="ksr-pill" id="ksrTrx">0 transaksi</div></div></div>
  <div class="ksr-main">
    <div class="ksr-tab on" id="ksrJual"></div>
    <div class="ksr-tab" id="ksrProd"></div>
    <div class="ksr-tab" id="ksrRiw"></div>
    <div class="ksr-cartbar" id="ksrBar"><button data-a="cart"><span class="cn" id="ksrBarN">0</span><span class="ct"><small>Pesanan</small><b id="ksrBarT">Rp 0</b></span><span class="go">Lihat ${ic('chev', 16, 2.6)}</span></button></div>
    <button class="ksr-fab" id="ksrFab" data-a="newp">${ic('plus', 20, 2.6)} Produk</button>
  <nav class="ksr-nav">
    <button data-a="tab" data-id="jual" class="on">${ic('grid', 20, 1.8)}<span>Jual</span></button>
    <button data-a="tab" data-id="prod">${ic('tag', 20, 1.8)}<span>Produk</span></button>
    <button data-a="tab" data-id="riw">${ic('clock', 20, 1.8)}<span>Riwayat</span></button>
  </nav>
  <div class="ksr-ov" id="ksrSheet"></div>
  <input type="file" id="ksrFile" accept="image/*" hidden>`;
  document.body.appendChild(root);

  const md = document.createElement('div'); md.id = 'ksrMode';
  md.innerHTML = `<div style="width:100%;max-width:400px">
    <div style="display:flex;justify-content:center;margin-bottom:14px"><div class="ic" style="width:60px;height:60px;border-radius:20px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--sh-pri)">${ic('doc', 28)}</div></div>
    <h2>Mau pakai NotaSeru untuk apa?</h2><p class="s">Pilih mode yang sesuai. Bisa diganti kapan saja.</p>
    <button class="ksr-mc" data-a="mode" data-id="invoice"><span class="ic">${ic('doc', 26)}</span><span><b>Mode Invoice</b><span>Buat nota &amp; invoice untuk pelanggan, catat keuangan, kelola gudang &amp; stok.</span></span></button>
    <button class="ksr-mc" data-a="mode" data-id="kasir"><span class="ic">${ic('bag', 26)}</span><span><b>Mode Kasir</b><span>Jualan langsung: katalog produk berfoto per kategori, tombol + / −, bayar &amp; cetak struk. Cocok untuk kafe, toko alat tulis, warung.</span></span></button>
    <div class="ft">Semua data tersimpan di perangkat ini · jalan tanpa internet</div></div>`;
  document.body.appendChild(md);

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('.ksr-step input')) setTimeout(() => e.target.select && e.target.select(), 0); });
  md.addEventListener('click', onClick);
  $('#ksrFile').addEventListener('change', onFile);
  $('#ksrSheet').addEventListener('click', e => { if (e.target.id === 'ksrSheet' && (shKind === 'cart' || shKind === 'receipt' || shKind === 'cfg')) closeSh(); });
}

/* ---------- mode ---------- */
function setMode(m) {
  try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  const h = document.documentElement; h.classList.remove('kasir-boot'); h.classList.toggle('kasir-mode', m === 'kasir');
  $('#ksrMode').classList.remove('on'); closeSh(); window.scrollTo(0, 0);
  if (m === 'kasir') { $('#ksrStore').textContent = storeName(); showTab(S.tab); }
  else if (typeof renderDashboard === 'function') { try { renderDashboard(); } catch (e) {} }
}

/* ---------- hero ---------- */
function heroUpdate() {
  const h = new Date().getHours();
  $('#ksrGreet').textContent = (h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam') + ' · Kasir';
  const k = dayKey(Date.now()), L = S.sales.filter(s => dayKey(s.t) === k);
  $('#ksrToday').textContent = rp(L.reduce((a, s) => a + s.total, 0));
  $('#ksrTrx').textContent = L.length + ' transaksi';
}
/* ---------- tab ---------- */
function showTab(t) {
  S.tab = t;
  document.querySelectorAll('#ksr .ksr-tab').forEach(x => x.classList.remove('on'));
  $({ jual: '#ksrJual', prod: '#ksrProd', riw: '#ksrRiw' }[t]).classList.add('on');
  document.querySelectorAll('.ksr-nav button').forEach(b => b.classList.toggle('on', b.dataset.id === t));
  $('#ksrFab').classList.toggle('on', t === 'prod' && S.prods.length > 0);
  if (t === 'jual') renderJual(); else if (t === 'prod') renderProd(); else renderRiw();
  refreshBar(); heroUpdate();
}

/* ---------- JUAL ---------- */
function stepHTML(id, q) {
  return `<div class="ksr-step"><button class="mn" data-a="dec" data-id="${id}" aria-label="Kurangi">−</button><input type="number" inputmode="numeric" min="0" value="${q}" data-c="qty" data-id="${id}" aria-label="Jumlah"><button data-a="inc" data-id="${id}" aria-label="Tambah">+</button></div>`;
}
function ctlHTML(p) {
  const q = S.cart[p.id] || 0, out = p.track && p.stock <= 0;
  if (out) return `<button class="ksr-add" disabled>Habis</button>`;
  return q ? stepHTML(p.id, q) : `<button class="ksr-plus" data-a="inc" data-id="${p.id}" aria-label="Tambah ${esc(p.name)}">${ic('plus', 18, 2.8)}</button>`;
}
function cardHTML(p) {
  const q = S.cart[p.id] || 0, out = p.track && p.stock <= 0, low = p.track && p.stock > 0 && p.stock <= 5;
  return `<div class="ksr-card${q ? ' in' : ''}${out ? ' out' : ''}" data-card="${p.id}">
    <div class="ksr-img" data-a="${out ? 'noop' : 'inc'}" data-id="${p.id}">${p.img ? `<img src="${p.img}" alt="" loading="lazy">` : `<span class="ph">${esc(initial(p.name))}</span>`}${out ? '<span class="ksr-badge">Habis</span>' : low ? `<span class="ksr-badge low">Sisa ${p.stock}</span>` : ''}</div>
    <div class="ksr-info"><div class="ksr-nm">${esc(p.name)}</div><div class="ksr-pr">${rp(p.price)}</div></div>
    <div class="ksr-ctl" data-ctl="${p.id}">${ctlHTML(p)}</div></div>`;
}
function renderJual() {
  const el = $('#ksrJual');
  if (!S.prods.length) {
    el.innerHTML = `<div class="ksr-empty">${ic('bag', 46, 1.5)}<b>Katalog masih kosong</b><p>Tambahkan produk yang kamu jual lengkap dengan foto, harga, dan kategori. Setelah itu tinggal ketuk + untuk mencatat pesanan.</p><button class="ksr-btn" data-a="newp">${ic('plus', 18, 2.6)} Tambah Produk Pertama</button></div>`;
    return;
  }
  const cs = cats(); if (S.cat !== 'all' && !cs.includes(S.cat)) S.cat = 'all';
  el.innerHTML = `<div style="padding-top:2px"><div class="ksr-search">${ic('search', 18)}<input type="search" placeholder="Cari produk…" value="${esc(S.q)}" data-i="q" aria-label="Cari produk"></div>
    <div class="ksr-chips" id="ksrChips"></div><div id="ksrGrid"></div><div style="height:96px"></div></div>`;
  renderChips(); renderGrid();
}
function renderChips() {
  const el = $('#ksrChips'); if (!el) return;
  el.innerHTML = ['all'].concat(cats()).map(c => `<button class="ksr-chip${S.cat === c ? ' on' : ''}" data-a="cat" data-id="${esc(c)}">${c === 'all' ? 'Semua' : esc(c)}</button>`).join('');
}
function renderGrid() {
  const el = $('#ksrGrid'); if (!el) return;
  const q = S.q.trim().toLowerCase();
  const list = S.prods.filter(p => (S.cat === 'all' || (p.cat || 'Lainnya') === S.cat) && (!q || p.name.toLowerCase().includes(q)));
  if (!list.length) { el.innerHTML = `<div class="ksr-empty"><b>Produk tidak ditemukan</b><p>Coba kata kunci atau kategori lain.</p></div>`; return; }
  if (S.cat === 'all' && !q && cats().length > 1) {
    el.innerHTML = cats().map(c => { const l = list.filter(p => (p.cat || 'Lainnya') === c); return l.length ? `<div class="ksr-sec">${esc(c)} <i>${l.length} produk</i></div><div class="ksr-grid" style="margin-bottom:16px">${l.map(cardHTML).join('')}</div>` : ''; }).join('');
  } else el.innerHTML = `<div class="ksr-grid">${list.map(cardHTML).join('')}</div>`;
}
function updateCard(id) {
  const p = prod(id), card = document.querySelector(`[data-card="${id}"]`); if (!p || !card) return;
  card.classList.toggle('in', !!S.cart[id]);
  const c = card.querySelector('[data-ctl]'); if (c) c.innerHTML = ctlHTML(p);
}
function refreshBar() {
  const c = calc(), b = $('#ksrBar');
  b.classList.toggle('on', c.n > 0 && S.tab === 'jual');
  $('#ksrBarN').textContent = c.n > 99 ? '99+' : c.n; $('#ksrBarT').textContent = rp(c.total);
}
function setQty(id, q, fromInput) {
  const p = prod(id); if (!p) return;
  q = Math.max(0, Math.floor(Number(q)) || 0);
  if (p.track && q > p.stock) { q = Math.max(0, p.stock); toastK(`Stok ${p.name} tersisa ${p.stock}`, 'err'); }
  if (q) S.cart[id] = q; else delete S.cart[id];
  saveCart(); updateCard(id); refreshBar();
  if (shKind === 'cart') { if (!calc().n) closeSh(); else cartRender(); }
  if (navigator.vibrate && !fromInput) try { navigator.vibrate(8); } catch (e) {}
}

/* ---------- sheet ---------- */
let shKind = null;
function openSh(kind, title, body, foot) {
  shKind = kind; const ov = $('#ksrSheet');
  ov.innerHTML = `<div class="ksr-sh" role="dialog" aria-modal="true"><div class="ksr-sh-h"><b>${title}</b><button class="ksr-x" data-a="close" aria-label="Tutup">${ic('x', 16, 2.4)}</button></div><div class="ksr-sh-b" id="ksrShB">${body}</div>${foot ? `<div class="ksr-sh-f" id="ksrShF">${foot}</div>` : ''}</div>`;
  ov.classList.add('on');
}
function closeSh() { shKind = null; const ov = $('#ksrSheet'); if (ov) { ov.classList.remove('on'); ov.innerHTML = ''; } }

/* ---------- KERANJANG & BAYAR ---------- */
function cartBody() {
  const c = calc();
  const items = c.lines.map(l => `<div class="ksr-ci"><div class="th">${thumb(l.p)}</div><div class="tx"><b>${esc(l.p.name)}</b><small>${rp(l.p.price)}</small></div>${stepHTML(l.p.id, l.q)}<div class="lt">${rp(l.p.price * l.q)}</div></div>`).join('');
  return `${items}
  <div class="ksr-fl" style="margin-top:14px"><label>Diskon</label><div style="display:flex;gap:8px"><div class="ksr-seg" style="width:116px;flex:none"><button data-a="dtype" data-id="rp" class="${S.disc.t === 'rp' ? 'on' : ''}">Rp</button><button data-a="dtype" data-id="pct" class="${S.disc.t === 'pct' ? 'on' : ''}">%</button></div><input class="ksr-in" id="ksrDisc" inputmode="numeric" placeholder="0" data-i="disc" value="${S.disc.v ? (S.disc.t === 'rp' ? fmtNum(S.disc.v) : S.disc.v) : ''}"></div></div>
  <div class="ksr-fl"><label>Catatan (opsional)</label><input class="ksr-in" data-i="note" placeholder="Mis. meja 5 / atas nama Budi" value="${esc(S.note)}"></div>
  <div class="ksr-tot" id="ksrTot"></div>
  <div class="ksr-fl"><label>Metode pembayaran</label><div class="ksr-pay">${Object.keys(PAYN).map(k => `<button data-a="pay" data-id="${k}" class="${S.pay === k ? 'on' : ''}">${PAYN[k]}</button>`).join('')}</div><div id="ksrCash"></div></div>`;
}
function cartFoot() { return `<button class="ksr-btn dng" data-a="clear" style="flex:none">Kosongkan</button><button class="ksr-btn block" id="ksrPayBtn" data-a="checkout">Bayar</button>`; }
function cartOpen() { S.cash = 0; openSh('cart', 'Pesanan', cartBody(), cartFoot()); updPay(); }
function cartRender() {
  const b = $('#ksrShB'), st = b ? b.scrollTop : 0; if (!b) return;
  b.innerHTML = cartBody(); b.scrollTop = st; updPay();
}
function updPay() {
  const c = calc(); const t = $('#ksrTot'); if (!t) return;
  t.innerHTML = `<div class="ksr-li"><span>Subtotal (${c.n} item)</span><span>${rp(c.sub)}</span></div>` +
    (c.disc ? `<div class="ksr-li"><span>Diskon${S.disc.t === 'pct' ? ' ' + S.disc.v + '%' : ''}</span><span style="color:var(--danger)">−${rp(c.disc)}</span></div>` : '') +
    (c.tax ? `<div class="ksr-li"><span>Pajak ${S.cfg.tax}%</span><span>${rp(c.tax)}</span></div>` : '') +
    `<div class="ksr-li g"><span>Total</span><span>${rp(c.total)}</span></div>`;
  const cash = $('#ksrCash'), btn = $('#ksrPayBtn'); let ok = c.n > 0;
  if (S.pay === 'tunai') {
    const sug = []; [5000, 10000, 20000, 50000, 100000].forEach(u => { const v = Math.ceil(c.total / u) * u; if (v > c.total && !sug.includes(v)) sug.push(v); });
    const chg = S.cash - c.total; ok = ok && S.cash >= c.total;
    cash.innerHTML = `<label style="display:block;font-size:12px;font-weight:800;color:var(--txt-2);margin:0 2px 6px">Uang diterima</label><input class="ksr-in" id="ksrCashIn" inputmode="numeric" placeholder="0" data-i="cash" value="${fmtNum(S.cash)}">
      <div class="ksr-quick"><button class="pas" data-a="cashv" data-id="${c.total}">Uang pas</button>${sug.slice(0, 4).map(v => `<button data-a="cashv" data-id="${v}">${v.toLocaleString('id-ID')}</button>`).join('')}</div>
      <div class="ksr-chg${chg < 0 ? ' neg' : ''}"><span>${chg < 0 ? 'Kurang' : 'Kembalian'}</span><span>${rp(Math.abs(S.cash ? chg : 0))}</span></div>`;
  } else cash.innerHTML = `<div style="font-size:12.5px;color:var(--txt-3);font-weight:600;line-height:1.5">Pastikan pembayaran ${PAYN[S.pay]} sudah diterima sebelum menyelesaikan transaksi.</div>`;
  if (btn) { btn.disabled = !ok; btn.textContent = 'Bayar · ' + rp(c.total); }
}
function updCashOnly() {
  const c = calc(), chgEl = document.querySelector('.ksr-chg'), btn = $('#ksrPayBtn'); if (!chgEl) return;
  const chg = S.cash - c.total; chgEl.classList.toggle('neg', chg < 0);
  chgEl.innerHTML = `<span>${chg < 0 ? 'Kurang' : 'Kembalian'}</span><span>${rp(Math.abs(S.cash ? chg : 0))}</span>`;
  if (btn) btn.disabled = !(c.n > 0 && S.cash >= c.total);
}
async function checkout() {
  const c = calc(); if (!c.n) return;
  if (S.pay === 'tunai' && S.cash < c.total) return toastK('Uang yang diterima kurang', 'err');
  const now = Date.now(), d = new Date(now), pre = 'K-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-';
  let mx = 0; S.sales.forEach(s => { if (s.no.indexOf(pre) === 0) mx = Math.max(mx, parseInt(s.no.slice(pre.length), 10) || 0); });
  const sale = { id: uid(), no: pre + String(mx + 1).padStart(3, '0'), t: now,
    items: c.lines.map(l => ({ id: l.p.id, name: l.p.name, price: l.p.price, qty: l.q })),
    sub: c.sub, disc: c.disc, discLbl: S.disc.t === 'pct' && S.disc.v ? S.disc.v + '%' : '', tax: c.tax, taxPct: S.cfg.tax || 0, total: c.total,
    pay: S.pay, paid: S.pay === 'tunai' ? S.cash : c.total, change: S.pay === 'tunai' ? S.cash - c.total : 0, note: S.note.trim() };
  c.lines.forEach(l => { if (l.p.track) { l.p.stock = Math.max(0, l.p.stock - l.q); saveProd(l.p); } });
  S.sales.unshift(sale); await saveSale(sale);
  S.cart = {}; S.disc = { t: 'rp', v: 0 }; S.cash = 0; S.note = ''; saveCart();
  if (S.tab === 'jual') renderGrid(); refreshBar(); heroUpdate(); receiptOpen(sale, true);
  if (window.NSPrint && NSPrint.cfg.auto && NSPrint.isThermal()) NSPrint.print(saleDoc(sale)).catch(e => toastK('Cetak otomatis gagal: ' + NSPrint.errMsg(e), 'err'));
}

/* ---------- STRUK ---------- */
function receiptHTML(s) {
  const L = s.items.map(i => `<div class="it"><div class="n">${esc(i.name)}</div><div class="r"><span>${i.qty} x ${Math.round(i.price).toLocaleString('id-ID')}</span><span>${Math.round(i.price * i.qty).toLocaleString('id-ID')}</span></div></div>`).join('');
  const sets = (typeof DB !== 'undefined') ? DB.get('settings', {}) : {};
  const addr = S.cfg.addr || [sets.storeAddress || sets.address || '', sets.storePhone || sets.phone || ''].filter(Boolean).join('\n');
  const row = (a, b, cls) => `<div class="r ${cls || ''}"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="ksr-rc"><div class="c"><h4>${esc(storeName())}</h4>${addr ? `<div style="white-space:pre-line">${esc(addr)}</div>` : ''}</div><hr>
  ${row('No', esc(s.no))}${S.cfg.kasir ? row('Kasir', esc(S.cfg.kasir)) : ''}${row('Tanggal', new Date(s.t).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + new Date(s.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))}${s.note ? row('Ket', esc(s.note)) : ''}<hr>
  ${L}<hr>
  ${row('Subtotal', Math.round(s.sub).toLocaleString('id-ID'))}${s.disc ? row('Diskon' + (s.discLbl ? ' ' + s.discLbl : ''), '-' + Math.round(s.disc).toLocaleString('id-ID')) : ''}${s.tax ? row('Pajak ' + s.taxPct + '%', Math.round(s.tax).toLocaleString('id-ID')) : ''}
  ${row('TOTAL', Math.round(s.total).toLocaleString('id-ID'), 'b')}<hr>
  ${row(PAYN[s.pay] || s.pay, Math.round(s.paid).toLocaleString('id-ID'))}${s.pay === 'tunai' ? row('Kembali', Math.round(s.change).toLocaleString('id-ID')) : ''}<hr>
  <div class="c">${esc(S.cfg.foot || '')}</div></div>`;
}
let curSale = null;
function receiptOpen(s, fresh) {
  curSale = s;
  const head = fresh ? `<div class="ksr-ok">${ic('check', 34, 2.6)}</div><div style="text-align:center;font-weight:800;font-size:16px;margin-bottom:2px">Pembayaran berhasil</div><div style="text-align:center;color:var(--txt-3);font-weight:700;font-size:13px;margin-bottom:14px">${s.pay === 'tunai' ? 'Kembalian ' + rp(s.change) : PAYN[s.pay] + ' · ' + rp(s.total)}</div>` : '';
  const body = head + `<div id="ksrRcWrap">${receiptHTML(s)}</div>
    <div style="display:flex;gap:10px;margin-top:16px"><button class="ksr-btn sec block" data-a="share">${ic('share', 17)} Bagikan</button><button class="ksr-btn sec block" data-a="print">${ic('print', 17)} Cetak</button></div>` +
    (fresh ? '' : `<button class="ksr-btn dng block" style="margin-top:10px" data-a="delsale" data-id="${s.id}">Hapus transaksi ini</button>`);
  openSh('receipt', fresh ? 'Selesai' : 'Struk ' + esc(s.no), body, fresh ? `<button class="ksr-btn block" data-a="close">Transaksi Baru</button>` : '');
  setTimeout(rcMake, 400); // siapkan gambar struk di muka agar tombol Bagikan langsung membuka share sheet
}
function printReceipt() { if (curSale) NSPrint.open(saleDoc(curSale)); }
/* Gambar struk dibuat di muka (html2canvas bisa makan beberapa detik). Browser hanya mengizinkan share sheet
   sesaat setelah ketukan; kalau gambar baru dibuat SETELAH ketukan, navigator.share ditolak (NotAllowedError). */
let rcBlob = null, rcKey = '', rcBusy = null;
function rcMake() {
  const el = $('#ksrRcWrap .ksr-rc'); if (!el || !curSale) return Promise.resolve(null);
  const key = curSale.id;
  if (rcBlob && rcKey === key) return Promise.resolve(rcBlob);
  if (rcBusy && rcBusy.key === key) return rcBusy.p;
  if (!window.html2canvas) return Promise.resolve(null);
  const p = html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
    .then(cv => new Promise(r => cv.toBlob(r, 'image/png')))
    .then(b => { if (b && curSale && curSale.id === key) { rcBlob = b; rcKey = key; } return b; })
    .catch(() => null)
    .then(b => { if (rcBusy && rcBusy.p === p) rcBusy = null; return b; });
  rcBusy = { key, p }; return p;
}
function rcSave(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toastK('Struk tersimpan sebagai gambar');
}
async function shareReceipt() {
  if (!curSale) return;
  const name = 'struk-' + curSale.no + '.png', ready = !!(rcBlob && rcKey === curSale.id);
  if (!ready) toastK('Menyiapkan gambar struk…');
  const blob = await rcMake();
  if (!blob) return toastK('Gagal membuat gambar struk', 'err');
  const data = { files: [new File([blob], name, { type: 'image/png' })], title: 'Struk ' + curSale.no };
  try {
    if (navigator.share && navigator.canShare && navigator.canShare(data)) { await navigator.share(data); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // pengguna menutup share sheet
    if (e && e.name === 'NotAllowedError' && !ready) return toastK('Gambar siap. Tekan Bagikan sekali lagi'); // izin ketukan habis selagi menunggu; ketukan berikutnya langsung terbuka
  }
  rcSave(blob, name); // perangkat tanpa share sheet / gagal berbagi: simpan sebagai gambar
}
async function delSale(id) {
  const s = S.sales.find(x => x.id === id); if (!s || !confirm('Hapus transaksi ' + s.no + '? Stok produk yang dilacak akan dikembalikan.')) return;
  s.items.forEach(i => { const p = prod(i.id); if (p && p.track) { p.stock += i.qty; saveProd(p); } });
  S.sales = S.sales.filter(x => x.id !== id); await persist(dbRun('sales', st => st.delete(id)));
  closeSh(); renderRiw(); heroUpdate(); toastK('Transaksi dihapus');
}

/* ---------- PRODUK ---------- */
function renderProd() {
  const el = $('#ksrProd');
  if (!S.prods.length) { el.innerHTML = `<div class="ksr-empty">${ic('tag', 46, 1.5)}<b>Belum ada produk</b><p>Tambah produk dengan foto, harga, dan kategori. Foto otomatis diperkecil ke format WebP supaya ringan.</p><button class="ksr-btn" data-a="newp">${ic('plus', 18, 2.6)} Tambah Produk</button></div>`; return; }
  el.innerHTML = `<div class="ksr-search">${ic('search', 18)}<input type="search" placeholder="Cari di ${S.prods.length} produk…" value="${esc(S.pq)}" data-i="pq"></div><div id="ksrPList"></div><div style="height:84px"></div>`;
  renderPList();
}
function renderPList() {
  const el = $('#ksrPList'); if (!el) return; const q = S.pq.trim().toLowerCase();
  const l = S.prods.filter(p => !q || p.name.toLowerCase().includes(q));
  if (!l.length) { el.innerHTML = '<div class="ksr-empty"><b>Tidak ditemukan</b></div>'; return; }
  el.innerHTML = cats().map(c => { const g = l.filter(p => (p.cat || 'Lainnya') === c); return g.length ? `<div class="ksr-sec">${esc(c)} <i>${g.length}</i><button class="ksr-catb" data-a="rencat" data-id="${esc(c)}" aria-label="Ubah nama kategori">${ic('edit', 13, 2.2)}</button></div>` + g.map(p => `<div class="ksr-row" data-a="editp" data-id="${p.id}"><div class="th">${thumb(p)}</div><div class="tx"><b>${esc(p.name)}</b><small>${p.track ? 'Stok ' + p.stock : 'Stok tidak dilacak'}</small></div><div class="rt">${rp(p.price)}<small>Ubah</small></div></div>`).join('') : ''; }).join('');
}
let E = null;
function editP(id) {
  const p = id ? prod(id) : null;
  E = p ? { id: p.id, name: p.name, price: p.price, cat: p.cat || '', img: p.img || null, track: !!p.track, stock: p.stock || 0, info: p.img ? 'Foto tersimpan' : '' }
        : { id: null, name: '', price: 0, cat: (S.cat !== 'all' ? S.cat : (cats()[0] || '')), img: null, track: false, stock: 0, info: '' };
  openSh('edit', p ? 'Ubah Produk' : 'Produk Baru', editBody(), `${p ? `<button class="ksr-btn dng" data-a="delp" style="flex:none">Hapus</button>` : ''}<button class="ksr-btn block" data-a="savep">Simpan Produk</button>`);
}
function editBody() {
  return `<div class="ksr-photo"><div class="pv" id="ksrPv">${E.img ? `<img src="${E.img}" alt="">` : ic('img', 30, 1.6)}</div>
    <div class="pb"><button class="ksr-btn sec" data-a="pick" style="height:42px">${ic('img', 17)} ${E.img ? 'Ganti foto' : 'Tambah foto'}</button>${E.img ? `<button class="ksr-btn ghost" data-a="recrop" style="height:36px;font-size:13px">Atur posisi / zoom</button><button class="ksr-btn ghost" data-a="rmimg" style="height:36px;font-size:13px">Hapus foto</button>` : ''}<small id="ksrImgInfo">${esc(E.info) || 'Bisa digeser &amp; di-zoom, lalu dikompres ke WebP.'}</small></div></div>
  <div class="ksr-fl"><label>Nama produk</label><input class="ksr-in" data-i="e-name" value="${esc(E.name)}" placeholder="Mis. Es Kopi Susu" maxlength="80"></div>
  <div class="ksr-fl"><label>Harga jual (Rp)</label><input class="ksr-in" inputmode="numeric" data-i="e-price" value="${fmtNum(E.price)}" placeholder="0"></div>
  <div class="ksr-fl"><label>Kategori</label><input class="ksr-in" data-i="e-cat" value="${esc(E.cat)}" placeholder="Mis. Minuman, Makanan, ATK" maxlength="40">
    ${cats().length ? `<div class="ksr-quick">${cats().map(c => `<button data-a="setcat" data-id="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</div>
  <div class="ksr-tg" data-a="trk"><span>Lacak stok</span><span class="ksr-sw${E.track ? ' on' : ''}" id="ksrTrk"></span></div>
  <div class="ksr-fl" id="ksrStk" style="${E.track ? '' : 'display:none'}"><label>Jumlah stok</label><input class="ksr-in" inputmode="numeric" data-i="e-stock" value="${E.stock || ''}" placeholder="0"></div>`;
}
async function applyPhoto(src, origKb) {
  const inf = $('#ksrImgInfo'); if (inf) inf.textContent = 'Membuka foto…';
  let bmp, r;
  try {
    bmp = await loadBmp(src); const c = await cropPhoto(bmp);
    if (!c) { if (inf) inf.textContent = E.info || ''; return; }
    r = renderCrop(bmp, c);
  } catch (err) { console.error(err); toastK('Foto tidak bisa dibaca', 'err'); if (inf) inf.textContent = ''; return; }
  finally { if (bmp && bmp.close) bmp.close(); }
  E.img = r.url; E.info = `${r.type} · ${r.kb} KB` + (origKb ? ` (dari ${origKb.toLocaleString('id-ID')} KB)` : '');
  const b = $('#ksrShB'), st = b.scrollTop; b.innerHTML = editBody(); b.scrollTop = st;
}
async function onFile(e) {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f || !E) return;
  applyPhoto(f, Math.round(f.size / 1024));
}
async function saveP() {
  const name = E.name.trim(); if (!name) return toastK('Nama produk wajib diisi', 'err');
  if (!E.price || E.price < 0) return toastK('Harga belum diisi', 'err');
  let p = E.id ? prod(E.id) : null;
  if (!p) { p = { id: uid(), at: Date.now() }; S.prods.push(p); }
  Object.assign(p, { name, price: E.price, cat: E.cat.trim(), img: E.img, track: E.track, stock: E.track ? Math.max(0, Math.floor(E.stock) || 0) : 0 });
  await saveProd(p); closeSh(); toastK('Produk disimpan');
  if (S.tab === 'prod') renderProd(); else showTab(S.tab);
  $('#ksrFab').classList.toggle('on', S.tab === 'prod' && S.prods.length > 0);
}
async function delP() {
  const p = E && E.id && prod(E.id); if (!p || !confirm('Hapus produk "' + p.name + '"? Riwayat transaksi tetap tersimpan.')) return;
  S.prods = S.prods.filter(x => x.id !== p.id); delete S.cart[p.id]; saveCart();
  await persist(dbRun('products', s => s.delete(p.id))); closeSh(); renderProd(); refreshBar(); $('#ksrFab').classList.toggle('on', S.prods.length > 0);
}

/* ---------- RIWAYAT ---------- */
function inRange(t) {
  const n = new Date(), sod = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (S.range === 'today') return t >= sod; if (S.range === '7d') return t >= sod - 6 * 864e5;
  if (S.range === 'month') return t >= new Date(n.getFullYear(), n.getMonth(), 1).getTime(); return true;
}
function renderRiw() {
  const el = $('#ksrRiw'), L = S.sales.filter(s => inRange(s.t));
  const omz = L.reduce((a, s) => a + s.total, 0), itn = L.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0);
  const byPay = {}, byP = {}; L.forEach(s => { byPay[s.pay] = (byPay[s.pay] || 0) + s.total; s.items.forEach(i => { const e = byP[i.name] || (byP[i.name] = { q: 0, v: 0 }); e.q += i.qty; e.v += i.price * i.qty; }); });
  const top = Object.entries(byP).sort((a, b) => b[1].q - a[1].q).slice(0, 5);
  let list = '', last = ''; L.forEach(s => { const k = dayKey(s.t); if (k !== last) { last = k; list += `<div class="ksr-day">${esc(dayLbl(s.t))}</div>`; } list += `<div class="ksr-row" data-a="viewsale" data-id="${s.id}"><div class="tx"><b>${esc(s.no)}</b><small>${new Date(s.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · ${s.items.reduce((x, i) => x + i.qty, 0)} item · ${PAYN[s.pay]}</small></div><div class="rt">${rp(s.total)}</div></div>`; });
  const R = [['today', 'Hari ini'], ['7d', '7 hari'], ['month', 'Bulan ini'], ['all', 'Semua']];
  el.innerHTML = `<div class="ksr-chips">${R.map(r => `<button class="ksr-chip${S.range === r[0] ? ' on' : ''}" data-a="range" data-id="${r[0]}">${r[1]}</button>`).join('')}</div>
  <button class="ksr-stbtn" data-a="stmt"><span class="ic">${ic('doc', 20)}</span><span style="flex:1"><b>E-Statement &amp; Rekap</b><small>PDF atau Excel · harian / bulanan · pilih periode</small></span>${ic('chev', 16)}</button>
  <div class="ksr-sum"><div class="big"><small>Omzet</small><b>${rp(omz)}</b></div><div><small>Transaksi</small><b>${L.length}</b></div><div><small>Item terjual</small><b>${itn.toLocaleString('id-ID')}</b></div></div>
  ${L.length ? `<div class="ksr-sec">Per metode bayar</div><div class="ksr-box">${Object.keys(byPay).map(k => `<div class="ksr-li"><span>${PAYN[k] || k}</span><span>${rp(byPay[k])}</span></div>`).join('')}</div>
  <div class="ksr-sec">Produk terlaris</div><div class="ksr-box">${top.map((t, i) => `<div class="ksr-li"><span>${i + 1}. ${esc(t[0])} <span style="color:var(--txt-3)">×${t[1].q}</span></span><span>${rp(t[1].v)}</span></div>`).join('')}</div>
  <div class="ksr-sec">Transaksi</div>${list}`
  : `<div class="ksr-empty">${ic('clock', 46, 1.5)}<b>Belum ada transaksi</b><p>Transaksi yang sudah dibayar akan muncul di sini.</p></div>`}`;
}
/* ---------- PENGATURAN ---------- */
function cfgOpen() {
  const sets = (typeof DB !== 'undefined') ? DB.get('settings', {}) : {};
  openSh('cfg', 'Pengaturan Kasir', `
  <div class="ksr-fl"><label>Nama usaha di struk</label><input class="ksr-in" data-i="c-name" value="${esc(S.cfg.name)}" placeholder="${esc(sets.storeName || 'Toko Saya')}"></div>
  <div class="ksr-fl"><label>Alamat / telepon di struk</label><textarea class="ksr-in" rows="2" data-i="c-addr" placeholder="Opsional">${esc(S.cfg.addr)}</textarea></div>
  <div class="ksr-2"><div class="ksr-fl"><label>Pajak / PB1 (%)</label><input class="ksr-in" inputmode="decimal" data-i="c-tax" value="${S.cfg.tax || ''}" placeholder="0"></div><div></div></div>
  <div class="ksr-fl"><label>Nama kasir (tampil di struk)</label><input class="ksr-in" data-i="c-kasir" value="${esc(S.cfg.kasir)}" placeholder="Opsional"></div>
  <div class="ksr-fl"><label>Pesan di bawah struk</label><input class="ksr-in" data-i="c-foot" value="${esc(S.cfg.foot)}"></div>
  <div class="ksr-sec" style="margin-top:20px">Printer &amp; data</div>
  <button class="ksr-btn block" data-a="prn" style="margin-bottom:10px">${ic('print', 17)} Printer &amp; ukuran kertas</button>
  <button class="ksr-btn sec block" data-a="bak" style="margin-bottom:10px">${ic('dl', 17)} Backup semua data (termasuk foto)</button>
  <button class="ksr-btn sec block" data-a="rst" style="margin-bottom:10px">Restore dari file backup</button>
  <button class="ksr-btn ghost block" data-a="theme" style="margin-bottom:10px">Ganti tema terang / gelap</button>
  <button class="ksr-btn ghost block" data-a="mode" data-id="invoice">${ic('swap', 17)} Pindah ke Mode Invoice</button>`,
  `<button class="ksr-btn block" data-a="cfgsave">Simpan</button>`);
}

/* ---------- E-STATEMENT PENJUALAN ---------- */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const ST = { pre: 'month', from: '', to: '', group: 'day', detail: true, fmt: 'pdf' };
const PRES = [['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7d', '7 hari'], ['month', 'Bulan ini'], ['lastmonth', 'Bulan lalu'], ['year', 'Tahun ini'], ['all', 'Semua']];
function presetRange(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate(), D = (a, b, c) => new Date(a, b, c);
  let f, t = D(y, m, d);
  if (p === 'yesterday') f = t = D(y, m, d - 1);
  else if (p === '7d') f = D(y, m, d - 6);
  else if (p === 'month') f = D(y, m, 1);
  else if (p === 'lastmonth') { f = D(y, m - 1, 1); t = D(y, m, 0); }
  else if (p === 'year') f = D(y, 0, 1);
  else if (p === 'all') f = new Date(S.sales.reduce((a, s) => Math.min(a, s.t), Date.now()));
  else f = t;
  return [ymd(f), ymd(t)];
}
function stmtSet(p) { ST.pre = p; if (p !== 'custom') { const r = presetRange(p); ST.from = r[0]; ST.to = r[1]; ST.group = (p === 'year' || p === 'all') ? 'month' : 'day'; } }
const stmtSales = () => {
  if (!ST.from || !ST.to) return [];
  const f = new Date(ST.from + 'T00:00:00').getTime(), t = new Date(ST.to + 'T23:59:59.999').getTime();
  return S.sales.filter(s => s.t >= f && s.t <= t).sort((a, b) => a.t - b.t);
};
function stmtAgg(L) {
  const sum = { trx: L.length, items: 0, sub: 0, disc: 0, tax: 0, total: 0 }, G = {}, pay = {}, pr = {};
  L.forEach(s => {
    const q = s.items.reduce((a, i) => a + i.qty, 0); sum.items += q; sum.sub += s.sub; sum.disc += s.disc; sum.tax += s.tax; sum.total += s.total;
    const d = new Date(s.t), k = ST.group === 'month' ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) : ymd(d);
    const g = G[k] || (G[k] = { k, t: s.t, trx: 0, items: 0, disc: 0, tax: 0, total: 0 });
    g.trx++; g.items += q; g.disc += s.disc; g.tax += s.tax; g.total += s.total;
    const p = pay[s.pay] || (pay[s.pay] = { trx: 0, total: 0 }); p.trx++; p.total += s.total;
    s.items.forEach(i => { const e = pr[i.name] || (pr[i.name] = { q: 0, v: 0 }); e.q += i.qty; e.v += i.price * i.qty; });
  });
  sum.avg = sum.trx ? sum.total / sum.trx : 0;
  return { sum, groups: Object.values(G).sort((a, b) => a.k < b.k ? -1 : 1), pay, prods: Object.entries(pr).sort((a, b) => b[1].v - a[1].v) };
}
const gLabel = g => { const d = new Date(g.t); return ST.group === 'month' ? d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); };
function stmtBody() {
  const seg = (a, items, cur) => `<div class="ksr-seg">${items.map(i => `<button data-a="${a}" data-id="${i[0]}" class="${cur === i[0] ? 'on' : ''}">${i[1]}</button>`).join('')}</div>`;
  return `<div class="ksr-fl"><label>Periode</label><div class="ksr-presets">${PRES.map(p => `<button data-a="stpre" data-id="${p[0]}" class="${ST.pre === p[0] ? 'on' : ''}">${p[1]}</button>`).join('')}</div></div>
  <div class="ksr-2"><div class="ksr-fl"><label>Dari tanggal</label><input type="date" class="ksr-in" data-i="st-from" value="${ST.from}"></div><div class="ksr-fl"><label>Sampai tanggal</label><input type="date" class="ksr-in" data-i="st-to" value="${ST.to}"></div></div>
  <div class="ksr-fl"><label>Rekap per</label>${seg('stgrp', [['day', 'Harian'], ['month', 'Bulanan']], ST.group)}</div>
  <div class="ksr-fl"><label>Format file</label>${seg('stfmt', [['pdf', 'PDF E-Statement'], ['xlsx', 'Excel']], ST.fmt)}</div>
  <div class="ksr-tg" data-a="stdet"><span>Sertakan rincian tiap transaksi</span><span class="ksr-sw${ST.detail ? ' on' : ''}" id="ksrStDet"></span></div>
  <div class="ksr-stinfo" id="ksrStInfo"></div>`;
}
function stmtInfo() {
  const el = $('#ksrStInfo'), btn = $('#ksrStGo'); if (!el) return;
  const bad = !ST.from || !ST.to || ST.from > ST.to, L = bad ? [] : stmtSales();
  el.textContent = bad ? 'Rentang tanggal belum valid' : L.length ? `${L.length} transaksi · ${rp(L.reduce((a, s) => a + s.total, 0))}` : 'Tidak ada transaksi pada periode ini';
  if (btn) btn.disabled = !L.length;
}
function stmtRender() { const b = $('#ksrShB'); if (!b) return; const st = b.scrollTop; b.innerHTML = stmtBody(); b.scrollTop = st; stmtInfo(); }
function stmtOpen() {
  if (!ST.from) stmtSet('month');
  openSh('stmt', 'E-Statement Penjualan', stmtBody(), `<button class="ksr-btn block" id="ksrStGo" data-a="stgo">${ic('dl', 17)} Buat E-Statement</button>`); stmtInfo();
}
async function shareOrSave(blob, fn) {
  try {
    const f = new File([blob], fn, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: fn }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toastK('File tersimpan');
}
async function stmtGo() {
  if (ST.from > ST.to) return toastK('Tanggal awal harus sebelum akhir', 'err');
  const L = stmtSales(); if (!L.length) return toastK('Tidak ada transaksi pada periode ini', 'err');
  const btn = $('#ksrStGo'); btn.disabled = true; btn.textContent = 'Menyiapkan…';
  try {
    const A = stmtAgg(L), base = 'E-Statement-Kasir_' + storeName().replace(/[^a-z0-9]+/gi, '_') + '_' + ST.from + '_' + ST.to;
    let blob, fn;
    if (ST.fmt === 'pdf') { if (!window.jspdf) throw new Error('Library PDF belum siap, coba lagi'); blob = stmtPdf(L, A); fn = base + '.pdf'; }
    else { if (!window.XLSX) throw new Error('Library Excel belum siap'); blob = stmtXlsx(L, A); fn = base + '.xlsx'; }
    closeSh(); await shareOrSave(blob, fn);
  } catch (e) { console.error(e); toastK('Gagal: ' + e.message, 'err'); const b = $('#ksrStGo'); if (b) { b.disabled = false; b.textContent = 'Buat E-Statement'; } }
}
function stmtXlsx(L, A) {
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  add('Ringkasan', [['E-Statement Penjualan Kasir'], [storeName()], ['Periode', ST.from + ' s/d ' + ST.to], [], ['Penjualan bersih', A.sum.total], ['Jumlah transaksi', A.sum.trx], ['Item terjual', A.sum.items], ['Subtotal', A.sum.sub], ['Diskon', A.sum.disc], ['Pajak', A.sum.tax], ['Rata-rata per transaksi', Math.round(A.sum.avg)]]);
  add(ST.group === 'month' ? 'Rekap Bulanan' : 'Rekap Harian', [['Periode', 'Transaksi', 'Item', 'Diskon', 'Pajak', 'Total']].concat(A.groups.map(g => [gLabel(g), g.trx, g.items, g.disc, g.tax, g.total])));
  add('Metode Bayar', [['Metode', 'Transaksi', 'Total']].concat(Object.keys(A.pay).map(k => [PAYN[k] || k, A.pay[k].trx, A.pay[k].total])));
  add('Produk', [['Produk', 'Qty', 'Pendapatan']].concat(A.prods.map(p => [p[0], p[1].q, p[1].v])));
  if (ST.detail) add('Transaksi', [['No', 'Tanggal', 'Jam', 'Item', 'Subtotal', 'Diskon', 'Pajak', 'Total', 'Metode', 'Catatan']].concat(L.map(s => [s.no, new Date(s.t).toLocaleDateString('id-ID'), new Date(s.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), s.items.map(i => i.name + ' x' + i.qty).join(', '), s.sub, s.disc, s.tax, s.total, PAYN[s.pay] || s.pay, s.note || ''])));
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function stmtPdf(L, A) {
  const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 14, TW = W - 2 * M;
  const C = { blue: '#1D4ED8', dark: '#1E3A8A', ink: '#1E293B', gray: '#94A3B8', mid: '#64748B', line: '#E5E9EF', zebra: '#F8FAFC', soft: '#EAF0FF' };
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const fill = h => pdf.setFillColor.apply(pdf, rgb(h)), stroke = h => pdf.setDrawColor.apply(pdf, rgb(h)), color = h => pdf.setTextColor.apply(pdf, rgb(h));
  const font = (sz, b) => { pdf.setFontSize(sz); pdf.setFont('helvetica', b ? 'bold' : 'normal'); };
  const N = NSPrint.nf, R = n => 'Rp ' + N(n);
  const biz = storeName(), sets = (typeof DB !== 'undefined') ? DB.get('settings', {}) : {};
  const addr = (S.cfg.addr || [sets.storeAddress, sets.storePhone].filter(Boolean).join('\n')).split('\n').filter(Boolean).join('  |  ');
  const fD = s => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  const periode = ST.from === ST.to ? fD(ST.from) : fD(ST.from) + ' - ' + fD(ST.to);
  const now = new Date(), gen = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  let y;
  /* letterhead */
  fill(C.blue); pdf.rect(0, 0, W, 3, 'F');
  fill(C.blue); pdf.roundedRect(M, 10, TW, 36, 3, 3, 'F');
  fill('#FFFFFF'); pdf.roundedRect(M + 6, 16, 15, 15, 3, 3, 'F');
  const lg = /^data:image\/(png|jpe?g)/.test(sets.logo || '') ? sets.logo : ''; let logoOk = false;
  if (lg) { try { pdf.addImage(lg, /png/.test(lg.slice(0, 20)) ? 'PNG' : 'JPEG', M + 6, 16, 15, 15); logoOk = true; } catch (e) {} }
  if (!logoOk) { color(C.blue); font(13, 1); pdf.text(initial(biz), M + 13.5, 26, { align: 'center' }); }
  color('#FFFFFF'); font(14, 1); pdf.text(pdf.splitTextToSize(biz, 80)[0], M + 26, 21);
  font(7.5); color('#DCE6FF'); pdf.splitTextToSize(addr, 82).slice(0, 3).forEach((l, i) => pdf.text(l, M + 26, 26.5 + i * 4));
  font(7, 1); color('#BFD0FF'); pdf.text('LAPORAN PENJUALAN', W - M - 6, 19, { align: 'right' });
  font(18, 1); color('#FFFFFF'); pdf.text('E-Statement', W - M - 6, 28, { align: 'right' });
  font(8.5, 1); pdf.text(periode, W - M - 6, 34, { align: 'right' });
  font(7.5); color('#BFD0FF'); pdf.text('Dicetak: ' + gen, W - M - 6, 39.5, { align: 'right' });
  y = 54;
  /* kartu ringkasan */
  const cw = (TW - 3 * 3.5) / 4, cards = [['PENJUALAN BERSIH', R(A.sum.total), C.blue], ['TRANSAKSI', N(A.sum.trx), C.ink], ['ITEM TERJUAL', N(A.sum.items), C.ink], ['RATA-RATA / TRANSAKSI', R(A.sum.avg), C.ink]];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 3.5); fill('#FFFFFF'); stroke(C.line); pdf.setLineWidth(.3); pdf.roundedRect(x, y, cw, 19, 2.5, 2.5, 'FD');
    font(6.3, 1); color(C.gray); pdf.text(c[0], x + 4, y + 6.5);
    font(i === 0 ? 11 : 10.5, 1); color(c[2]); pdf.text(c[1], x + 4, y + 14.5);
  });
  y += 25; fill(C.zebra); pdf.roundedRect(M, y, TW, 9, 2, 2, 'F'); font(7.8, 1); color(C.mid);
  pdf.text('Subtotal ' + R(A.sum.sub) + '    -  Diskon ' + R(A.sum.disc) + '    +  Pajak ' + R(A.sum.tax) + '    =  ' + R(A.sum.total), W / 2, y + 5.8, { align: 'center' });
  y += 16;
  const newPage = () => {
    pdf.addPage(); y = 14; font(9, 1); color(C.ink); pdf.text(biz, M, y + 2); font(7.5); color(C.gray); pdf.text('E-Statement  -  ' + periode, W - M, y + 2, { align: 'right' });
    stroke(C.line); pdf.setLineWidth(.2); pdf.line(M, y + 5, W - M, y + 5); y += 12;
  };
  const sec = t => { if (y + 30 > H - 27) newPage(); fill(C.blue); pdf.rect(M, y - 3.4, 1.3, 4.6, 'F'); font(10, 1); color(C.ink); pdf.text(t, M + 3.5, y); y += 5; };
  const table = (cols, rows) => {
    const head = () => {
      fill(C.dark); pdf.roundedRect(M, y, TW, 7.5, 1.5, 1.5, 'F'); font(6.8, 1); color('#FFFFFF'); let x = M;
      cols.forEach(c => { const tx = c.a === 'r' ? x + c.w - 2.5 : c.a === 'c' ? x + c.w / 2 : x + 2.5; pdf.text(c.l, tx, y + 4.8, { align: c.a === 'r' ? 'right' : c.a === 'c' ? 'center' : 'left' }); x += c.w; });
      y += 7.5;
    };
    if (y + 16 > H - 27) newPage(); head();
    rows.forEach((r, i) => {
      font(7.8, r._t); let lines = 1;
      const cells = cols.map(c => {
        const t = String(r[c.k] == null ? '' : r[c.k]); if (c.bar) return [''];
        if (c.wrap) { const a = pdf.splitTextToSize(t, c.w - 5).slice(0, c.wrap); lines = Math.max(lines, a.length); return a; }
        let s = t; while (pdf.getTextWidth(s) > c.w - 5 && s.length > 3) s = s.slice(0, -1); if (s !== t) s = s.slice(0, -2) + '..'; return [s];
      });
      const h = Math.max(6.8, 3.5 * lines + 3.2);
      if (y + h > H - 27) { newPage(); head(); }
      if (r._t) { fill(C.soft); pdf.rect(M, y, TW, h, 'F'); } else if (i % 2) { fill(C.zebra); pdf.rect(M, y, TW, h, 'F'); }
      font(7.8, r._t); color(r._t ? C.dark : C.ink); let x = M;
      cols.forEach((c, ci) => {
        if (c.bar) { if (r._s != null) { fill(C.line); pdf.roundedRect(x + 2.5, y + h / 2 - 1, c.w - 5, 2, 1, 1, 'F'); fill(C.blue); pdf.roundedRect(x + 2.5, y + h / 2 - 1, Math.max(1.2, (c.w - 5) * r._s), 2, 1, 1, 'F'); } }
        else cells[ci].forEach((ln, li) => pdf.text(ln, c.a === 'r' ? x + c.w - 2.5 : c.a === 'c' ? x + c.w / 2 : x + 2.5, y + 4.6 + li * 3.5, { align: c.a === 'r' ? 'right' : c.a === 'c' ? 'center' : 'left' }));
        x += c.w;
      });
      stroke(C.line); pdf.setLineWidth(.15); pdf.line(M, y + h, M + TW, y + h); y += h;
    });
    y += 8;
  };
  /* rekap harian / bulanan */
  sec(ST.group === 'month' ? 'Rekap Bulanan' : 'Rekap Harian');
  const gr = A.groups.map(g => ({ p: gLabel(g), trx: g.trx, it: g.items, dc: N(g.disc), tx: N(g.tax), tt: R(g.total) }));
  gr.push({ p: 'TOTAL', trx: A.sum.trx, it: A.sum.items, dc: N(A.sum.disc), tx: N(A.sum.tax), tt: R(A.sum.total), _t: true });
  table([{ k: 'p', l: 'PERIODE', w: 56 }, { k: 'trx', l: 'TRX', w: 16, a: 'r' }, { k: 'it', l: 'ITEM', w: 16, a: 'r' }, { k: 'dc', l: 'DISKON (Rp)', w: 28, a: 'r' }, { k: 'tx', l: 'PAJAK (Rp)', w: 26, a: 'r' }, { k: 'tt', l: 'TOTAL', w: 40, a: 'r' }], gr);
  /* metode bayar */
  sec('Per Metode Pembayaran');
  const pk = Object.keys(A.pay).sort((a, b) => A.pay[b].total - A.pay[a].total);
  table([{ k: 'm', l: 'METODE', w: 48 }, { k: 'trx', l: 'TRX', w: 20, a: 'r' }, { k: 'tt', l: 'TOTAL', w: 44, a: 'r' }, { k: 'b', l: 'PORSI', w: 52, bar: true }, { k: 'pc', l: '%', w: 18, a: 'r' }],
    pk.map(k => { const s = A.sum.total ? A.pay[k].total / A.sum.total : 0; return { m: PAYN[k] || k, trx: A.pay[k].trx, tt: R(A.pay[k].total), pc: (s * 100).toFixed(1) + '%', _s: s }; }));
  /* produk terlaris */
  sec('Produk Terlaris');
  const top = A.prods.slice(0, 10), tv = A.prods.reduce((a, p) => a + p[1].v, 0) || 1;
  table([{ k: 'n', l: 'NO', w: 12, a: 'c' }, { k: 'p', l: 'PRODUK', w: 74 }, { k: 'q', l: 'QTY', w: 18, a: 'r' }, { k: 'v', l: 'PENDAPATAN', w: 42, a: 'r' }, { k: 'b', l: 'PORSI', w: 36, bar: true }],
    top.map((p, i) => ({ n: i + 1, p: p[0], q: N(p[1].q), v: R(p[1].v), _s: p[1].v / tv })));
  /* rincian transaksi */
  if (ST.detail) {
    sec('Rincian Transaksi'); let cum = 0;
    table([{ k: 'no', l: 'NO TRANSAKSI', w: 28 }, { k: 'tg', l: 'WAKTU', w: 27 }, { k: 'it', l: 'ITEM', w: 55, wrap: 2 }, { k: 'mt', l: 'METODE', w: 18 }, { k: 'tt', l: 'TOTAL (Rp)', w: 26, a: 'r' }, { k: 'kc', l: 'KUMULATIF (Rp)', w: 28, a: 'r' }],
      L.map(s => { cum += s.total; const d = new Date(s.t); return { no: s.no, tg: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), it: s.items.map(i => i.name + ' x' + i.qty).join(', '), mt: PAYN[s.pay] || s.pay, tt: N(s.total), kc: N(cum) }; }));
  }
  /* footer tiap halaman */
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i); stroke(C.line); pdf.setLineWidth(.2); pdf.line(M, H - 14, W - M, H - 14);
    font(8, 1); color(C.ink); pdf.text('NotaSeru', M, H - 9); font(7.5); color(C.gray); pdf.text('  Aplikasi Nota & Keuangan UMKM', M + pdf.getTextWidth('NotaSeru') + 0.5, H - 9);
    pdf.text('Halaman ' + i + ' dari ' + n, W - M, H - 9, { align: 'right' });
    if (i === n) { pdf.setFont('helvetica', 'italic'); font(7); pdf.setFont('helvetica', 'italic'); color('#9AA3AF'); pdf.splitTextToSize('Laporan ini disusun otomatis berdasarkan data transaksi yang tercatat pada aplikasi NotaSeru dan bersifat informatif untuk kebutuhan pencatatan internal usaha.', TW).forEach((l, k) => pdf.text(l, M, H - 24 + k * 3.4)); }
  }
  return pdf.output('blob');
}

/* ---------- KATEGORI ---------- */
let CE = null;
function catOpen(c) {
  CE = { old: c, name: c }; const n = S.prods.filter(p => (p.cat || 'Lainnya') === c).length;
  openSh('cat', 'Ubah Kategori', `<div class="ksr-fl"><label>Nama kategori</label><input class="ksr-in" data-i="cat-name" value="${esc(c)}" maxlength="40"></div>
  <div style="font-size:12.5px;line-height:1.55;color:var(--txt-3);font-weight:600">${n} produk di kategori ini ikut berpindah. Jika nama sama dengan kategori lain, keduanya digabung.</div>`,
    `${c === 'Lainnya' ? '' : '<button class="ksr-btn dng" data-a="catdel" style="flex:none">Hapus</button>'}<button class="ksr-btn block" data-a="catsave">Simpan</button>`);
}
async function catSave() {
  const nn = CE.name.trim(), old = CE.old; if (!nn) return toastK('Nama kategori wajib diisi', 'err'); if (nn === old) return closeSh();
  const ps = S.prods.filter(p => (p.cat || 'Lainnya') === old); ps.forEach(p => { p.cat = nn === 'Lainnya' ? '' : nn; });
  await Promise.all(ps.map(saveProd)); if (S.cat === old) S.cat = nn; closeSh(); toastK('Kategori diubah'); renderPList();
}
async function catDel() {
  const old = CE.old, ps = S.prods.filter(p => (p.cat || 'Lainnya') === old);
  if (!confirm('Hapus kategori "' + old + '"? ' + ps.length + ' produk dipindah ke "Lainnya" (produk tidak dihapus).')) return;
  ps.forEach(p => { p.cat = ''; }); await Promise.all(ps.map(saveProd)); if (S.cat === old) S.cat = 'all'; closeSh(); toastK('Kategori dihapus'); renderPList();
}

/* ---------- dokumen cetak ---------- */
function saleDoc(s) {
  const sets = (typeof DB !== 'undefined') ? DB.get('settings', {}) : {}, n = NSPrint.nf, d = new Date(s.t);
  const addr = (S.cfg.addr || [sets.storeAddress || sets.address || '', sets.storePhone || sets.phone || ''].filter(Boolean).join('\n')).split('\n').filter(Boolean);
  const tot = [{ l: 'Subtotal', v: n(s.sub) }];
  if (s.disc) tot.push({ l: 'Diskon' + (s.discLbl ? ' ' + s.discLbl : ''), v: '-' + n(s.disc) });
  if (s.tax) tot.push({ l: 'Pajak ' + s.taxPct + '%', v: n(s.tax) });
  tot.push({ l: 'TOTAL', v: n(s.total), big: true }); tot.push({ l: PAYN[s.pay] || s.pay, v: n(s.paid) });
  if (s.pay === 'tunai') tot.push({ l: 'Kembali', v: n(s.change), bold: true });
  return { kind: 'receipt', title: 'STRUK PENJUALAN', drawer: s.pay === 'tunai',
    store: { name: storeName(), addr, logo: /^data:image\/(png|jpe?g|webp|gif)/.test(sets.logo || '') ? sets.logo : '' },
    meta: [['No', s.no], ['Tanggal', d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })], ['Kasir', S.cfg.kasir || ''], ['Ket', s.note || '']],
    items: s.items.map(i => ({ name: i.name, qty: i.qty, price: n(i.price), total: n(i.price * i.qty) })), totals: tot, footer: [S.cfg.foot || ''].filter(Boolean) };
}

/* ---------- event ---------- */
const A = {
  noop() {}, close() { closeSh(); }, tab: id => showTab(id), cat(id) { S.cat = id; renderChips(); renderGrid(); },
  inc: id => setQty(id, (S.cart[id] || 0) + 1), dec: id => setQty(id, (S.cart[id] || 0) - 1),
  cart() { if (calc().n) cartOpen(); }, swap: () => setMode('invoice'), mode: id => setMode(id),
  cfg: cfgOpen, newp: () => editP(null), editp: id => editP(id),
  dtype(id) { S.disc = { t: id, v: 0 }; cartRender(); },
  pay(id) { S.pay = id; cartRender(); },
  cashv(id) { S.cash = Number(id); const i = $('#ksrCashIn'); if (i) i.value = fmtNum(S.cash); updCashOnly(); },
  clear() { if (!confirm('Kosongkan semua pesanan?')) return; S.cart = {}; S.disc = { t: 'rp', v: 0 }; S.note = ''; saveCart(); closeSh(); if (S.tab === 'jual') renderGrid(); refreshBar(); },
  checkout, share: shareReceipt, print: printReceipt, delsale: delSale,
  viewsale(id) { const s = S.sales.find(x => x.id === id); if (s) receiptOpen(s, false); },
  range(id) { S.range = id; renderRiw(); },
  prn() { NSPrint.open(null); }, stmt: stmtOpen, rencat: catOpen, catsave: catSave, catdel: catDel,
  stpre(id) { stmtSet(id); stmtRender(); }, stgrp(id) { ST.group = id; stmtRender(); }, stfmt(id) { ST.fmt = id; stmtRender(); },
  stdet() { ST.detail = !ST.detail; $('#ksrStDet').classList.toggle('on', ST.detail); }, stgo: stmtGo,
  pick() { $('#ksrFile').click(); }, recrop() { if (E && E.img) applyPhoto(E.img, 0); }, rmimg() { E.img = null; E.info = ''; const b = $('#ksrShB'); b.innerHTML = editBody(); },
  setcat(id) { E.cat = id; const i = document.querySelector('[data-i="e-cat"]'); if (i) i.value = id; },
  trk() { E.track = !E.track; $('#ksrTrk').classList.toggle('on', E.track); $('#ksrStk').style.display = E.track ? '' : 'none'; },
  savep: saveP, delp: delP,
  cfgsave() { S.cfg.tax = Math.min(100, Math.max(0, parseFloat(String(S.cfg.tax).replace(',', '.')) || 0)); saveCfg(); $('#ksrStore').textContent = storeName(); closeSh(); toastK('Pengaturan disimpan'); refreshBar(); },
  bak() { window.backupData && window.backupData(); },
  rst() { const i = document.getElementById('restoreInput'); if (i) i.click(); else toastK('Restore ada di Mode Invoice → Akun', 'err'); },
  theme() { if (typeof toggleThemeFromHero === 'function') toggleThemeFromHero(); },
};
function onClick(e) { const t = e.target.closest('[data-a]'); if (!t) return; const f = A[t.dataset.a]; if (f) f(t.dataset.id, t, e); }
function onChange(e) { const t = e.target; if (t.dataset && t.dataset.c === 'qty') setQty(t.dataset.id, t.value, true); }
function onInput(e) {
  const t = e.target, k = t.dataset && t.dataset.i; if (!k) return;
  if (k === 'q') { S.q = t.value; renderGrid(); }
  else if (k === 'pq') { S.pq = t.value; renderPList(); }
  else if (k === 'note') S.note = t.value;
  else if (k === 'disc') { if (S.disc.t === 'rp') { S.disc.v = num(t.value); t.value = fmtNum(S.disc.v); } else { let v = parseFloat(t.value.replace(',', '.')) || 0; S.disc.v = Math.min(100, Math.max(0, v)); } updPay(); }
  else if (k === 'cash') { S.cash = num(t.value); t.value = fmtNum(S.cash); updCashOnly(); }
  else if (k === 'e-name') E.name = t.value;
  else if (k === 'e-price') { E.price = num(t.value); t.value = fmtNum(E.price); }
  else if (k === 'e-cat') E.cat = t.value;
  else if (k === 'e-stock') E.stock = num(t.value);
  else if (k === 'c-name') S.cfg.name = t.value; else if (k === 'c-addr') S.cfg.addr = t.value;
  else if (k === 'c-kasir') S.cfg.kasir = t.value; else if (k === 'cat-name') CE.name = t.value;
  else if (k === 'st-from' || k === 'st-to') { if (k === 'st-from') ST.from = t.value; else ST.to = t.value; ST.pre = 'custom'; document.querySelectorAll('[data-a=stpre]').forEach(b => b.classList.remove('on')); stmtInfo(); }
  else if (k === 'c-tax') S.cfg.tax = t.value; else if (k === 'c-foot') S.cfg.foot = t.value;
}

/* ---------- backup & restore (gabung dengan fitur lama) ---------- */
async function patchBackup() {
  window.backupData = async function () {
    await ready;
    const data = { invoices: DB.get('invoices', []), expenses: DB.get('expenses', []), settings: DB.get('settings', {}), products: DB.get('products', []), warehouses: DB.get('warehouses', []), stockLog: DB.get('stockLog', []),
      kasir: { products: S.prods, sales: S.sales, cfg: S.cfg }, exportedAt: new Date().toISOString(), version: '3.1' };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `notaseru-backup-${new Date().toISOString().split('T')[0]}.json`; a.click();
    (typeof toast === 'function' ? toast : toastK)('Backup berhasil', 'ok');
  };
  window.handleRestore = function (input) {
    const file = input.files[0]; if (!file) return; const r = new FileReader();
    r.onload = async e => {
      try {
        const d = JSON.parse(e.target.result);
        if (!confirm('Restore data? Data saat ini akan diganti.')) return;
        if (d.invoices) DB.set('invoices', d.invoices); if (d.expenses) DB.set('expenses', d.expenses); if (d.products) DB.set('products', d.products);
        if (d.warehouses) DB.set('warehouses', d.warehouses); if (d.stockLog) DB.set('stockLog', d.stockLog);
        if (d.settings) { DB.set('settings', d.settings); if (typeof loadSettingsUI === 'function') loadSettingsUI(); if (typeof applyAppearance === 'function') applyAppearance(); }
        if (d.kasir) {
          await ready;
          S.prods = d.kasir.products || []; S.sales = (d.kasir.sales || []).sort((a, b) => b.t - a.t); if (d.kasir.cfg) Object.assign(S.cfg, d.kasir.cfg);
          S.cart = {}; saveCart();
          await persist(dbRun('products', s => { s.clear(); S.prods.forEach(p => s.put(p)); }));
          await persist(dbRun('sales', s => { s.clear(); S.sales.forEach(x => s.put(x)); })); await saveCfg();
          if (document.documentElement.classList.contains('kasir-mode')) showTab(S.tab);
        }
        (typeof toast === 'function' ? toast : toastK)('Data direstore', 'ok'); if (typeof renderDashboard === 'function') renderDashboard();
      } catch (err) { console.error(err); (typeof toast === 'function' ? toast : toastK)('File tidak valid', 'err'); }
    };
    r.readAsText(file); input.value = '';
  };
}

/* ---------- titik masuk dari Mode Invoice ---------- */
function injectEntryPoints() {
  const ha = document.querySelector('.hero-actions');
  if (ha && !$('#ksrHeroBtn')) {
    const b = document.createElement('button'); b.className = 'hero-btn'; b.id = 'ksrHeroBtn'; b.title = 'Pindah ke Mode Kasir'; b.setAttribute('aria-label', 'Pindah ke Mode Kasir');
    b.innerHTML = ic('swap', 18, 1.9); b.onclick = () => setMode('kasir'); ha.insertBefore(b, ha.firstChild);
  }
  const sec = document.querySelector('#page-settings .sett-section');
  if (sec && !$('#ksrSettCard')) {
    const d = document.createElement('div'); d.className = 'sett-section'; d.id = 'ksrSettCard';
    d.innerHTML = `<div class="sett-card"><div class="sett-row no-tap" style="padding:16px;display:block"><div class="sett-label" style="font-weight:800;margin-bottom:4px">Mode aplikasi</div><div class="sett-sub" style="margin-bottom:12px">Sekarang: <b>Invoice</b>. Pindah ke Mode Kasir untuk jualan langsung dengan katalog produk berfoto.</div><button class="ksr-btn block" style="border:0;font-family:inherit;cursor:pointer" onclick="window.NSKasir.setMode('kasir')">Buka Mode Kasir</button><button class="ksr-btn ghost block" style="border:0;font-family:inherit;cursor:pointer;margin-top:8px" onclick="window.NSPrint.open(null)">Printer &amp; ukuran kertas</button></div></div>`;
    sec.parentNode.insertBefore(d, sec);
  }
}

/* ---------- boot ---------- */
function boot() {
  build(); patchBackup(); injectEntryPoints();
  load().then(() => {
    $('#ksrStore').textContent = storeName();
    let m = null; try { m = localStorage.getItem(MODE_KEY); } catch (e) {}
    if (m === 'kasir') setMode('kasir');
    else if (m === 'invoice') document.documentElement.classList.remove('kasir-boot');
    else $('#ksrMode').classList.add('on');
  });
}
window.NSKasir = { setMode, state: S };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

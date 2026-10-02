/* =========================================================
   GUDANG & STOK
   ---------------------------------------------------------
   Data:
     products[]   -> + trackStock, stockBase, stockStart, minStock,
                       cost, sku, warehouseId
     warehouses[] -> { id, name, note }
     stockLog[]   -> riwayat gerak stok MANUAL (init/in/out/set)

   Cara hitung (selalu sinkron dengan nota):
     terjual = total qty item nota yang tertaut ke produk
               (nota dibuat setelah stok mulai dilacak)
     sisa    = stockBase (stok awal + masuk - keluar +/- koreksi) - terjual
   Karena terjual dihitung langsung dari daftar nota, edit / hapus nota
   otomatis mengembalikan atau mengurangi stok tanpa data ganda.
   ========================================================= */

let _gdTab = 'stok';
let _gdWh = 'all';
let _gdQuery = '';
let _smType = 'in';
let _gdMemo = null;

// ── Helper dasar ───────────────────────────────────────────
function gdProducts()   { return DB.get('products', []) || []; }
function gdWarehouses() { return DB.get('warehouses', []) || []; }
function gdLog()        { return DB.get('stockLog', []) || []; }
function gdNorm(s)      { return String(s || '').trim().toLowerCase(); }
function gdInvTime(inv) { return Number(inv && inv.createdAt) || Date.parse(inv && inv.date) || 0; }

function gdNum(v) {
  const n = parseFloat(String(v == null ? '' : v).trim().replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function fmtQty(n) {
  n = Math.round((Number(n) || 0) * 100) / 100;
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
function gdPlain(n) { return String(Math.round((Number(n) || 0) * 100) / 100); }

function gdFmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ── Hitung terjual & sisa dari nota ────────────────────────
function gdSalesMap(prods, invs, excludeInvId) {
  const idSet = new Set(prods.map(p => p.id));
  const tracked = {};
  const byName = {};
  prods.forEach(p => {
    if (p.trackStock) tracked[p.id] = p;
    const k = gdNorm(p.name);
    if (k && !(k in byName)) byName[k] = p.id;
  });
  const map = {};
  (invs || []).forEach(inv => {
    if (!inv || inv.id === excludeInvId) return;
    const t = gdInvTime(inv);
    (inv.items || []).forEach(it => {
      const pid = (it.productId && idSet.has(it.productId)) ? it.productId : byName[gdNorm(it.name)];
      const p = tracked[pid];
      if (!p) return;
      if (t < (p.stockStart || 0)) return;
      const q = Number(it.qty) || 0;
      if (q <= 0) return;
      const e = map[pid] || (map[pid] = { sold: 0, lines: [] });
      e.sold += q;
      e.lines.push({ inv, qty: q, t });
    });
  });
  return map;
}

// Cache: hitung ulang hanya kalau data nota/produk berubah
function gdSalesCached() {
  const a = localStorage.getItem('ns3_invoices') || '';
  const b = localStorage.getItem('ns3_products') || '';
  if (_gdMemo && _gdMemo.a === a && _gdMemo.b === b) return _gdMemo.map;
  const map = gdSalesMap(gdProducts(), DB.get('invoices', []) || []);
  _gdMemo = { a, b, map };
  return map;
}

function gdStat(p, map) {
  const sold = (map[p.id] && map[p.id].sold) || 0;
  const base = Number(p.stockBase) || 0;
  const sisa = base - sold;
  const min = Number(p.minStock) || 0;
  let state = 'off';
  if (p.trackStock) state = sisa <= 0 ? 'out' : (min > 0 && sisa <= min) ? 'low' : 'ok';
  return { sold, base, sisa, min, state };
}

const GD_STATE = {
  ok:  { label: 'Aman',      cls: 'badge badge-lunas', color: 'var(--success)' },
  low: { label: 'Menipis',   cls: 'badge badge-dp',    color: 'var(--warning)' },
  out: { label: 'Habis',     cls: 'badge badge-belum', color: 'var(--danger)'  },
  off: { label: 'Tidak dilacak', cls: 'badge', color: 'var(--txt-3)' }
};

function gdPushLog(entry) {
  const log = gdLog();
  log.unshift(Object.assign({
    id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ts: Date.now()
  }, entry));
  DB.set('stockLog', log.slice(0, 1000));
}

// ── Label kecil di katalog & pemilih produk ────────────────
function gdCatalogStockLabel(p) {
  if (!p || !p.trackStock) return '';
  const st = gdStat(p, gdSalesCached());
  return ' · <span style="color:' + GD_STATE[st.state].color + ';font-weight:700">Stok: ' + fmtQty(st.sisa) + '</span>';
}
function gdPickerStockLabel(p) {
  if (!p || !p.trackStock) return '';
  const st = gdStat(p, gdSalesCached());
  return '<div style="font-size:10px;font-weight:700;margin-top:2px;color:' + GD_STATE[st.state].color + '">Stok: ' + fmtQty(st.sisa) + '</div>';
}

function gdUpdateEntry() {
  const el = document.getElementById('gudangEntrySub');
  if (!el) return;
  const tr = gdProducts().filter(p => p.trackStock);
  if (!tr.length) { el.textContent = 'Atur stok, pantau sisa & terjual, kelola gudang'; return; }
  const map = gdSalesCached();
  let need = 0;
  tr.forEach(p => { const s = gdStat(p, map).state; if (s === 'out' || s === 'low') need++; });
  el.textContent = tr.length + ' produk dilacak' + (need ? ' · ' + need + ' perlu restok' : '');
}

// Setelah katalog digambar ulang, segarkan ringkasan di Pengaturan
if (typeof renderCatalogList === 'function') {
  const _origRenderCatalog = renderCatalogList;
  renderCatalogList = function () { _origRenderCatalog.apply(this, arguments); gdUpdateEntry(); };
}

// ── Integrasi dengan nota ──────────────────────────────────
// Tautkan item nota ke produk katalog (berdasarkan nama) supaya stok
// tetap terhitung walaupun nama produk diubah di kemudian hari.
function gdLinkItems(itemsArr) {
  const prods = gdProducts();
  const idSet = new Set(prods.map(p => p.id));
  const byName = {};
  prods.forEach(p => { const k = gdNorm(p.name); if (k && !(k in byName)) byName[k] = p.id; });
  (itemsArr || []).forEach(it => {
    if (it.productId && idSet.has(it.productId)) return;
    const pid = byName[gdNorm(it.name)];
    if (pid) it.productId = pid; else delete it.productId;
  });
}

// Peringatan sebelum simpan nota kalau stok tidak cukup. true = lanjut simpan.
function gdConfirmStock(itemsArr, invId) {
  const prods = gdProducts();
  if (!prods.some(p => p.trackStock)) return true;
  const invs = DB.get('invoices', []) || [];
  const existing = invId ? invs.find(i => i.id === invId) : null;
  const t = existing ? gdInvTime(existing) : Date.now();
  const map = gdSalesMap(prods, invs, invId);
  const need = {};
  (itemsArr || []).forEach(it => {
    if (!it.productId) return;
    need[it.productId] = (need[it.productId] || 0) + (Number(it.qty) || 0);
  });
  const short = [];
  Object.keys(need).forEach(pid => {
    const p = prods.find(x => x.id === pid);
    if (!p || !p.trackStock) return;
    if (t < (p.stockStart || 0)) return;
    const avail = (Number(p.stockBase) || 0) - ((map[pid] && map[pid].sold) || 0);
    if (need[pid] > avail + 1e-9) {
      short.push('• ' + p.name + ': butuh ' + fmtQty(need[pid]) + ' ' + (p.unit || 'pcs') + ', tersedia ' + fmtQty(Math.max(avail, 0)));
    }
  });
  if (!short.length) return true;
  return confirm('Stok tidak cukup:\n' + short.join('\n') + '\n\nTetap simpan nota? Stok akan tercatat minus.');
}

// Setelah nota tersimpan: kabari kalau ada produk yang habis / menipis
function gdNotifyLowStock(inv) {
  try {
    const prods = gdProducts();
    const map = gdSalesCached();
    const seen = new Set();
    let shown = 0;
    (inv.items || []).forEach(it => {
      if (shown >= 2 || !it.productId || seen.has(it.productId)) return;
      seen.add(it.productId);
      const p = prods.find(x => x.id === it.productId);
      if (!p || !p.trackStock) return;
      const st = gdStat(p, map);
      if (st.state === 'out') { toast('Stok "' + p.name + '" habis', 'wrn'); shown++; }
      else if (st.state === 'low') { toast('Stok "' + p.name + '" tinggal ' + fmtQty(st.sisa) + ' ' + (p.unit || 'pcs'), 'wrn'); shown++; }
    });
  } catch (e) { console.warn('[NS] gdNotifyLowStock', e); }
}

// ── Form produk (field stok) ───────────────────────────────
function gdToggleTrackUI() {
  const on = document.getElementById('prodTrack')?.checked;
  const box = document.getElementById('prodStockFields');
  if (box) box.style.display = on ? '' : 'none';
}

function gdFillWarehouseSelect(selId, selected) {
  const sel = document.getElementById('prodWarehouse');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Tanpa gudang —</option>' +
    gdWarehouses().map(w => '<option value="' + xss(w.id) + '">' + xss(w.name) + '</option>').join('');
  sel.value = selected || '';
}

function gdFillProductForm(p) {
  const tracked = !!(p && p.trackStock);
  const $ = id => document.getElementById(id);
  $('prodTrack').checked = p ? tracked : true; // produk baru: stok langsung dilacak
  $('prodMinStock').value = p && p.minStock > 0 ? gdPlain(p.minStock) : '';
  $('prodSku').value = (p && p.sku) || '';
  $('prodCost').value = p && p.cost > 0 ? fmtRp(p.cost) : '';
  let defWh = p ? (p.warehouseId || '') : ((_gdWh !== 'all' && _gdWh !== '_none') ? _gdWh : '');
  gdFillWarehouseSelect('prodWarehouse', defWh);
  const info = $('prodStockInfo');
  if (tracked) {
    const st = gdStat(p, gdSalesCached());
    $('prodStockLabel').textContent = 'Sisa Stok Saat Ini';
    $('prodStock').value = gdPlain(st.sisa);
    if (info) {
      info.style.display = '';
      info.textContent = 'Terjual otomatis dari nota: ' + fmtQty(st.sold) + ' ' + (p.unit || 'pcs') +
        '. Mengubah angka sisa di sini dicatat sebagai koreksi di Riwayat.';
    }
  } else {
    $('prodStockLabel').textContent = 'Stok Awal';
    $('prodStock').value = '';
    if (info) info.style.display = 'none';
  }
  gdToggleTrackUI();
}

// Dipanggil saveProduct(): gabungkan field stok ke objek produk. false = batal simpan.
function gdMergeProductStock(prod, old) {
  const $ = id => document.getElementById(id);
  const track = !!$('prodTrack')?.checked;
  const raw = ($('prodStock')?.value || '').trim();
  const typed = gdNum(raw);
  if (track && typed < 0) { toast('Stok tidak boleh negatif', 'err'); return false; }

  // pertahankan data lama
  prod.trackStock = old ? !!old.trackStock : false;
  prod.stockBase = old ? (Number(old.stockBase) || 0) : 0;
  prod.stockStart = old ? (old.stockStart || 0) : 0;

  prod.sku = ($('prodSku')?.value || '').trim();
  prod.cost = parseMoney($('prodCost')?.value || '0');
  prod.minStock = Math.max(0, gdNum($('prodMinStock')?.value || '0'));
  prod.warehouseId = $('prodWarehouse')?.value || '';

  if (!track) { prod.trackStock = false; return true; }

  if (!old || !old.trackStock) {
    // Baru dilacak: stok awal = angka yang diisi, hitung terjual mulai sekarang
    prod.trackStock = true;
    prod.stockStart = Date.now();
    prod.stockBase = typed;
    gdPushLog({ productId: prod.id, productName: prod.name, type: 'init', qty: typed, before: 0, after: typed, note: 'Stok awal' });
  } else {
    prod.trackStock = true;
    const cur = gdStat(old, gdSalesCached()).sisa;
    if (raw !== '' && Math.abs(typed - cur) > 1e-9) {
      const delta = typed - cur;
      prod.stockBase = (Number(old.stockBase) || 0) + delta;
      gdPushLog({ productId: prod.id, productName: prod.name, type: 'set', qty: delta, before: cur, after: typed, note: 'Koreksi dari form produk' });
    }
  }
  return true;
}

// ── Navigasi dari Pengaturan ───────────────────────────────
function openGudangProductForm() {
  nav('gudang');
  setTimeout(() => openProductForm(), 150);
}

function gdEnableTracking(id) {
  openProductForm(id);
  const c = document.getElementById('prodTrack');
  if (c) { c.checked = true; gdToggleTrackUI(); }
  const l = document.getElementById('prodStockLabel'); if (l) l.textContent = 'Stok Awal';
}

function gdHeaderAdd() {
  if (_gdTab === 'gudang') openWarehouseForm(); else openProductForm();
}

// ── Gerak stok manual (masuk / keluar / atur sisa) ─────────
function openStockMove(pid) {
  const p = gdProducts().find(x => x.id === pid);
  if (!p) return;
  if (!p.trackStock) { gdEnableTracking(pid); return; }
  const st = gdStat(p, gdSalesCached());
  document.getElementById('smProdId').value = pid;
  document.getElementById('smTitle').textContent = 'Atur Stok · ' + p.name;
  document.getElementById('smInfo').innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:10px"><span>Sisa stok</span><b>' + fmtQty(st.sisa) + ' ' + xss(p.unit || 'pcs') + '</b></div>' +
    '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:4px;color:var(--txt-2)"><span>Terjual (dari nota)</span><b>' + fmtQty(st.sold) + ' ' + xss(p.unit || 'pcs') + '</b></div>';
  document.getElementById('smQty').value = '';
  document.getElementById('smNote').value = '';
  const first = document.querySelector('#smType .chip');
  smSetType('in', first);
  openSheet('stockMoveSheet');
}

function smSetType(type, el) {
  _smType = type;
  document.querySelectorAll('#smType .chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  const lbl = { in: 'Jumlah Masuk', out: 'Jumlah Keluar / Rusak', set: 'Sisa Stok Sebenarnya (Stok Opname)' };
  document.getElementById('smQtyLabel').textContent = lbl[type] || 'Jumlah';
  smPreview();
}

function smPreview() {
  const box = document.getElementById('smPreviewBox');
  if (!box) return;
  const p = gdProducts().find(x => x.id === document.getElementById('smProdId').value);
  const raw = (document.getElementById('smQty').value || '').trim();
  if (!p || raw === '') { box.textContent = ''; return; }
  const cur = gdStat(p, gdSalesCached()).sisa;
  const q = gdNum(raw);
  const after = _smType === 'in' ? cur + q : _smType === 'out' ? cur - q : q;
  box.style.color = after < 0 ? 'var(--danger)' : 'var(--txt-2)';
  box.textContent = 'Sisa setelah disimpan: ' + fmtQty(after) + ' ' + (p.unit || 'pcs');
}

function saveStockMove() {
  const pid = document.getElementById('smProdId').value;
  const prods = gdProducts();
  const idx = prods.findIndex(x => x.id === pid);
  if (idx < 0) return;
  const p = prods[idx];
  const raw = (document.getElementById('smQty').value || '').trim();
  const q = gdNum(raw);
  const note = (document.getElementById('smNote').value || '').trim();
  if (raw === '' || q < 0 || ((_smType === 'in' || _smType === 'out') && q <= 0)) {
    toast('Isi jumlah yang valid', 'err'); return;
  }
  const cur = gdStat(p, gdSalesCached()).sisa;
  let delta;
  if (_smType === 'in') delta = q;
  else if (_smType === 'out') delta = -q;
  else delta = q - cur;
  const after = cur + delta;
  if (after < 0 && !confirm('Sisa stok akan menjadi minus (' + fmtQty(after) + '). Tetap simpan?')) return;
  if (Math.abs(delta) < 1e-9) { toast('Tidak ada perubahan stok', 'wrn'); return; }

  prods[idx] = Object.assign({}, p, { stockBase: (Number(p.stockBase) || 0) + delta });
  DB.set('products', prods);
  gdPushLog({ productId: p.id, productName: p.name, type: _smType, qty: delta, before: cur, after, note });
  closeSheets();
  toast('Stok "' + p.name + '" diperbarui', 'ok');
  renderGudang();
  if (typeof renderCatalogList === 'function') renderCatalogList();
}

// ── Gudang (CRUD) ──────────────────────────────────────────
function openWarehouseForm(id) {
  const w = id ? gdWarehouses().find(x => x.id === id) : null;
  document.getElementById('whFormTitle').textContent = w ? 'Edit Gudang' : 'Tambah Gudang';
  document.getElementById('editWhId').value = w ? w.id : '';
  document.getElementById('whName').value = w ? w.name : '';
  document.getElementById('whNote').value = w ? (w.note || '') : '';
  openSheet('gudangFormSheet');
}

function saveWarehouse() {
  const name = document.getElementById('whName').value.trim();
  if (!name) { toast('Nama gudang wajib diisi', 'err'); return; }
  const note = document.getElementById('whNote').value.trim();
  const eid = document.getElementById('editWhId').value;
  const list = gdWarehouses();
  if (list.some(w => w.id !== eid && gdNorm(w.name) === gdNorm(name))) { toast('Nama gudang sudah ada', 'err'); return; }
  if (eid) {
    const i = list.findIndex(w => w.id === eid);
    if (i !== -1) list[i] = Object.assign({}, list[i], { name, note });
  } else {
    list.push({ id: 'wh_' + Date.now(), name, note, createdAt: Date.now() });
  }
  DB.set('warehouses', list);
  closeSheets();
  toast('Gudang "' + name + '" disimpan', 'ok');
  renderGudang();
}

function deleteWarehouse(id) {
  const w = gdWarehouses().find(x => x.id === id);
  if (!w) return;
  const prods = gdProducts();
  const used = prods.filter(p => p.warehouseId === id).length;
  if (!confirm('Hapus gudang "' + w.name + '"?' + (used ? '\n' + used + ' produk di gudang ini akan menjadi "Tanpa gudang" (stok tidak hilang).' : ''))) return;
  if (used) DB.set('products', prods.map(p => p.warehouseId === id ? Object.assign({}, p, { warehouseId: '' }) : p));
  DB.set('warehouses', gdWarehouses().filter(x => x.id !== id));
  if (_gdWh === id) _gdWh = 'all';
  toast('Gudang dihapus', 'ok');
  renderGudang();
}

// ── Render halaman ─────────────────────────────────────────
function gdSetTab(tab, el) {
  _gdTab = tab;
  document.querySelectorAll('#gdTabs .chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderGudang();
}
function gdSetQuery(v) { _gdQuery = v || ''; renderGudang(true); }
function gdSetWh(v) { _gdWh = v || 'all'; renderGudang(); }

function gdFilteredProducts() {
  const q = gdNorm(_gdQuery);
  return gdProducts().filter(p => {
    if (_gdWh === '_none' && p.warehouseId) return false;
    if (_gdWh !== 'all' && _gdWh !== '_none' && p.warehouseId !== _gdWh) return false;
    if (q && !(gdNorm(p.name).includes(q) || gdNorm(p.sku).includes(q))) return false;
    return true;
  });
}

function renderGudang(keepFocus) {
  const body = document.getElementById('gdBody');
  if (!body) return;
  const whs = gdWarehouses();
  if (_gdWh !== 'all' && _gdWh !== '_none' && !whs.some(w => w.id === _gdWh)) _gdWh = 'all';

  // filter gudang
  const sel = document.getElementById('gdWhFilter');
  if (sel) {
    sel.innerHTML = '<option value="all">Semua gudang</option>' +
      whs.map(w => '<option value="' + xss(w.id) + '">' + xss(w.name) + '</option>').join('') +
      '<option value="_none">Tanpa gudang</option>';
    sel.value = _gdWh;
  }
  const filters = document.getElementById('gdFilters');
  if (filters) filters.style.display = _gdTab === 'gudang' ? 'none' : 'flex';
  const addBtn = document.getElementById('gdHeaderAddBtn');
  if (addBtn) addBtn.title = _gdTab === 'gudang' ? 'Tambah Gudang' : 'Tambah Produk';

  const map = gdSalesCached();
  gdRenderSummary(map);
  if (_gdTab === 'stok') body.innerHTML = gdStokHTML(map, whs);
  else if (_gdTab === 'riwayat') body.innerHTML = gdRiwayatHTML(map);
  else body.innerHTML = gdGudangHTML(map, whs);
  gdUpdateEntry();
}

function gdRenderSummary(map) {
  const box = document.getElementById('gdSummary');
  if (!box) return;
  const prods = gdProducts().filter(p => p.trackStock && (
    _gdWh === 'all' || (_gdWh === '_none' ? !p.warehouseId : p.warehouseId === _gdWh)));
  let sisa = 0, sold = 0, need = 0;
  prods.forEach(p => {
    const s = gdStat(p, map);
    sisa += Math.max(s.sisa, 0); sold += s.sold;
    if (s.state === 'out' || s.state === 'low') need++;
  });
  const card = (label, val, color) =>
    '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-md);padding:12px 14px">' +
    '<div style="font-size:11px;font-weight:600;color:var(--txt-3)">' + label + '</div>' +
    '<div style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin-top:2px;color:' + (color || 'var(--txt-1)') + '">' + val + '</div></div>';
  box.innerHTML =
    card('Produk Dilacak', prods.length) +
    card('Total Sisa Stok', fmtQty(sisa), 'var(--primary)') +
    card('Total Terjual', fmtQty(sold), 'var(--success)') +
    card('Perlu Restok', need, need ? 'var(--danger)' : 'var(--txt-1)');
}

function gdEmpty(title, sub) {
  return '<div style="text-align:center;padding:36px 16px">' +
    '<div style="margin-bottom:8px;color:var(--txt-3)"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg></div>' +
    '<div style="font-size:14px;font-weight:700;color:var(--txt-1);margin-bottom:4px">' + title + '</div>' +
    '<div style="font-size:12px;color:var(--txt-3)">' + sub + '</div></div>';
}

function gdStokHTML(map, whs) {
  const list = gdFilteredProducts();
  if (!gdProducts().length) return gdEmpty('Belum ada produk', 'Ketuk + di kanan atas untuk menambah produk dan mengisi stok');
  if (!list.length) return gdEmpty('Produk tidak ditemukan', 'Coba ganti kata kunci atau filter gudang');
  const order = { out: 0, low: 1, ok: 2, off: 3 };
  const rows = list.map(p => ({ p, st: gdStat(p, map) }))
    .sort((a, b) => order[a.st.state] - order[b.st.state] || a.p.name.localeCompare(b.p.name));
  return rows.map(({ p, st }) => {
    const S = GD_STATE[st.state];
    const wh = whs.find(w => w.id === p.warehouseId);
    const unit = xss(p.unit || 'pcs');
    const meta = [wh ? xss(wh.name) : 'Tanpa gudang', p.sku ? 'SKU ' + xss(p.sku) : '', p.price > 0 ? fmtRp(p.price) : ''].filter(Boolean).join(' · ');
    const stats = p.trackStock ? (
      '<div style="display:grid;grid-template-columns:repeat(' + (p.cost > 0 ? 3 : 2) + ',1fr);gap:8px;margin-top:10px">' +
        '<div style="background:var(--bg-input);border-radius:var(--r-sm);padding:8px 10px"><div style="font-size:10px;color:var(--txt-3);font-weight:600">Sisa</div><div style="font-size:15px;font-weight:800;color:' + S.color + '">' + fmtQty(st.sisa) + ' <span style="font-size:10px;font-weight:600">' + unit + '</span></div></div>' +
        '<div style="background:var(--bg-input);border-radius:var(--r-sm);padding:8px 10px"><div style="font-size:10px;color:var(--txt-3);font-weight:600">Terjual</div><div style="font-size:15px;font-weight:800;color:var(--txt-1)">' + fmtQty(st.sold) + ' <span style="font-size:10px;font-weight:600">' + unit + '</span></div></div>' +
        (p.cost > 0 ? '<div style="background:var(--bg-input);border-radius:var(--r-sm);padding:8px 10px"><div style="font-size:10px;color:var(--txt-3);font-weight:600">Nilai Stok</div><div style="font-size:13px;font-weight:800;color:var(--txt-1)">' + fmtRp(Math.max(st.sisa, 0) * p.cost) + '</div></div>' : '') +
      '</div>' +
      (st.min > 0 ? '<div style="font-size:10.5px;color:var(--txt-3);margin-top:6px">Batas menipis: ' + fmtQty(st.min) + ' ' + unit + '</div>' : '')
    ) : '<div style="font-size:12px;color:var(--txt-3);margin-top:8px">Stok produk ini belum dilacak.</div>';
    const btnStyle = 'padding:7px 12px;border-radius:var(--r-xs);border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font);';
    const actions = p.trackStock
      ? '<button onclick="openStockMove(\'' + p.id + '\')" style="' + btnStyle + 'background:var(--primary);color:#fff;flex:1;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.2"/><circle cx="15" cy="16" r="2.2"/></svg>Atur Stok</button>'
      : '<button onclick="gdEnableTracking(\'' + p.id + '\')" style="' + btnStyle + 'background:var(--primary);color:#fff;flex:1">Aktifkan Stok</button>';
    return '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-lg);padding:14px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:38px;height:38px;border-radius:var(--r-sm);background:var(--primary-soft);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' + (p.emoji ? xss(p.emoji) : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>') + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + xss(p.name) + '</div>' +
        '<div style="font-size:11px;color:var(--txt-3);margin-top:1px">' + meta + '</div></div>' +
        '<span class="' + S.cls + '" style="flex-shrink:0">' + S.label + '</span>' +
      '</div>' + stats +
      '<div style="display:flex;gap:8px;margin-top:12px">' + actions +
        '<button onclick="openProductForm(\'' + p.id + '\')" style="' + btnStyle + 'background:var(--warning-soft);color:var(--warning)">Edit</button>' +
      '</div></div>';
  }).join('');
}

function gdRiwayatHTML(map) {
  const prods = gdProducts();
  const allowed = new Set(gdFilteredProducts().map(p => p.id));
  const q = gdNorm(_gdQuery);
  const entries = [];
  // gerak stok manual
  gdLog().forEach(l => {
    const inProds = prods.some(p => p.id === l.productId);
    if (inProds) { if (!allowed.has(l.productId)) return; }
    else if (_gdWh !== 'all' || (q && !gdNorm(l.productName).includes(q))) return;
    entries.push({ ts: l.ts, kind: 'manual', l });
  });
  // penjualan dari nota
  prods.forEach(p => {
    if (!allowed.has(p.id)) return;
    const e = map[p.id]; if (!e) return;
    e.lines.forEach(ln => entries.push({ ts: ln.t, kind: 'sale', p, ln }));
  });
  if (!entries.length) return gdEmpty('Belum ada riwayat stok', 'Gerak stok & penjualan dari nota akan muncul di sini');
  entries.sort((a, b) => b.ts - a.ts);
  const typeLbl = { init: 'Stok awal', in: 'Stok masuk', out: 'Stok keluar', set: 'Penyesuaian stok' };
  const rows = entries.slice(0, 150).map(e => {
    if (e.kind === 'sale') {
      const inv = e.ln.inv;
      return gdLogRow('−', 'var(--danger)', 'var(--danger-soft)', e.p.name,
        'Terjual · ' + xss((inv.number || '') + (inv.customer && inv.customer.name ? ' · ' + inv.customer.name : '')),
        e.ts, '−' + fmtQty(e.ln.qty) + ' ' + xss(e.p.unit || 'pcs'), 'var(--danger)');
    }
    const l = e.l;
    const pos = l.qty >= 0;
    const p = prods.find(x => x.id === l.productId);
    return gdLogRow(pos ? '+' : '−', pos ? 'var(--success)' : 'var(--danger)', pos ? 'var(--success-soft)' : 'var(--danger-soft)',
      l.productName || (p && p.name) || '-',
      (typeLbl[l.type] || 'Gerak stok') + (l.note ? ' · ' + xss(l.note) : '') + ' · sisa ' + fmtQty(l.before) + ' → ' + fmtQty(l.after),
      l.ts, (pos ? '+' : '−') + fmtQty(Math.abs(l.qty)) + ' ' + xss((p && p.unit) || ''), pos ? 'var(--success)' : 'var(--danger)');
  }).join('');
  return '<div style="font-size:11px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Riwayat Stok' +
    (entries.length > 150 ? ' (150 terbaru)' : '') + '</div>' + rows;
}

function gdLogRow(sign, color, bg, name, sub, ts, qtyTxt, qtyColor) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-md);margin-bottom:7px">' +
    '<div style="width:34px;height:34px;border-radius:var(--r-sm);background:' + bg + ';color:' + color + ';display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;flex-shrink:0">' + sign + '</div>' +
    '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + xss(name) + '</div>' +
    '<div style="font-size:11px;color:var(--txt-3);line-height:1.4">' + sub + '</div>' +
    '<div style="font-size:10.5px;color:var(--txt-3)">' + gdFmtTime(ts) + '</div></div>' +
    '<div style="font-size:13px;font-weight:700;color:' + qtyColor + ';flex-shrink:0;text-align:right">' + qtyTxt + '</div></div>';
}

function gdGudangHTML(map, whs) {
  const prods = gdProducts();
  const summarize = list => {
    let sisa = 0, tracked = 0, need = 0;
    list.forEach(p => {
      if (!p.trackStock) return;
      tracked++;
      const s = gdStat(p, map);
      sisa += Math.max(s.sisa, 0);
      if (s.state === 'out' || s.state === 'low') need++;
    });
    return { n: list.length, tracked, sisa, need };
  };
  const card = (title, note, sm, actions, id) =>
    '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-lg);padding:14px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:38px;height:38px;border-radius:var(--r-sm);background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21V12h6v9"/></svg></div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--txt-1)">' + xss(title) + '</div>' +
        (note ? '<div style="font-size:11px;color:var(--txt-3);margin-top:1px">' + xss(note) + '</div>' : '') + '</div>' +
        (actions || '') +
      '</div>' +
      '<div style="display:flex;gap:14px;margin-top:10px;font-size:12px;color:var(--txt-2);flex-wrap:wrap">' +
        '<span><b style="color:var(--txt-1)">' + sm.n + '</b> produk</span>' +
        '<span>Sisa stok <b style="color:var(--primary)">' + fmtQty(sm.sisa) + '</b></span>' +
        (sm.need ? '<span style="color:var(--danger);font-weight:700">' + sm.need + ' perlu restok</span>' : '') +
      '</div>' +
      (id ? '<button onclick="gdOpenWarehouse(\'' + id + '\')" style="margin-top:10px;width:100%;padding:8px;border-radius:var(--r-xs);border:1px solid var(--border-soft);background:var(--bg-input);color:var(--txt-1);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">Lihat stok gudang ini →</button>' : '') +
    '</div>';
  const btn = (fn, id, label, bg, col) =>
    '<button onclick="' + fn + '(\'' + id + '\')" style="padding:5px 10px;border-radius:var(--r-xs);background:' + bg + ';color:' + col + ';border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">' + label + '</button>';
  let html = '';
  if (!whs.length) {
    html += gdEmpty('Belum ada gudang', 'Ketuk + untuk menambah gudang, lalu pilih gudang saat mengisi produk');
  }
  whs.forEach(w => {
    html += card(w.name, w.note, summarize(prods.filter(p => p.warehouseId === w.id)),
      '<div style="display:flex;gap:6px;flex-shrink:0">' + btn('openWarehouseForm', w.id, 'Edit', 'var(--warning-soft)', 'var(--warning)') + btn('deleteWarehouse', w.id, 'Hapus', 'var(--danger-soft)', 'var(--danger)') + '</div>', w.id);
  });
  const none = prods.filter(p => !p.warehouseId || !whs.some(w => w.id === p.warehouseId));
  if (none.length && whs.length) html += card('Tanpa Gudang', 'Produk yang belum ditempatkan di gudang', summarize(none), '', '_none');
  return html;
}

function gdOpenWarehouse(id) {
  _gdWh = id;
  _gdTab = 'stok';
  document.querySelectorAll('#gdTabs .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  renderGudang();
  window.scrollTo(0, 0);
}

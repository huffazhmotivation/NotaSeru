'use strict';
/* ============================================
   NOTASERU v3 — script.js
   ============================================ */

// ── State ──────────────────────────────────
let curPage = 'dashboard', prevPage = 'dashboard';
let curInvId = null;
let items = [];
let invFilter = 'all';
let selectMode = false;
let selectedIds = new Set();

let incomeMonth = null;
let signHasContent = false;
let curTemplate = 'classic';
let curTplColor = 'amber'; // amber|navy|green|blue|gray
let curDiscType = 'persen';       // diskon total: 'persen' | 'rupiah'
let curDiscItemType = 'persen';   // diskon per item: 'persen' | 'rupiah'

// ── DB ─────────────────────────────────────
const DB = {
  get: (k, d = null) => { try { const v = localStorage.getItem('ns3_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ns3_' + k, JSON.stringify(v)); } catch {} },
};

// ── Boot ───────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Restore the user's standing default nota template/color so it keeps
  // applying until they actively choose a different one.
  const _bootSettings = DB.get('settings', {});
  if (_bootSettings.defaultTemplate) curTemplate = _bootSettings.defaultTemplate;
  if (_bootSettings.defaultTplColor) curTplColor = _bootSettings.defaultTplColor;
  applyAppearance();
  setGreeting();
  initDates();
  renderItems();
  genInvNum();
  renderDashboard();
  renderMonthChips();
  setupInstall();
  registerSW();
  populateEkspedisiSelect();
  initDiscToggle();
  initCalcSwipeClose();
  // Auth: wrap try-catch supaya error apapun tidak bikin blank
  try {
    if (typeof initAuth === 'function') await initAuth();
    else loadSettingsUI();
  } catch(e) {
    console.error('[NS] boot error', e);
    loadSettingsUI();
  } finally {
    // BUG FIX: sembunyikan boot splash setelah semua render + cek sesi login
    // selesai, apa pun hasilnya — supaya tidak ada teks/isi dashboard yang
    // kelihatan sekilas di belakang popup login saat pertama buka app.
    const splash = document.getElementById('bootSplash');
    if (splash) {
      splash.classList.add('boot-hide');
      setTimeout(() => splash.remove(), 300);
    }
  }
});

// ── Greeting ───────────────────────────────
function setGreeting() {
  const h = new Date().getHours();
  const g = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  const el = document.getElementById('greetTime');
  if (el) el.textContent = g;
}

function initDates() {
  const today = new Date().toISOString().split('T')[0];
  const d = document.getElementById('invDate'); if (d) d.value = today;
  const e = document.getElementById('expDate'); if (e) e.value = today;
}

// ── Navigation ─────────────────────────────
function saveFormDraft() {
  // Only save if we're on invoice-form page and form has meaningful content
  if (curPage !== 'invoice-form') return;
  const name = document.getElementById('custName')?.value || '';
  const phone = document.getElementById('custPhone')?.value || '';
  const addr = document.getElementById('custAddr')?.value || '';
  const hasContent = name || phone || addr || items.some(i => i.name || i.price > 0);
  if (!hasContent) { DB.set('formDraft', null); return; }
  const draft = {
    curInvId,
    number: document.getElementById('invNumber')?.value || '',
    date: document.getElementById('invDate')?.value || '',
    status: document.getElementById('invStatus')?.value || 'belum',
    custName: name, custPhone: phone, custAddr: addr,
    disc: document.getElementById('discInput')?.value || '',
    discType: curDiscType,
    ongkir: document.getElementById('ongkirInput')?.value || '',
    ekspedisi: document.getElementById('ekspedisiInput')?.value || '',
    dp: document.getElementById('dpInput')?.value || '',
    notes: document.getElementById('invNotes')?.value || '',
    template: curTemplate,
    tplColor: curTplColor,
    items: JSON.parse(JSON.stringify(items)),
    savedAt: Date.now()
  };
  DB.set('formDraft', draft);
}

function restoreFormDraft(draft) {
  curInvId = draft.curInvId || null;
  document.getElementById('invFormTitle').textContent = curInvId ? 'Edit Nota' : 'Buat Nota';
  document.getElementById('invNumber').value = draft.number || '';
  document.getElementById('invDate').value = draft.date || new Date().toISOString().split('T')[0];
  document.getElementById('invStatus').value = draft.status || 'belum';
  document.getElementById('custName').value = draft.custName || '';
  document.getElementById('custPhone').value = draft.custPhone || '';
  document.getElementById('custAddr').value = draft.custAddr || '';
  document.getElementById('discInput').value = draft.disc || '';
  setDiscType(draft.discType || 'persen');
  document.getElementById('ongkirInput').value = draft.ongkir || '';
  if (draft.ekspedisi) document.getElementById('ekspedisiInput').value = draft.ekspedisi;
  document.getElementById('dpInput').value = draft.dp || '';
  document.getElementById('invNotes').value = draft.notes || '';
  if (draft.template) selectTemplate(draft.template, null, false);
  items = draft.items && draft.items.length ? draft.items : [{ id: Date.now(), name: '', qty: 1, price: 0 }];
  const firstDiscItem = items.find(i => i.discItemType);
  curDiscItemType = firstDiscItem ? firstDiscItem.discItemType : 'persen';
  renderItems(); recalc();
  // Show draft banner
  const banner = document.getElementById('draftBanner');
  if (banner) banner.style.display = 'flex';
}

function clearFormDraft() { DB.set('formDraft', null); }

function nav(page) {
  // Save draft when leaving invoice-form
  if (curPage === 'invoice-form' && page !== 'invoice-form') {
    saveFormDraft();
  }
  prevPage = curPage;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nm = { dashboard:'nav-dashboard','invoice-list':'nav-invoice-list', income:'nav-income', expense:'nav-income', settings:'nav-settings' };
  const ni = nm[page]; if (ni) document.getElementById(ni)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Update akun row setiap kali masuk settings
  if (page === 'settings' && typeof updateSettAkunRow === 'function') updateSettAkunRow();
  if (page === 'invoice-form') {
    const draft = DB.get('formDraft', null);
    if (!curInvId && draft && draft.savedAt && (Date.now() - draft.savedAt < 3600000)) {
      // Has a fresh draft (< 1 hour old), restore it
      setTimeout(() => restoreFormDraft(draft), 0);
    } else if (!curInvId) {
      resetForm();
    }
  }
  if (page === 'invoice-list') renderInvList();
  if (page === 'preview') requestAnimationFrame(scalePreview);
  if (page === 'income') renderIncomePage();
  if (page === 'expense') renderExpensePage();
  if (page === 'dashboard') renderDashboard();
  if (page === 'settings') { renderCatalogList(); renderEkspedisiList(); selectTemplate(curTemplate || 'classic', null, false); selectTplColor(curTplColor || 'amber', false); }
  const el = document.getElementById('page-' + page);
  if (el) { el.classList.add('active'); curPage = page; window.scrollTo(0,0); }
  // BUG FIX: textarea auto-resize dihitung dengan benar hanya ketika elemen
  // sudah terlihat (display:block). Sebelumnya loadSettingsUI() cuma dipanggil
  // sekali saat boot, saat halaman settings masih display:none, sehingga
  // scrollHeight yang terukur 0 dan textarea (Catatan Pembayaran, Ucapan
  // Terima Kasih) jadi kepotong. Panggil ulang setelah halaman aktif & terlihat.
  if (page === 'settings') { requestAnimationFrame(() => requestAnimationFrame(loadSettingsUI)); }
}

function goBack() { nav(prevPage !== curPage ? prevPage : 'dashboard'); }

// ── WA Chat Parser ───────────────────────────
function parseWAForm(text) {
  if (!text || !text.trim()) return null;
  const result = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const patterns = {
    name: /^(nama\s*pelanggan|nama)\s*[:\-]\s*(.+)$/i,
    phone: /^(no\s*hp|no\.?\s*hp|nomor\s*hp|hp|telepon|whatsapp|wa)\s*[:\-]\s*(.+)$/i,
    address: /^(alamat|alamat\s*pengiriman)\s*[:\-]\s*(.+)$/i,
    order: /^(pesanan|order|item|barang)\s*[:\-]\s*(.+)$/i,
  };
  for (const line of lines) {
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = line.match(pattern);
      if (match && !result[key]) {
        result[key] = match[2].trim();
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function openWAImport() {
  // Create a simple modal sheet for pasting WA text
  const existing = document.getElementById('waImportSheet');
  if (existing) existing.remove();
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'waImportSheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-hd">
      <div class="sheet-title">📋 Tempel Chat WA</div>
      <button class="sheet-close" onclick="closeWAImport()">✕</button>
    </div>
    <div class="sheet-body">
      <p style="font-size:12px;color:var(--txt-3);margin-bottom:10px">Salin & tempel chat pesanan dari WhatsApp dengan format:<br><code style="background:var(--bg-input);padding:2px 6px;border-radius:4px;font-size:11px">Nama : ...<br>No HP : ...<br>Alamat : ...<br>Pesanan : ...</code></p>
      <textarea class="form-textarea" id="waPasteInput" rows="7" placeholder="Tempel chat WhatsApp di sini...&#10;&#10;Contoh:&#10;Nama : Budi Santoso&#10;No HP : 08123456789&#10;Alamat : Jl. Mawar No.5&#10;Pesanan : Kue Brownies 2 box"></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px" onclick="applyWAImport()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Isi Form Otomatis
      </button>
    </div>`;
  document.getElementById('app').appendChild(sheet);
  setTimeout(() => {
    sheet.classList.add('visible');
    document.getElementById('overlay').classList.add('visible');
    document.body.style.overflow = 'hidden';
    document.getElementById('waPasteInput').focus();
  }, 30);
}

function closeWAImport() {
  const sheet = document.getElementById('waImportSheet');
  if (sheet) { sheet.classList.remove('visible'); setTimeout(() => sheet.remove(), 300); }
  document.getElementById('overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function applyWAImport() {
  const text = document.getElementById('waPasteInput')?.value || '';
  const parsed = parseWAForm(text);
  if (!parsed) { toast('Format tidak dikenali. Pastikan ada Nama/HP/Alamat/Pesanan', 'err'); return; }
  if (parsed.name) document.getElementById('custName').value = parsed.name;
  if (parsed.phone) document.getElementById('custPhone').value = parsed.phone;
  if (parsed.address) document.getElementById('custAddr').value = parsed.address;
  if (parsed.order) {
    // Try to find item in catalog by name match
    const prods = DB.get('products', []);
    const orderText = parsed.order;
    // Parse qty like "2 box Brownies" or "Brownies 2"
    const qtyMatch = orderText.match(/(\d+)\s*(?:pcs|box|kg|buah|item)?/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
    // Find matching product
    const matched = prods.find(p => orderText.toLowerCase().includes(p.name.toLowerCase()));
    if (matched) {
      items = [{ id: Date.now(), name: matched.name, qty, price: matched.price || 0 }];
    } else {
      items = [{ id: Date.now(), name: orderText, qty: 1, price: 0 }];
    }
    renderItems(); recalc();
  }
  closeWAImport();
  let filled = [];
  if (parsed.name) filled.push('Nama');
  if (parsed.phone) filled.push('No HP');
  if (parsed.address) filled.push('Alamat');
  if (parsed.order) filled.push('Pesanan');
  toast(`✓ Terisi: ${filled.join(', ')}`, 'ok');
}


function resetForm() {
  clearFormDraft();
  curInvId = null;
  const banner = document.getElementById('draftBanner');
  if (banner) banner.style.display = 'none';
  items = [{ id: Date.now(), name: '', qty: 1, price: 0 }];
  document.getElementById('invFormTitle').textContent = 'Buat Nota';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('invDate').value = today;
  document.getElementById('invStatus').value = 'belum';
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custAddr').value = '';
  document.getElementById('discInput').value = '';
  setDiscType('persen');
  curDiscItemType = 'persen';
  document.getElementById('ongkirInput').value = '';
  const eInp = document.getElementById('ekspedisiInput'); if (eInp) eInp.value = '';
  const eSel = document.getElementById('ekspedisiSelect'); if (eSel) eSel.value = '';
  document.getElementById('dpInput').value = '';
  document.getElementById('invNotes').value = '';
  selectTemplate(curTemplate || 'classic', null, false);
  genInvNum();
  renderItems();
  recalc();
}

function genInvNum() {
  const invs = DB.get('invoices', []);
  const d = new Date();
  const ds = d.getFullYear().toString() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const cnt = invs.filter(i => i.number?.includes(ds)).length + 1;
  const el = document.getElementById('invNumber');
  if (el) el.value = `INV-${ds}-${String(cnt).padStart(3,'0')}`;
}

function addItem() {
  openProductPicker();
}

function addBlankItem() {
  items.push({ id: Date.now(), name: '', qty: 1, price: 0 });
  renderItems();
  closeSheets();
  // Focus nama item baru
  setTimeout(() => {
    const inputs = document.querySelectorAll('#itemsContainer .item-name-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 150);
}

function addItemFromProduct(prod) {
  items.push({ id: Date.now(), name: prod.name, qty: 1, price: prod.price || 0 });
  renderItems();
  recalc();
  closeSheets();
  toast(`"${prod.name}" ditambahkan`, 'ok');
}

function removeItem(id) {
  if (items.length === 1) { toast('Minimal satu item diperlukan', 'wrn'); return; }
  items = items.filter(i => i.id !== id);
  renderItems(); recalc();
}

function renderItems() {
  const c = document.getElementById('itemsContainer');
  if (!c) return;
  if (!items.length) items = [{ id: Date.now(), name: '', qty: 1, price: 0 }];
  c.innerHTML = items.map((item, idx) => `
    <div class="item-row" id="ir-${item.id}">
      <div class="item-row-hd">
        <div class="item-num">${idx+1}</div>
        <button class="item-del" onclick="removeItem(${item.id})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="position:relative;margin-bottom:8px">
        <input type="text" class="form-input item-name-input" style="font-size:14px;padding-right:40px" placeholder="Nama barang / layanan" value="${xss(item.name)}"
          oninput="updItem(${item.id},'name',this.value);showSuggest(${item.id},this.value)"
          onfocus="showSuggest(${item.id},this.value)"
          onblur="hideSuggest(${item.id})"
          autocomplete="off">
        <button onclick="openProductPicker(${item.id})" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:var(--r-xs);background:var(--primary-soft);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--primary)" title="Pilih dari katalog produk">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </button>
        <div class="suggest-list" id="suggest-${item.id}" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--sh-lg);z-index:500;max-height:180px;overflow-y:auto"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Qty</div>
          <input type="number" class="form-input" style="padding:10px 12px;font-size:13px" min="1" placeholder="Qty" value="${item.qty || 1}" oninput="updItem(${item.id},'qty',this.value)" onblur="if(!this.value||parseInt(this.value)<1){this.value=1;updItem(${item.id},'qty',1);}">
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Harga</div>
          <input type="text" class="form-input" style="padding:10px 12px;font-size:13px" placeholder="Rp 0" value="${item.price > 0 ? fmtRp(item.price) : ''}" oninput="updItemPrice(${item.id},this)">
        </div>
      </div>
      <div style="margin-top:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:10px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Diskon/pcs</div>
          <div class="disc-toggle">
            <button class="disc-btn ${curDiscItemType==='persen'?'active':''}" onclick="setDiscItemType('persen')">%</button>
            <button class="disc-btn ${curDiscItemType==='rupiah'?'active':''}" onclick="setDiscItemType('rupiah')">Rp</button>
          </div>
        </div>
        <input type="text" class="form-input" style="padding:10px 12px;font-size:13px;width:100%;box-sizing:border-box" placeholder="${curDiscItemType==='rupiah'?'Rp 0':'0 %'}" value="${item.discItem > 0 ? (curDiscItemType==='rupiah' ? fmtRp(item.discItem) : String(item.discItem) + '%') : ''}" id="discItem-${item.id}" oninput="updItemDisc(${item.id},this)">
      </div>
      <div class="item-subtotal-row">
        <span class="ist-label">Subtotal</span>
        <span class="ist-val" id="ist-${item.id}">${fmtRp(calcItemTotal(item))}</span>
      </div>
    </div>`).join('');
}

function updItem(id, f, v) {
  const item = items.find(i => i.id === id); if (!item) return;
  if (f === 'qty') item.qty = Math.max(1, parseInt(v) || 1);
  else item[f] = v;
  const st = document.getElementById('ist-' + id);
  if (st) st.textContent = fmtRp(calcItemTotal(item));
  recalc();
}

// Calculate item total after per-item discount
function calcItemTotal(item) {
  const base = item.qty * item.price;
  const d = item.discItem || 0;
  if (!d) return base;
  if (item.discItemType === 'rupiah') return Math.max(0, base - d * item.qty);
  return Math.max(0, base - base * d / 100);
}

function updItemDisc(id, inp) {
  const item = items.find(i => i.id === id); if (!item) return;
  const raw = curDiscItemType === 'rupiah' ? parseMoney(inp.value) : (parseFloat(inp.value.replace('%','')) || 0);
  if (curDiscItemType === 'rupiah' && raw > 0) inp.value = fmtRp(raw);
  item.discItem = raw;
  item.discItemType = curDiscItemType;
  const st = document.getElementById('ist-' + id);
  if (st) st.textContent = fmtRp(calcItemTotal(item));
  recalc();
}

function setDiscItemType(type) {
  curDiscItemType = type;
  // Update all item discItem values — clear them (type changed, values no longer valid)
  items.forEach(item => {
    item.discItemType = type;
    item.discItem = 0;
  });
  renderItems();
  recalc();
}

function updItemPrice(id, input) {
  const raw = parseMoney(input.value);
  if (raw > 0) input.value = fmtRp(raw);
  const item = items.find(i => i.id === id); if (!item) return;
  item.price = raw;
  const st = document.getElementById('ist-' + id);
  if (st) st.textContent = fmtRp(calcItemTotal(item));
  recalc();
}

function recalc() {
  const sub = items.reduce((s,i) => s + calcItemTotal(i), 0);
  const discRaw = document.getElementById('discInput')?.value || '';
  const discVal = curDiscType === 'rupiah' ? parseMoney(discRaw) : (parseFloat(discRaw) || 0);
  const ongkir = parseMoney(document.getElementById('ongkirInput')?.value || '0');
  const dp = parseMoney(document.getElementById('dpInput')?.value || '0');
  let discAmt = curDiscType === 'rupiah' ? Math.min(discVal, sub) : (sub * discVal / 100);
  const grand = sub - discAmt + ongkir;
  const sisa = Math.max(0, grand - dp);
  setText('subtotalDisplay', fmtRp(sub));
  setText('grandDisplay', fmtRp(grand));
  setText('sisaDisplay', fmtRp(sisa));
}

function saveInvoice() {
  const name = document.getElementById('custName').value.trim();
  if (!name) { toast('Nama pelanggan wajib diisi', 'err'); return null; }
  if (items.every(i => !i.name.trim())) { toast('Isi minimal satu item', 'err'); return null; }
  const sub = items.reduce((s,i) => s + calcItemTotal(i), 0);
  const discRaw = document.getElementById('discInput').value || '';
  const disc = curDiscType === 'rupiah' ? parseMoney(discRaw) : (parseFloat(discRaw) || 0);
  const ongkir = parseMoney(document.getElementById('ongkirInput').value || '0');
  const dp = parseMoney(document.getElementById('dpInput').value || '0');
  const discAmt = curDiscType === 'rupiah' ? Math.min(disc, sub) : (sub * disc / 100);
  const grand = sub - discAmt + ongkir;
  const inv = {
    id: curInvId || Date.now().toString(),
    number: document.getElementById('invNumber').value,
    date: document.getElementById('invDate').value,
    status: document.getElementById('invStatus').value,
    customer: { name, phone: document.getElementById('custPhone').value, address: document.getElementById('custAddr').value },
    items: JSON.parse(JSON.stringify(items)),
    sub, disc, discType: curDiscType, discAmt, ongkir,
    ekspedisi: document.getElementById('ekspedisiInput')?.value || '',
    dp, grand, sisa: Math.max(0, grand - dp),
    notes: document.getElementById('invNotes').value,
    template: curTemplate,
    tplColor: curTplColor,
    updatedAt: Date.now()
  };
  const invs = DB.get('invoices', []);
  if (curInvId) {
    const idx = invs.findIndex(i => i.id === curInvId);
    if (idx !== -1) { inv.createdAt = invs[idx].createdAt; invs[idx] = inv; }
    else { inv.createdAt = Date.now(); invs.unshift(inv); }
  } else {
    inv.createdAt = Date.now();
    curInvId = inv.id;
    invs.unshift(inv);
  }
  DB.set('invoices', invs);
  clearFormDraft();
  toast('Nota disimpan ✓', 'ok');
  return inv;
}

function saveAndPreview() {
  const inv = saveInvoice();
  if (inv) { buildPreview(inv); nav('preview'); }
}

// ── Product Catalog ─────────────────────────
let _pickerTargetId = null; // item id yang sedang dipilih produknya

function openProductPicker(itemId = null) {
  _pickerTargetId = itemId;
  const s = document.getElementById('productSearch');
  if (s) s.value = '';
  renderProductPicker();
  openSheet('productPickerSheet');
}

function renderProductPicker(query = '') {
  const prods = DB.get('products', []);
  const q = query.toLowerCase().trim();
  const filtered = q ? prods.filter(p => p.name.toLowerCase().includes(q)) : prods;
  const list = document.getElementById('productPickerList');
  if (!list) return;

  const emptyProds = `
    <div style="text-align:center;padding:28px 16px">
      <div style="width:48px;height:48px;border-radius:var(--r-md);background:var(--bg-input);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;color:var(--txt-3)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--txt-1);margin-bottom:4px">Belum ada produk</div>
      <div style="font-size:12px;color:var(--txt-3)">Tambah produk di Pengaturan → Katalog Produk</div>
    </div>`;

  if (!filtered.length && !q) { list.innerHTML = emptyProds; return; }
  if (!filtered.length && q) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--txt-3);font-size:13px">Tidak ditemukan. Gunakan input manual.</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div onclick="selectProduct(${JSON.stringify(p).replace(/"/g,'&quot;')})"
      style="display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;border-bottom:1px solid var(--border-soft);transition:var(--ease)"
      onmousedown="event.preventDefault()"
      ontouchstart="event.preventDefault();selectProduct(${JSON.stringify(p).replace(/"/g,'&quot;')})">
      <div style="width:38px;height:38px;border-radius:var(--r-sm);background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px">
        ${p.emoji || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${xss(p.name)}</div>
        ${p.desc ? `<div style="font-size:11px;color:var(--txt-3);margin-top:1px">${xss(p.desc)}</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;font-weight:700;color:var(--primary)">${p.price > 0 ? fmtRp(p.price) : 'Bebas'}</div>
        <div style="font-size:10px;color:var(--txt-3);margin-top:2px">per ${p.unit || 'pcs'}</div>
      </div>
    </div>`).join('');
}

function selectProduct(prod) {
  if (_pickerTargetId !== null) {
    // Pilih untuk item yang sudah ada
    const item = items.find(i => i.id === _pickerTargetId);
    if (item) {
      item.name = prod.name;
      if (prod.price > 0) item.price = prod.price;
      renderItems(); recalc();
    }
  } else {
    // Tambah item baru dari produk
    addItemFromProduct(prod);
    return;
  }
  closeSheets();
  toast(`"${prod.name}" dipilih`, 'ok');
}

// Autocomplete suggest saat mengetik
let _suggestTimer = null;
function showSuggest(itemId, query) {
  clearTimeout(_suggestTimer);
  const box = document.getElementById(`suggest-${itemId}`);
  if (!box) return;
  const q = query.trim().toLowerCase();
  if (!q) { box.style.display = 'none'; return; }
  const prods = DB.get('products', []);
  const matched = prods.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
  if (!matched.length) { box.style.display = 'none'; return; }
  box.innerHTML = matched.map(p => `
    <div class="suggest-item" onmousedown="event.preventDefault();pickSuggest(${itemId},${JSON.stringify(p).replace(/"/g,"'")})"
      style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-soft)">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--txt-1)">${xss(p.name)}</div>
        ${p.desc ? `<div style="font-size:10px;color:var(--txt-3)">${xss(p.desc)}</div>` : ''}
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--primary);flex-shrink:0;margin-left:8px">${p.price > 0 ? fmtRp(p.price) : ''}</div>
    </div>`).join('');
  box.style.display = 'block';
}

function hideSuggest(itemId) {
  _suggestTimer = setTimeout(() => {
    const box = document.getElementById(`suggest-${itemId}`);
    if (box) box.style.display = 'none';
  }, 200);
}

function pickSuggest(itemId, prod) {
  const item = items.find(i => i.id === itemId);
  if (item) {
    item.name = prod.name;
    if (prod.price > 0) item.price = prod.price;
    renderItems(); recalc();
  }
  const box = document.getElementById(`suggest-${itemId}`);
  if (box) box.style.display = 'none';
}

// ── Product CRUD (Katalog) ──────────────────
function renderCatalogList() {
  const prods = DB.get('products', []);
  const list = document.getElementById('catalogList');
  if (!list) return;
  if (!prods.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--txt-3);font-size:13px">Belum ada produk. Ketuk + untuk menambah.</div>`;
    return;
  }
  list.innerHTML = prods.map(p => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-soft)">
      <div style="width:36px;height:36px;border-radius:var(--r-sm);background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
        ${p.emoji || '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--txt-1)">${xss(p.name)}</div>
        <div style="font-size:11px;color:var(--txt-3);margin-top:1px">${p.price > 0 ? fmtRp(p.price) : 'Harga bebas'} · ${p.unit || 'pcs'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="editProduct('${p.id}')" style="padding:5px 10px;border-radius:var(--r-xs);background:var(--warning-soft);color:var(--warning);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Edit</button>
        <button onclick="deleteProduct('${p.id}')" style="padding:5px 10px;border-radius:var(--r-xs);background:var(--danger-soft);color:var(--danger);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Hapus</button>
      </div>
    </div>`).join('');
}

function openProductForm(id = null) {
  if (id) {
    const p = DB.get('products', []).find(x => x.id === id);
    if (!p) return;
    document.getElementById('prodFormTitle').textContent = 'Edit Produk';
    document.getElementById('editProdId').value = p.id;
    document.getElementById('prodName').value = p.name;
    document.getElementById('prodPrice').value = p.price > 0 ? fmtRp(p.price) : '';
    document.getElementById('prodUnit').value = p.unit || 'pcs';
    document.getElementById('prodDesc').value = p.desc || '';
    document.getElementById('prodEmoji').value = p.emoji || '';
  } else {
    document.getElementById('prodFormTitle').textContent = 'Tambah Produk';
    document.getElementById('editProdId').value = '';
    document.getElementById('prodName').value = '';
    document.getElementById('prodPrice').value = '';
    document.getElementById('prodUnit').value = 'pcs';
    document.getElementById('prodDesc').value = '';
    document.getElementById('prodEmoji').value = '';
  }
  openSheet('productFormSheet');
}

function editProduct(id) { openProductForm(id); }

function saveProduct() {
  const name = document.getElementById('prodName').value.trim();
  if (!name) { toast('Nama produk wajib diisi', 'err'); return; }
  const prods = DB.get('products', []);
  const eid = document.getElementById('editProdId').value;
  const prod = {
    id: eid || Date.now().toString(),
    name,
    price: parseMoney(document.getElementById('prodPrice').value),
    unit: document.getElementById('prodUnit').value.trim() || 'pcs',
    desc: document.getElementById('prodDesc').value.trim(),
    emoji: document.getElementById('prodEmoji').value.trim(),
    createdAt: eid ? undefined : Date.now()
  };
  if (eid) {
    const idx = prods.findIndex(p => p.id === eid);
    prod.createdAt = idx !== -1 ? prods[idx].createdAt : Date.now();
    if (idx !== -1) prods[idx] = prod; else prods.push(prod);
  } else {
    prod.createdAt = Date.now();
    prods.push(prod);
  }
  DB.set('products', prods);
  toast(`Produk "${name}" disimpan ✓`, 'ok');
  renderCatalogList();
  if (typeof _fromPicker !== 'undefined' && _fromPicker) {
    _fromPicker = false;
    closeSheets();
    setTimeout(() => openProductPicker(_pickerTargetId), 150);
  } else {
    closeSheets();
  }
}

function deleteProduct(id) {
  if (!confirm('Hapus produk ini?')) return;
  DB.set('products', DB.get('products', []).filter(p => p.id !== id));
  toast('Produk dihapus', 'ok');
  renderCatalogList();
}

// ── Invoice List ────────────────────────────
function renderInvList() {
  const invs = DB.get('invoices', []);
  const q = document.getElementById('invSearch')?.value?.toLowerCase() || '';
  let f = invs;
  if (invFilter !== 'all') f = f.filter(i => i.status === invFilter);
  if (q) f = f.filter(i => i.customer?.name?.toLowerCase().includes(q) || i.number?.toLowerCase().includes(q));
  const cnt = document.getElementById('invListCount');
  if (cnt) cnt.textContent = `${f.length} nota`;
  const list = document.getElementById('allInvList');
  if (!list) return;
  if (!f.length) { list.innerHTML = emptyHTML('invoice', 'Belum Ada Nota', 'Buat nota pertama Anda sekarang'); return; }

  // Kelompokkan: grup dulu, lalu individual
  const renderedGrupKeys = new Set();
  const htmlParts = [];
  
  // Sort by date desc (same as before), tapi grup jadi satu blok
  const sorted = [...f].sort((a,b) => new Date(b.date||b.createdAt) - new Date(a.date||a.createdAt));

  let lastMonthKey = null;
  for (const inv of sorted) {
    const mKey = monthYearKey(inv.date || inv.createdAt);
    if (mKey !== lastMonthKey) {
      htmlParts.push(monthDividerHTML(inv.date || inv.createdAt));
      lastMonthKey = mKey;
    }
    if (inv.grupKey && inv.grupIds && inv.grupIds.length > 0) {
      if (renderedGrupKeys.has(inv.grupKey)) continue; // sudah dirender
      renderedGrupKeys.add(inv.grupKey);
      // Ambil semua anggota grup dari list yang terfilter
      const members = sorted.filter(i => i.grupKey === inv.grupKey);
      // Kalau ada anggota yang tidak ada di filter, tetap render grup dari DB
      const allMembers = invs.filter(i => i.grupKey === inv.grupKey);
      htmlParts.push(grupBlockHTML(inv.grupKey, allMembers));
    } else {
      htmlParts.push(invCardHTML(inv));
    }
  }
  
  list.innerHTML = htmlParts.join('');
}

// Key unik per bulan+tahun, untuk deteksi pergantian bulan pada daftar nota
function monthYearKey(s) {
  if (!s) return 'unknown';
  try { const d = new Date(s); return d.getFullYear() + '-' + d.getMonth(); } catch { return 'unknown'; }
}

// Garis pemisah minimalist antar bulan pada daftar nota
function monthDividerHTML(s) {
  let label = '-';
  try { label = new Date(s).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); } catch {}
  return `<div class="month-divider"><span>${xss(label)}</span></div>`;
}

// Palette warna untuk grup (berurutan)
const GRUP_COLORS = [
  { main:'#7C3AED', soft:'#EDE9FE', border:'#C4B5FD', text:'#5B21B6' },
  { main:'#0284C7', soft:'#E0F2FE', border:'#7DD3FC', text:'#0369A1' },
  { main:'#15803D', soft:'#DCFCE7', border:'#86EFAC', text:'#166534' },
  { main:'#D97706', soft:'#FEF3C7', border:'#FCD34D', text:'#92400E' },
  { main:'#E11D48', soft:'#FFE4E6', border:'#FECDD3', text:'#9F1239' },
  { main:'#0D9488', soft:'#CCFBF1', border:'#5EEAD4', text:'#0F766E' },
];

// Ambil warna berdasarkan grupKey (konsisten)
function _grupColor(grupKey) {
  let hash = 0;
  for (let i = 0; i < grupKey.length; i++) hash = (hash * 31 + grupKey.charCodeAt(i)) & 0xFFFFFF;
  return GRUP_COLORS[Math.abs(hash) % GRUP_COLORS.length];
}

function grupBlockHTML(grupKey, members) {
  const gdata = DB.get(grupKey, null);
  const grupName = gdata?.name || ('Grup ' + members.length + ' Nota');
  const totalOmset = members.reduce((s, i) => s + (i.grand || 0), 0);
  const totalExp = gdata ? gdata.expenses.reduce((s,e) => s+(e.amount||0), 0) : null;
  const profit = totalExp !== null ? totalOmset - totalExp : null;
  const profitClass = profit === null ? '' : profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'zero';
  const profitTxt = profit === null ? '' : (profit >= 0 ? '+' : '') + fmtRp(profit);
  const c = _grupColor(grupKey);
  
  const memberRows = members.map((inv, idx) => {
    const sm = { lunas:'Lunas', dp:'DP', belum:'Belum Bayar' };
    const statusColor = inv.status === 'lunas' ? 'var(--success)' : inv.status === 'dp' ? 'var(--warning)' : 'var(--txt-3)';
    const isFirst = idx === 0;
    const isLast = idx === members.length - 1;
    return `<div class="grup-member-row${isLast ? ' last' : ''}" onclick="viewInv('${inv.id}');event.stopPropagation()">
      <div class="grup-member-dot" style="background:${c.main}"></div>
      <div class="grup-member-info">
        <div class="grup-member-name">${xss(inv.customer?.name || '-')}</div>
        <div class="grup-member-sub">${xss(inv.number||'')} · ${fmtDate(inv.date)}</div>
      </div>
      <div style="text-align:right">
        <div class="grup-member-amt">${fmtRp(inv.grand||0)}</div>
        <div style="font-size:10px;color:${statusColor};font-weight:600">${sm[inv.status]||'Belum Bayar'}</div>
      </div>
    </div>`;
  }).join('');

  return `<div class="grup-block" style="--gc-main:${c.main};--gc-soft:${c.soft};--gc-border:${c.border};--gc-text:${c.text}">
    <div class="grup-block-header" onclick="openGrupAction('${grupKey}')">
      <div class="grup-block-icon">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
      </div>
      <div class="grup-block-title">
        <div class="grup-block-name">${xss(grupName)}</div>
        <div class="grup-block-sub">${members.length} nota · ${fmtRp(totalOmset)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${profit !== null ? `<div class="grup-block-profit ${profitClass}">${profitTxt}</div>` : ''}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gc-text)" stroke-width="2.5" stroke-linecap="round" opacity=".5"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </div>
    </div>
    <div class="grup-block-members">${memberRows}</div>
    <div class="grup-block-footer" onclick="openGrupProfitByKey('${grupKey}')">
      <span>Tap untuk lihat analisis profit grup</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </div>`;
}

// Action sheet untuk grup (klik header blok grup)
function openGrupAction(grupKey) {
  const invs = DB.get('invoices', []);
  const members = invs.filter(i => i.grupKey === grupKey);
  const gdata = DB.get(grupKey, null);
  const grupName = gdata?.name || ('Grup ' + members.length + ' Nota');
  const totalOmset = members.reduce((s,i) => s+(i.grand||0), 0);

  // Buat daftar nota anggota
  const memberItems = members.map(inv => `
    <div class="as-item" onclick="viewInv('${inv.id}');closeSheets()">
      <div class="as-ic" style="background:var(--primary-soft);color:var(--primary)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div>
        <div class="as-label">${xss(inv.customer?.name || inv.number)}</div>
        <div class="as-sub">${xss(inv.number)} · ${fmtRp(inv.grand||0)}</div>
      </div>
    </div>`).join('');

  setText('invActionTitle', grupName);
  document.getElementById('invActionContent').innerHTML = `
    <div style="font-size:10px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em;padding:0 4px 6px">Nota dalam Grup</div>
    ${memberItems}
    <div class="as-div"></div>
    <div class="as-item" onclick="openGrupProfitByKey('${grupKey}');closeSheets()">
      <div class="as-ic" style="background:#EDE9FE;color:#7C3AED">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
      </div>
      <div><div class="as-label">Lihat Profit Grup</div><div class="as-sub">Analisis pemasukan & pengeluaran</div></div>
    </div>
    <div class="as-item" onclick="ungroupGrup('${grupKey}')">
      <div class="as-ic" style="background:#FEF3C7;color:#D97706">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="3" y1="21" x2="21" y2="3" stroke-width="1.8"/></svg>
      </div>
      <div><div class="as-label">Bubarkan Grup</div><div class="as-sub">Nota kembali terpisah, data aman</div></div>
    </div>
    <div class="as-div"></div>
    <div class="as-item" onclick="deleteGrupAll('${grupKey}')">
      <div class="as-ic" style="background:var(--danger-soft);color:var(--danger)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </div>
      <div><div class="as-label" style="color:var(--danger)">Hapus Semua Nota Grup</div><div class="as-sub">Hapus ${members.length} nota sekaligus, tidak bisa dibatalkan</div></div>
    </div>`;
  openSheet('invActionSheet');
}

// Bubarkan grup — nota kembali terpisah
function ungroupGrup(grupKey) {
  closeSheets();
  const invs = DB.get('invoices', []);
  const updated = invs.map(inv => {
    if (inv.grupKey === grupKey) {
      const { grupKey: _, grupIds: __, grupName: ___, ...rest } = inv;
      return rest;
    }
    return inv;
  });
  DB.set('invoices', updated);
  // Hapus data grup & pengeluaran grup dari keuangan
  DB.set(grupKey, null);
  const allExps = DB.get('expenses', []);
  DB.set('expenses', allExps.filter(e => e.sourceGrupKey !== grupKey));
  toast('Grup dibubarkan · Nota kembali terpisah', 'ok');
  renderInvList(); renderDashboard();
}

// Hapus semua nota dalam grup
function deleteGrupAll(grupKey) {
  closeSheets();
  const invs = DB.get('invoices', []);
  const members = invs.filter(i => i.grupKey === grupKey);
  if (!confirm(`Hapus ${members.length} nota dalam grup ini? Tidak bisa dibatalkan.`)) return;
  const remaining = invs.filter(i => i.grupKey !== grupKey);
  DB.set('invoices', remaining);
  DB.set(grupKey, null);
  const allExps = DB.get('expenses', []);
  DB.set('expenses', allExps.filter(e => e.sourceGrupKey !== grupKey));
  toast(`${members.length} nota dihapus`, 'ok');
  renderInvList(); renderDashboard();
}

// Buka grup profit sheet berdasarkan grupKey (tanpa select mode)
function openGrupProfitByKey(grupKey) {
  const invs = DB.get('invoices', []);
  const members = invs.filter(i => i.grupKey === grupKey);
  if (!members.length) return;
  const totalOmset = members.reduce((s,i) => s+(i.grand||0), 0);
  const gdata = DB.get(grupKey, null);
  const grupExpenses = gdata ? gdata.expenses : [];
  const grupName = gdata?.name || '';
  setText('grupSheetSub', `${members.length} nota · Omset ${fmtRp(totalOmset)}`);
  window._grupData = { ids: members.map(i=>i.id), grupExpKey: grupKey, omset: totalOmset, expenses: JSON.parse(JSON.stringify(grupExpenses)), selected: members, name: grupName };
  renderGrupSheet();
  openSheet('grupSheet');
}

function setInvFilter(f, el) {
  invFilter = f;
  document.querySelectorAll('#invFilterBar .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderInvList();
}

function invCardHTML(inv) {
  const sm = { lunas:['badge-lunas','Lunas'], dp:['badge-dp','DP'], belum:['badge-belum','Belum Bayar'] };
  const [cls, lbl] = sm[inv.status] || sm.belum;
  const isBelum = inv.status === 'belum' || !inv.status;
  const isDp = inv.status === 'dp';
  const isLunas = inv.status === 'lunas';
  const cardStatus = isLunas ? 'status-lunas' : isDp ? 'status-dp' : 'status-belum';
  const profit = inv.profit;
  const profitBadge = profit != null
    ? `<span class="profit-saved-badge ${profit > 0 ? 'pos' : profit < 0 ? 'neg' : 'zero'}" style="margin-top:2px">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        ${profit > 0 ? '+' : ''}${fmtRpShort(profit)}
      </span>`
    : '';
  const grupBadge = inv.grupKey
    ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;color:#7C3AED;background:#EDE9FE;border-radius:4px;padding:2px 6px;margin-top:2px">&#9700; Grup ${inv.grupIds ? inv.grupIds.length : ''} Nota</span>`
    : '';
  const isSelected = selectMode && selectedIds.has(inv.id);
  return `<div class="inv-swipe-wrap" id="swipe-wrap-${inv.id}" style="margin-bottom:2px">
    <div class="inv-swipe-actions-left" id="swipe-actions-left-${inv.id}">
      <button class="inv-swipe-btn" style="background:var(--primary)" onclick="openProfitDrawer('${inv.id}',event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Profit
      </button>
    </div>
    <div class="inv-swipe-actions" id="swipe-actions-${inv.id}">
      <button class="inv-swipe-btn swipe-btn-belum${isBelum?' active-status':''}" onclick="quickStatus('${inv.id}','belum',event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Belum
      </button>
      <button class="inv-swipe-btn swipe-btn-dp${isDp?' active-status':''}" onclick="quickStatus('${inv.id}','dp',event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>DP
      </button>
      <button class="inv-swipe-btn swipe-btn-lunas${isLunas?' active-status':''}" onclick="quickStatus('${inv.id}','lunas',event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Lunas
      </button>
    </div>
    <div class="inv-card ${cardStatus}${isSelected?' selected':''}" id="inv-card-${inv.id}" data-id="${inv.id}">
      ${selectMode ? `<div class="select-check">${isSelected ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>` : '<div class="inv-card-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>'}
      <div class="inv-card-info">
        <div class="inv-card-name">${xss(inv.customer?.name || '-')}</div>
        <div class="inv-card-meta">${xss(inv.number)} · ${fmtDate(inv.date)}</div>
        ${profitBadge}${grupBadge}
      </div>
      <div class="inv-card-right">
        <div class="inv-card-amount">${fmtRp(inv.grand || 0)}</div>
        <div class="badge ${cls}" id="badge-${inv.id}">${lbl}</div>
      </div>
    </div>
  </div>`;
}

// ── Quick Status (swipe action) ────────────────────────────
function quickStatus(id, newStatus, e) {
  e && e.stopPropagation();
  const invs = DB.get('invoices', []);
  const idx = invs.findIndex(i => i.id === id);
  if (idx < 0) return;
  invs[idx].status = newStatus;
  DB.set('invoices', invs);

  const sm = { lunas:['badge-lunas','Lunas'], dp:['badge-dp','DP'], belum:['badge-belum','Belum Bayar'] };
  const statusClass = newStatus === 'lunas' ? 'status-lunas' : newStatus === 'dp' ? 'status-dp' : 'status-belum';

  // Update SEMUA kartu dengan id ini (dashboard + tab nota — bisa muncul di dua tempat)
  document.querySelectorAll('[id="inv-card-' + id + '"]').forEach(card => {
    card.classList.remove('status-lunas','status-dp','status-belum');
    card.classList.add(statusClass);
    card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
    card.style.transform = 'translateX(0)';
    if (window._swipeOpenCard && window._swipeOpenCard.card === card) window._swipeOpenCard = null;
    // Getar setelah snap balik
    setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate([35,25,35]);
      card.classList.add('getar');
      setTimeout(() => card.classList.remove('getar'), 480);
    }, 220);
  });

  // Update badge di semua kartu
  document.querySelectorAll('[id="badge-' + id + '"]').forEach(badge => {
    badge.className = 'badge ' + sm[newStatus][0];
    badge.textContent = sm[newStatus][1];
    badge.classList.add('popping');
    setTimeout(() => badge.classList.remove('popping'), 350);
  });

  // Update tombol aktif di semua action bar
  document.querySelectorAll('[id="swipe-actions-' + id + '"] .inv-swipe-btn').forEach(btn => {
    const isActive = (newStatus === 'belum' && btn.classList.contains('swipe-btn-belum')) ||
                     (newStatus === 'dp'    && btn.classList.contains('swipe-btn-dp'))    ||
                     (newStatus === 'lunas' && btn.classList.contains('swipe-btn-lunas'));
    btn.classList.toggle('active-status', isActive);
  });

  const labels = { lunas:'Lunas ✓', dp:'DP ✓', belum:'Belum Bayar ✓' };
  toast(labels[newStatus] || 'Status diubah', 'ok');
  renderDashboard();
}

// ── Swipe-to-reveal touch logic ────────────────────────────
(function initSwipeCards() {
  const THRESHOLD = 50;
  const MAX_SLIDE_RIGHT = 204; // status panel (geser kiri)
  const MAX_SLIDE_LEFT  = 82;  // profit panel (geser kanan)
  const LONG_PRESS_MS   = 480; // durasi long press
  const MOVE_CANCEL_PX  = 8;   // gerakan px sebelum long press dibatalkan
  let state = null;

  function getOpen() { return window._swipeOpenCard || null; }
  function setOpen(v) { window._swipeOpenCard = v || null; }

  // BUG FIX #5: will-change cuma dipasang selagi kartu ini aktif dianimasikan,
  // lalu dicopot lagi (balik ke 'auto') begitu transition-nya kelar. Ini yang
  // mencegah numpuknya GPU layer permanen di daftar nota panjang (lihat catatan
  // di style.css .inv-card) yang bikin warna tombol geser "bocor" pas discroll.
  function armWillChange(card) {
    card.style.willChange = 'transform';
  }
  function disarmWillChangeAfterTransition(card) {
    const clear = (e) => {
      if (e && e.target !== card) return;
      card.style.willChange = 'auto';
      card.removeEventListener('transitionend', clear);
    };
    card.addEventListener('transitionend', clear);
    // Jaga-jaga kalau transitionend tidak pernah fire (mis. elemen dilepas dari DOM)
    setTimeout(() => clear(), 500);
  }

  function closeOpenCard(exceptCard) {
    const o = getOpen();
    if (o && o.card !== exceptCard) {
      armWillChange(o.card);
      o.card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
      o.card.style.transform = 'translateX(0)';
      disarmWillChangeAfterTransition(o.card);
      setOpen(null);
    }
  }

  // Tampilkan ripple di titik sentuh lalu masuk select mode — tanpa re-render dulu
  function triggerLongPress(card, touchX, touchY) {
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);

    // Ripple visual dari titik sentuh
    const rect = card.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'lp-ripple-dot';
    dot.style.left = (touchX - rect.left) + 'px';
    dot.style.top  = (touchY - rect.top)  + 'px';
    card.style.overflow = 'hidden';
    card.appendChild(dot);

    // Tambah glow sementara
    card.classList.add('lp-holding');

    dot.addEventListener('animationend', () => {
      dot.remove();
      card.style.overflow = '';
      card.classList.remove('lp-holding');
      // Masuk select mode setelah ripple selesai — re-render bersih
      enterSelectModeSmooth(card.dataset.id);
    }, { once: true });
  }

  // Enter select mode: set state lalu re-render bersih (tidak ada patching manual)
  function enterSelectModeSmooth(id) {
    selectMode = true;
    selectedIds = new Set([id]);
    renderInvList();
    showSelectBar();
    _updatePilihBtn(true);
  }

  // ── Touch handlers ────────────────────────────────────────

  function onTouchStart(e) {
    const card = e.target.closest('.inv-card');
    if (!card) return;

    // Jika sudah dalam select mode → set state minimal untuk deteksi tap di touchend
    if (selectMode) {
      // Abaikan jika tap di swipe actions
      if (e.target.closest('.inv-swipe-actions') || e.target.closest('.inv-swipe-actions-left')) return;
      const t = e.touches[0];
      state = { card, startX: t.clientX, startY: t.clientY, moved: false, isSelectTap: true, longPressTimer: null, lpFired: false };
      return;
    }

    const o = getOpen();
    const wasOpenCard = o && o.card === card ? o : null;
    closeOpenCard(card);

    const t = e.touches[0];
    let startTranslate = 0;
    if (wasOpenCard) {
      startTranslate = wasOpenCard.dir === 'left' ? -MAX_SLIDE_RIGHT : MAX_SLIDE_LEFT;
    }

    state = {
      card,
      startX: t.clientX, startY: t.clientY,
      curX: startTranslate, moved: false, shook: false,
      startTranslate, dir: null,
      lpFired: false
    };

    state.longPressTimer = setTimeout(() => {
      if (state && !state.moved && !state.lpFired) {
        state.lpFired = true;
        const s = state;
        state = null; // clear state dulu biar touchmove/end tidak proses
        triggerLongPress(s.card, s.startX, s.startY);
      }
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (!state) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Jika state adalah select tap — tandai sebagai moved jika bergerak > threshold
    if (state.isSelectTap) {
      if (dist > MOVE_CANCEL_PX) { state.moved = true; }
      return;
    }

    // Batalkan long press jika jari bergerak lebih dari threshold
    if (!state.moved && dist > MOVE_CANCEL_PX) {
      if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
    }

    // Abaikan gerakan vertikal murni
    if (!state.moved && Math.abs(dy) > Math.abs(dx) + 4) {
      if (state.longPressTimer) clearTimeout(state.longPressTimer);
      state = null;
      return;
    }

    if (!state.moved && state.longPressTimer) clearTimeout(state.longPressTimer);
    if (!state.moved) armWillChange(state.card); // BUG FIX #5: nyalakan cuma pas mulai digeser beneran
    state.moved = true;
    e.preventDefault();

    const raw = state.startTranslate + dx;

    if (!state.dir) {
      if (dx < -5) state.dir = 'left';
      else if (dx > 5) state.dir = 'right';
      else return;
    }

    let translate;
    if (state.dir === 'left') {
      translate = raw < -MAX_SLIDE_RIGHT
        ? -MAX_SLIDE_RIGHT - ((-raw - MAX_SLIDE_RIGHT) * 0.25)
        : Math.max(-MAX_SLIDE_RIGHT, Math.min(0, raw));
    } else {
      translate = raw > MAX_SLIDE_LEFT
        ? MAX_SLIDE_LEFT + ((raw - MAX_SLIDE_LEFT) * 0.25)
        : Math.min(MAX_SLIDE_LEFT, Math.max(0, raw));
    }
    state.curX = translate;

    if (!state.shook && Math.abs(state.curX) > THRESHOLD) {
      state.shook = true;
      if (navigator.vibrate) navigator.vibrate(25);
    }
    state.card.style.transition = 'none';
    state.card.style.transform = `translateX(${translate}px)`;
  }

  function onTouchEnd() {
    if (!state) return;
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    // Handle select mode tap: toggle jika tidak bergerak
    if (state.isSelectTap) {
      const { card, moved } = state;
      state = null;
      if (!moved && card.dataset.id) toggleSelectCard(card.dataset.id);
      return;
    }
    if (!state.moved) { state = null; return; }
    const { card, curX, dir } = state;
    state = null;

    if (dir === 'left' && curX < -THRESHOLD) {
      card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
      card.style.transform = `translateX(-${MAX_SLIDE_RIGHT}px)`;
      disarmWillChangeAfterTransition(card);
      setOpen({ card, dir: 'left' });
      setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); }, 200);
    } else if (dir === 'right' && curX > THRESHOLD) {
      card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
      card.style.transform = `translateX(${MAX_SLIDE_LEFT}px)`;
      disarmWillChangeAfterTransition(card);
      setOpen({ card, dir: 'right' });
      setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); }, 200);
    } else {
      card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
      card.style.transform = 'translateX(0)';
      disarmWillChangeAfterTransition(card);
      const o = getOpen();
      if (o && o.card === card) setOpen(null);
    }
  }

  // Tap / click handler
  document.addEventListener('click', function(e) {
    if (e.target.closest('.inv-swipe-actions') || e.target.closest('.inv-swipe-actions-left')) return;
    const card = e.target.closest('.inv-card');
    if (!card) return;
    if (selectMode) { toggleSelectCard(card.dataset.id); return; }
    const o = getOpen();
    if (o && o.card === card) { closeOpenCard(null); return; }
    openInvAction(card.dataset.id);
  });

  // Gunakan passive:false di touchstart agar bisa prevent default kalau perlu
  document.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', () => { if (state?.longPressTimer) clearTimeout(state.longPressTimer); state = null; }, { passive: true });

  // Tutup swipe jika tap di luar
  document.addEventListener('touchstart', function(e) {
    if (!e.target.closest('.inv-swipe-wrap') && getOpen()) closeOpenCard(null);
  }, { passive: true });
})();


function openInvAction(id) {
  const inv = DB.get('invoices', []).find(i => i.id === id); if (!inv) return;
  curInvId = id;
  setText('invActionTitle', inv.customer?.name || 'Nota');
  document.getElementById('invActionContent').innerHTML = `
    <div class="as-item" onclick="viewInv('${id}');closeSheets()"><div class="as-ic" style="background:var(--primary-soft);color:var(--primary)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div><div><div class="as-label">Lihat Invoice</div><div class="as-sub">Preview &amp; export</div></div></div>
    <div class="as-item" onclick="editInv('${id}');closeSheets()"><div class="as-ic" style="background:var(--warning-soft);color:var(--warning)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div><div><div class="as-label">Edit Nota</div><div class="as-sub">Ubah data nota</div></div></div>
    <div class="as-item" onclick="dupInv('${id}');closeSheets()"><div class="as-ic" style="background:var(--success-soft);color:var(--success)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></div><div><div class="as-label">Duplikat Nota</div><div class="as-sub">Buat salinan nota ini</div></div></div>
    <div class="as-item" onclick="closeSheets();setTimeout(()=>openProfitDrawer('${id}'),260)"><div class="as-ic" style="background:var(--primary-soft);color:var(--primary)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div><div class="as-label">Kelola Profit</div><div class="as-sub">Catat pengeluaran &amp; lihat profit bersih</div></div></div>
    <div class="as-div"></div>
    <div class="as-item" onclick="delInv('${id}');closeSheets()"><div class="as-ic" style="background:var(--danger-soft);color:var(--danger)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></div><div><div class="as-label" style="color:var(--danger)">Hapus Nota</div><div class="as-sub">Tidak bisa dibatalkan</div></div></div>`;
  openSheet('invActionSheet');
}

function viewInv(id) {
  const inv = DB.get('invoices', []).find(i => i.id === id); if (!inv) return;
  // Cukup tampilkan nota apa adanya sesuai template & warna yang tersimpan
  // di nota itu sendiri — TIDAK mengubah curTplColor global, supaya
  // preview satu nota lama tidak "mencemari" nota baru yang akan dibuat
  // setelahnya dengan warna/template yang salah.
  curInvId = id; buildPreview(inv); nav('preview');
}

function editInv(id) {
  const inv = DB.get('invoices', []).find(i => i.id === id); if (!inv) return;
  curInvId = id;
  document.getElementById('invFormTitle').textContent = 'Edit Nota';
  document.getElementById('invNumber').value = inv.number;
  document.getElementById('invDate').value = inv.date;
  document.getElementById('invStatus').value = inv.status;
  document.getElementById('custName').value = inv.customer?.name || '';
  document.getElementById('custPhone').value = inv.customer?.phone || '';
  document.getElementById('custAddr').value = inv.customer?.address || '';
  document.getElementById('discInput').value = inv.disc > 0 ? (inv.discType === 'rupiah' ? fmtRp(inv.disc) : String(inv.disc)) : '';
  setDiscType(inv.discType || 'persen');
  document.getElementById('ongkirInput').value = inv.ongkir > 0 ? fmtRp(inv.ongkir) : '';
  const eInp = document.getElementById('ekspedisiInput'); if (eInp) eInp.value = inv.ekspedisi || '';
  document.getElementById('dpInput').value = inv.dp > 0 ? fmtRp(inv.dp) : '';
  document.getElementById('invNotes').value = inv.notes || '';
  // BUG FIX: jangan timpa curTemplate/curTplColor dengan template lama milik
  // nota ini. Template nota sekarang selalu mengikuti pilihan TERBARU di
  // Pengaturan (curTemplate), bukan snapshot lama — supaya saat edit/duplikat
  // lalu disimpan (walau tanpa perubahan apa pun), tampilannya otomatis ikut
  // template terkini, bukan "terkunci" ke template saat nota pertama dibuat.
  items = JSON.parse(JSON.stringify(inv.items || [{ id: Date.now(), name:'', qty:1, price:0 }]));
  // Restore per-item discount type from first item that has one
  const firstDiscItem = items.find(i => i.discItemType);
  curDiscItemType = firstDiscItem ? firstDiscItem.discItemType : 'persen';
  renderItems(); recalc();
  nav('invoice-form');
}

function dupInv(id) {
  editInv(id);
  curInvId = null;
  genInvNum();
  document.getElementById('invFormTitle').textContent = 'Duplikat Nota';
  document.getElementById('invDate').value = new Date().toISOString().split('T')[0];
  toast('Nota diduplikat', 'ok');
}

function delInv(id) {
  if (!confirm('Hapus nota ini? Tidak bisa dibatalkan.')) return;
  DB.set('invoices', DB.get('invoices', []).filter(i => i.id !== id));
  if (curInvId === id) curInvId = null;
  toast('Nota dihapus', 'ok');
  renderInvList(); renderDashboard();
}

// ── Profit per Nota Sheet ──────────────────────────────────
function openProfitDrawer(id, e) {
  e && e.stopPropagation();
  const inv = DB.get('invoices', []).find(i => i.id === id); if (!inv) return;
  // Close swipe card
  const card = document.getElementById('inv-card-' + id);
  if (card) { card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)'; card.style.transform = 'translateX(0)'; window._swipeOpenCard = null; }

  setText('profitSheetTitle', `Pembukuan · ${xss(inv.customer?.name || inv.number)}`);
  setText('profitSheetSub', `Omset: ${fmtRp(inv.grand || 0)}`);

  const saved = DB.get('inv_profit_' + id, null);
  const expenses = saved ? saved.expenses : [];
  renderProfitSheet(id, inv, expenses);
  openSheet('profitSheet');
}

function renderProfitSheet(invId, inv, expenses) {
  const omset = inv.grand || 0;
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = omset - totalExp;
  const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'zero';

  const rows = expenses.map((exp, i) => `
    <div class="profit-exp-row" id="profit-exp-row-${i}">
      <input class="profit-exp-name" type="text" placeholder="Nama pengeluaran..." value="${xss(exp.name)}"
        oninput="updateProfitExp('${invId}',${i},'name',this.value)">
      <input class="profit-exp-amt" type="text" placeholder="Rp 0" value="${exp.amount > 0 ? fmtRp(exp.amount) : ''}"
        onfocus="if(!this.value||parseMoney(this.value)===0)this.value=''"
        oninput="const r=parseMoney(this.value);if(r>0)this.value=fmtRp(r);updateProfitExp('${invId}',${i},'amount',parseMoney(this.value))"
        onblur="updateProfitCalc('${invId}')">
      <button class="profit-exp-del" onclick="deleteProfitExp('${invId}',${i})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  document.getElementById('profitSheetBody').innerHTML = `
    <div class="profit-result" style="margin-bottom:14px">
      <div class="profit-result-row"><span class="profit-result-label">Omset (Grand Total)</span><span class="profit-result-val">${fmtRp(omset)}</span></div>
      <div class="profit-result-divider" style="margin:6px 0"></div>
      <div class="profit-result-row"><span class="profit-result-label">Total Pengeluaran</span><span class="profit-result-val" id="ps-total-exp">${fmtRp(totalExp)}</span></div>
      <div class="profit-result-divider" style="margin:6px 0"></div>
      <div class="profit-result-main">
        <span class="profit-result-main-label">Profit Bersih</span>
        <span class="profit-result-main-val ${profitClass}" id="ps-profit">${profit >= 0 ? '+' : ''}${fmtRp(profit)}</span>
      </div>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--txt-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Daftar Pengeluaran</div>
    <div id="ps-exp-list">${rows}</div>
    <div class="profit-add-row">
      <button class="profit-add-btn" onclick="addProfitExp('${invId}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Tambah Pengeluaran
      </button>
    </div>
    <button class="profit-save-btn" onclick="saveProfitData('${invId}')">Simpan Pembukuan</button>
    <div style="height:8px"></div>`;

  // Store current expenses in memory
  window._profitData = window._profitData || {};
  window._profitData[invId] = { inv, expenses: JSON.parse(JSON.stringify(expenses)) };
}

function updateProfitExp(invId, idx, field, val) {
  if (!window._profitData?.[invId]) return;
  window._profitData[invId].expenses[idx] = window._profitData[invId].expenses[idx] || { name:'', amount:0 };
  window._profitData[invId].expenses[idx][field] = val;
  updateProfitCalc(invId);
}

function updateProfitCalc(invId) {
  const d = window._profitData?.[invId]; if (!d) return;
  const omset = d.inv.grand || 0;
  const totalExp = d.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = omset - totalExp;
  const el = document.getElementById('ps-total-exp');
  const elP = document.getElementById('ps-profit');
  if (el) el.textContent = fmtRp(totalExp);
  if (elP) {
    elP.textContent = (profit >= 0 ? '+' : '') + fmtRp(profit);
    elP.className = 'profit-result-main-val ' + (profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'zero');
  }
}

function addProfitExp(invId) {
  if (!window._profitData?.[invId]) return;
  window._profitData[invId].expenses.push({ name:'', amount:0 });
  const inv = window._profitData[invId].inv;
  renderProfitSheet(invId, inv, window._profitData[invId].expenses);
  // Focus last name input
  setTimeout(() => {
    const rows = document.querySelectorAll('#ps-exp-list .profit-exp-name');
    if (rows.length) rows[rows.length - 1].focus();
  }, 50);
}

function deleteProfitExp(invId, idx) {
  if (!window._profitData?.[invId]) return;
  window._profitData[invId].expenses.splice(idx, 1);
  const inv = window._profitData[invId].inv;
  renderProfitSheet(invId, inv, window._profitData[invId].expenses);
}

function saveProfitData(invId) {
  const d = window._profitData?.[invId]; if (!d) return;
  const expenses = d.expenses.filter(e => e.name || e.amount > 0);
  const omset = d.inv.grand || 0;
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = omset - totalExp;
  DB.set('inv_profit_' + invId, { expenses, profit, omset, savedAt: Date.now() });
  // Update invoice with profit for badge display
  const invs = DB.get('invoices', []);
  const idx = invs.findIndex(i => i.id === invId);
  if (idx !== -1) { invs[idx].profit = profit; DB.set('invoices', invs); }

  // ── SYNC: Sinkronkan pengeluaran nota ke tab Keuangan/Pengeluaran ──
  _syncProfitExpensesToKeuangan(invId, d.inv, expenses);

  closeSheets();
  toast('Pembukuan disimpan ✓', 'ok');
  renderInvList(); renderDashboard();
}

// Sinkronkan pengeluaran dari profit nota ke daftar pengeluaran keuangan
function _syncProfitExpensesToKeuangan(invId, inv, expenses) {
  const allExps = DB.get('expenses', []);
  const invDate = inv.date || new Date().toISOString().split('T')[0];
  const invNum  = inv.number || invId;
  const custName = inv.customer?.name || '';

  // Hapus entri lama yang berasal dari nota ini (identifikasi via sourceNotaId)
  const cleaned = allExps.filter(e => e.sourceNotaId !== invId);

  // Tambah entri baru untuk setiap pengeluaran yang ada
  const newExps = expenses
    .filter(e => e.name && e.amount > 0)
    .map((e, i) => ({
      id: 'nota_' + invId + '_' + i + '_' + Date.now(),
      name: e.name + (custName ? ' · ' + invNum : ' · ' + invNum),
      amount: e.amount,
      cat: e.cat || 'lainnya',
      date: invDate,
      sourceNotaId: invId,
      sourceType: 'nota'
    }));

  DB.set('expenses', [...cleaned, ...newExps]);
}

// Sinkronkan pengeluaran dari grup ke daftar pengeluaran keuangan
function _syncGrupExpensesToKeuangan(grupKey, ids, expenses, omset, grupName) {
  const allExps = DB.get('expenses', []);
  const today = new Date().toISOString().split('T')[0];
  const invs = DB.get('invoices', []);
  const selected = invs.filter(i => ids.includes(i.id));
  const label = grupName || ('Grup ' + selected.length + ' Nota');

  // Hapus entri lama dari grup ini
  const cleaned = allExps.filter(e => e.sourceGrupKey !== grupKey);

  // Tambah entri baru
  const newExps = expenses
    .filter(e => e.name && e.amount > 0)
    .map((e, i) => ({
      id: 'grup_' + grupKey + '_' + i + '_' + Date.now(),
      name: e.name + ' · ' + label,
      amount: e.amount,
      cat: e.cat || 'lainnya',
      date: today,
      sourceGrupKey: grupKey,
      sourceGrupName: label,
      sourceType: 'grup'
    }));

  // Juga catat pemasukan grup sebagai entri ringkasan (untuk tab keuangan)
  DB.set('expenses', [...cleaned, ...newExps]);
}

// ── Select Mode ──────────────────────────────────
function enterSelectMode(id) {
  // Dipanggil dari luar swipe context (misal tombol lain) — pakai re-render biasa
  selectMode = true;
  selectedIds = new Set();
  selectedIds.add(id);
  if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
  renderInvList();
  showSelectBar();
  _updatePilihBtn(true);
}

// Masuk select mode tanpa memilih nota tertentu (dari tombol Pilih di header)
function enterSelectModeFromBtn() {
  if (selectMode) { exitSelectMode(); return; }
  selectMode = true;
  selectedIds = new Set();
  if (navigator.vibrate) navigator.vibrate([20]);
  renderInvList();
  showSelectBar();
  _updatePilihBtn(true);
}

function _updatePilihBtn(active) {
  const btn = document.getElementById('btnPilihNota');
  if (!btn) return;
  btn.classList.toggle('active', active);
}

function showSelectBar() {
  let bar = document.getElementById('selectBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selectBar';
    bar.className = 'select-bar';
    const list = document.getElementById('allInvList');
    list.parentNode.insertBefore(bar, list);
  }
  bar.innerHTML = `
    <div class="select-bar-left">
      <span class="select-bar-count">${selectedIds.size} dipilih</span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="select-bar-cancel" onclick="exitSelectMode()">Batal</button>
      <button class="select-bar-group" onclick="openGrupSheet()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:3px"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
        Analisis Grup
      </button>
    </div>`;
}

function toggleSelectCard(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  if (selectedIds.size === 0) { exitSelectMode(); return; }
  // FIX: update ALL cards with this id (dashboard + invoice-list can both show same card)
  const isSelected = selectedIds.has(id);
  const svgChecked = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  document.querySelectorAll('[id="inv-card-' + id + '"]').forEach(card => {
    card.classList.toggle('selected', isSelected);
    const chk = card.querySelector('.select-check');
    if (chk) chk.innerHTML = isSelected ? svgChecked : '';
  });
  showSelectBar();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds = new Set();
  const bar = document.getElementById('selectBar');
  if (bar) bar.remove();
  _updatePilihBtn(false);
  renderInvList(); // full re-render untuk bersih
}

function openGrupSheet() {
  if (selectedIds.size === 0) { toast('Pilih minimal 1 nota', 'err'); return; }
  const invs = DB.get('invoices', []);
  const selected = invs.filter(i => selectedIds.has(i.id));
  const totalOmset = selected.reduce((s, i) => s + (i.grand || 0), 0);
  const savedProfits = selected.map(i => DB.get('inv_profit_' + i.id, null));
  const hasSavedProfit = savedProfits.some(p => p !== null);
  const totalSavedExp = savedProfits.reduce((s, p) => s + (p ? p.expenses.reduce((se, e) => se + e.amount, 0) : 0), 0);
  const totalSavedProfit = totalOmset - totalSavedExp;

  setText('grupSheetSub', `${selected.length} nota terpilih · Omset ${fmtRp(totalOmset)}`);

  const grupExpKey = 'grup_exp_' + Array.from(selectedIds).sort().join('_');
  const savedGrup = DB.get(grupExpKey, null);
  const grupExpenses = savedGrup ? savedGrup.expenses : [];

  const grupName = savedGrup ? (savedGrup.name || '') : '';
  window._grupData = { ids: Array.from(selectedIds), grupExpKey, omset: totalOmset, expenses: JSON.parse(JSON.stringify(grupExpenses)), selected, name: grupName };
  renderGrupSheet();
  openSheet('grupSheet');
}

function renderGrupSheet() {
  const d = window._grupData; if (!d) return;
  const omset = d.omset;
  const totalGrupExp = d.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = omset - totalGrupExp;
  const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'zero';

  const chips = d.selected.map(inv => `<span class="grup-nota-chip">${xss(inv.customer?.name || inv.number)} · ${fmtRp(inv.grand||0)}</span>`).join('');
  const rows = d.expenses.map((exp, i) => `
    <div class="profit-exp-row">
      <input class="profit-exp-name" type="text" placeholder="Nama pengeluaran..." value="${xss(exp.name)}"
        oninput="updateGrupExp(${i},'name',this.value)">
      <input class="profit-exp-amt" type="text" placeholder="Rp 0" value="${exp.amount > 0 ? fmtRp(exp.amount) : ''}"
        onfocus="if(!this.value||parseMoney(this.value)===0)this.value=''"
        oninput="const r=parseMoney(this.value);if(r>0)this.value=fmtRp(r);updateGrupExp(${i},'amount',parseMoney(this.value))"
        onblur="renderGrupCalc()">
      <button class="profit-exp-del" onclick="deleteGrupExp(${i})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  document.getElementById('grupSheetBody').innerHTML = `
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;color:var(--txt-2);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px">Nama Grup</label>
      <input id="gs-grup-name" type="text" class="form-input" placeholder="Contoh: Orderan Mei W1, Project Kafe Budi..." value="${xss(d.name||'')}"
        oninput="window._grupData.name=this.value" maxlength="60"
        style="font-size:14px;font-weight:600">
    </div>
    <div class="grup-nota-chips">${chips}</div>
    <div class="profit-result" style="margin-bottom:14px">
      <div class="profit-result-row"><span class="profit-result-label">Total Omset Grup</span><span class="profit-result-val">${fmtRp(omset)}</span></div>
      <div class="profit-result-divider" style="margin:6px 0"></div>
      <div class="profit-result-row"><span class="profit-result-label">Total Pengeluaran Grup</span><span class="profit-result-val" id="gs-total-exp">${fmtRp(totalGrupExp)}</span></div>
      <div class="profit-result-divider" style="margin:6px 0"></div>
      <div class="profit-result-main">
        <span class="profit-result-main-label">Profit Bersih Grup</span>
        <span class="profit-result-main-val ${profitClass}" id="gs-profit">${profit >= 0 ? '+' : ''}${fmtRp(profit)}</span>
      </div>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--txt-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Pengeluaran Grup</div>
    <div id="gs-exp-list">${rows}</div>
    <div class="profit-add-row">
      <button class="profit-add-btn" onclick="addGrupExp()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Tambah Pengeluaran
      </button>
    </div>
    <button class="profit-save-btn" onclick="saveGrupData()">Simpan Grup</button>
    <div style="height:8px"></div>`;
  // Auto-focus nama grup jika kosong
  const nameInput = document.getElementById('gs-grup-name');
  if (nameInput && !d.name) setTimeout(() => nameInput.focus(), 300);
}

function updateGrupExp(idx, field, val) {
  if (!window._grupData) return;
  window._grupData.expenses[idx] = window._grupData.expenses[idx] || { name:'', amount:0 };
  window._grupData.expenses[idx][field] = val;
  renderGrupCalc();
}

function renderGrupCalc() {
  const d = window._grupData; if (!d) return;
  const omset = d.omset;
  const totalExp = d.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = omset - totalExp;
  const el = document.getElementById('gs-total-exp');
  const elP = document.getElementById('gs-profit');
  if (el) el.textContent = fmtRp(totalExp);
  if (elP) {
    elP.textContent = (profit >= 0 ? '+' : '') + fmtRp(profit);
    elP.className = 'profit-result-main-val ' + (profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'zero');
  }
}

function addGrupExp() {
  if (!window._grupData) return;
  window._grupData.expenses.push({ name:'', amount:0 });
  renderGrupSheet();
  setTimeout(() => {
    const rows = document.querySelectorAll('#gs-exp-list .profit-exp-name');
    if (rows.length) rows[rows.length - 1].focus();
  }, 50);
}

function deleteGrupExp(idx) {
  if (!window._grupData) return;
  window._grupData.expenses.splice(idx, 1);
  renderGrupSheet();
}

function saveGrupData() {
  const d = window._grupData; if (!d) return;
  const expenses = d.expenses.filter(e => e.name || e.amount > 0);
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
  const profit = d.omset - totalExp;
  const grupKey = d.grupExpKey;

  const grupName = (d.name || '').trim() || ('Grup ' + new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short'}));

  // Simpan data grup
  DB.set(grupKey, { expenses, profit, omset: d.omset, ids: d.ids, name: grupName, savedAt: Date.now() });

  // Tandai setiap invoice sebagai bagian dari grup ini
  const invs = DB.get('invoices', []);
  const updatedInvs = invs.map(inv => {
    if (d.ids.includes(inv.id)) {
      return { ...inv, grupKey, grupIds: d.ids, grupName };
    }
    return inv;
  });
  DB.set('invoices', updatedInvs);

  // Sinkronkan pengeluaran grup ke tab keuangan
  _syncGrupExpensesToKeuangan(grupKey, d.ids, expenses, d.omset, grupName);

  closeSheets();
  exitSelectMode();
  toast(`"${grupName}" disimpan · ${d.ids.length} nota · Profit ${profit >= 0 ? '+' : ''}${fmtRp(profit)} ✓`, 'ok');
  renderInvList();
  renderDashboard();
}

// ── Template helpers ────────────────────────
// persist=true (default) saves this as the user's standing default template,
// used whenever a template is actively picked (tap on a template card).
// Pass persist=false when just reflecting a value that's already known
// (restoring a draft, opening an existing invoice, or re-syncing the UI),
// so opening an old invoice never silently changes the user's default.
function selectTemplate(name, el, persist = true) {
  curTemplate = name;
  document.querySelectorAll('.tpl-card').forEach(c => c.classList.toggle('active', c.dataset.tpl === name));
  if (persist) { const s = DB.get('settings', {}); s.defaultTemplate = name; DB.set('settings', s); }
}

// Template color palette
const TPL_COLORS = {
  amber:  { main:'#D97706', dark:'#92400E', darker:'#78350F', darkest:'#451A03', soft:'#FEF3C7', softer:'#FFFBEB', text:'#FEF3C7', border:'#FDE68A' },
  golden: { main:'#FFD700', dark:'#B8970F', darker:'#7A6308', darkest:'#4A3C05', soft:'#FFFDE7', softer:'#FFFFF0', text:'#FFFFF0', border:'#FFE57F' },
  navy:   { main:'#1D4ED8', dark:'#1E3A8A', darker:'#172554', darkest:'#0F172A', soft:'#DBEAFE', softer:'#EFF6FF', text:'#DBEAFE', border:'#BFDBFE' },
  blue:   { main:'#0284C7', dark:'#0369A1', darker:'#0C4A6E', darkest:'#082F49', soft:'#E0F2FE', softer:'#F0F9FF', text:'#E0F2FE', border:'#BAE6FD' },
  green:  { main:'#15803D', dark:'#14532D', darker:'#052E16', darkest:'#022C13', soft:'#DCFCE7', softer:'#F0FDF4', text:'#DCFCE7', border:'#BBF7D0' },
  teal:   { main:'#0D9488', dark:'#0F766E', darker:'#134E4A', darkest:'#022C29', soft:'#CCFBF1', softer:'#F0FDFA', text:'#CCFBF1', border:'#99F6E4' },
  purple: { main:'#7C3AED', dark:'#5B21B6', darker:'#3B0764', darkest:'#2E1065', soft:'#EDE9FE', softer:'#F5F3FF', text:'#EDE9FE', border:'#DDD6FE' },
  rose:   { main:'#E11D48', dark:'#9F1239', darker:'#4C0519', darkest:'#2D0210', soft:'#FFE4E6', softer:'#FFF1F2', text:'#FFE4E6', border:'#FECDD3' },
  orange: { main:'#EA580C', dark:'#7C2D12', darker:'#431407', darkest:'#2A0C04', soft:'#FFEDD5', softer:'#FFF7ED', text:'#FFEDD5', border:'#FED7AA' },
  gray:   { main:'#374151', dark:'#1F2937', darker:'#111827', darkest:'#030712', soft:'#F3F4F6', softer:'#F9FAFB', text:'#F3F4F6', border:'#E5E7EB' },
};

function selectTplColor(color, persist = true) {
  curTplColor = color;
  document.querySelectorAll('.tpl-color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === color));
  if (persist) { const s = DB.get('settings', {}); s.defaultTplColor = color; DB.set('settings', s); }
}

function initDiscToggle() {
  setDiscType('persen');
}

function setDiscType(type) {
  curDiscType = type;
  const bp = document.getElementById('discBtnPersen');
  const br = document.getElementById('discBtnRupiah');
  if (bp) bp.classList.toggle('active', type === 'persen');
  if (br) br.classList.toggle('active', type === 'rupiah');
  const inp = document.getElementById('discInput');
  if (inp) {
    const prevVal = parseMoney(inp.value) || parseFloat(inp.value) || 0;
    inp.value = '';
    inp.placeholder = type === 'rupiah' ? 'Rp 0' : '0';
    if (prevVal > 0) {
      if (type === 'rupiah') inp.value = fmtRp(prevVal);
      else inp.value = String(prevVal);
    }
  }
  recalc();
}

// Populate ekspedisi select from settings
function populateEkspedisiSelect() {
  const sel = document.getElementById('ekspedisiSelect');
  if (!sel) return;
  const eksps = DB.get('ekspedisi', []);
  sel.innerHTML = '<option value="">-- Pilih --</option>' + eksps.map(e => `<option value="${xss(e.name)}">${xss(e.name)}${e.desc ? ' - '+xss(e.desc) : ''}</option>`).join('');
}

function setEkspedisi(val) {
  const inp = document.getElementById('ekspedisiInput');
  if (inp && val) inp.value = val;
}

// ── Ekspedisi CRUD ───────────────────────────
function renderEkspedisiList() {
  const eksps = DB.get('ekspedisi', []);
  const list = document.getElementById('ekspedisiList');
  if (!list) return;
  if (!eksps.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--txt-3);font-size:13px">Belum ada ekspedisi. Ketuk + untuk menambah.</div>`;
    return;
  }
  list.innerHTML = eksps.map(e => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-soft)">
      <div style="width:36px;height:36px;border-radius:var(--r-sm);background:var(--warning-soft);color:var(--warning);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--txt-1)">${xss(e.name)}</div>
        ${e.desc ? `<div style="font-size:11px;color:var(--txt-3)">${xss(e.desc)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="editEkspedisi('${e.id}')" style="padding:5px 10px;border-radius:var(--r-xs);background:var(--warning-soft);color:var(--warning);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Edit</button>
        <button onclick="deleteEkspedisi('${e.id}')" style="padding:5px 10px;border-radius:var(--r-xs);background:var(--danger-soft);color:var(--danger);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Hapus</button>
      </div>
    </div>`).join('');
}

function openEkspedisiForm(id = null) {
  if (id) {
    const e = DB.get('ekspedisi', []).find(x => x.id === id); if (!e) return;
    document.getElementById('ekspFormTitle').textContent = 'Edit Ekspedisi';
    document.getElementById('editEkspId').value = e.id;
    document.getElementById('ekspName').value = e.name;
    document.getElementById('ekspDesc').value = e.desc || '';
  } else {
    document.getElementById('ekspFormTitle').textContent = 'Tambah Ekspedisi';
    document.getElementById('editEkspId').value = '';
    document.getElementById('ekspName').value = '';
    document.getElementById('ekspDesc').value = '';
  }
  openSheet('ekspedisiFormSheet');
}

function editEkspedisi(id) { openEkspedisiForm(id); }

function saveEkspedisi() {
  const name = document.getElementById('ekspName').value.trim();
  if (!name) { toast('Nama ekspedisi wajib diisi', 'err'); return; }
  const eksps = DB.get('ekspedisi', []);
  const eid = document.getElementById('editEkspId').value;
  const obj = { id: eid || Date.now().toString(), name, desc: document.getElementById('ekspDesc').value.trim() };
  if (eid) {
    const idx = eksps.findIndex(e => e.id === eid);
    if (idx !== -1) eksps[idx] = obj; else eksps.push(obj);
  } else { eksps.push(obj); }
  DB.set('ekspedisi', eksps);
  closeSheets();
  toast(`Ekspedisi "${name}" disimpan ✓`, 'ok');
  renderEkspedisiList();
  populateEkspedisiSelect();
}

function deleteEkspedisi(id) {
  if (!confirm('Hapus ekspedisi ini?')) return;
  DB.set('ekspedisi', DB.get('ekspedisi', []).filter(e => e.id !== id));
  toast('Ekspedisi dihapus', 'ok');
  renderEkspedisiList();
  populateEkspedisiSelect();
}

// ── Preview ─────────────────────────────────
function getInvoiceHTML(inv) {
  return _buildInvoiceHTML(inv);
}

function buildPreview(inv) {
  const s = DB.get('settings', {});
  const tpl = inv.template || curTemplate || 'classic';
  const colorKey = inv.tplColor || curTplColor || 'amber';
  const C = TPL_COLORS[colorKey] || TPL_COLORS['custom'] || TPL_COLORS.amber;
  const stamp = { lunas:['#10B981','LUNAS'], dp:['#F59E0B','DP'], belum:['#EF4444','BELUM BAYAR'] };
  const [sc, sl] = stamp[inv.status] || stamp.belum;

  // ── Shared helpers ──────────────────────────────────────────
  const logoImg = s.logo
    ? `<img src="${s.logo}" style="width:100%;height:100%;object-fit:contain">`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="1.5" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

  const signImg = s.signature
    ? `<img src="${s.signature}" alt="TTD" style="max-width:90px;max-height:46px;object-fit:contain;display:block;margin:0 auto">`
    : '';

  const thankyou = s.thankyou || 'Terima kasih atas kepercayaan Anda 🙏';
  const signLabel = s.signLabel || 'Hormat kami';

  // Table rows
  const rows = (inv.items || []).filter(i => i.name).map((item, idx) => {
    const itemTotal = calcItemTotal(item);
    const hasDisc = item.discItem > 0;
    const discLabel = hasDisc ? (item.discItemType === 'rupiah' ? `disc ${fmtRp(item.discItem)}/pcs` : `disc ${item.discItem}% (${fmtRp(Math.round(item.price * item.discItem / 100))}/pcs)`) : '';
    return `
    <tr style="background:${idx % 2 === 1 ? '#F9FAFB' : '#fff'}">
      <td style="padding:12px 14px;font-size:14px;color:#374151;border-bottom:1px solid #F3F4F6">
        ${xss(item.name)}
        ${hasDisc ? `<div style="font-size:11px;color:#10B981;margin-top:2px">${discLabel}</div>` : ''}
      </td>
      <td style="padding:12px 14px;font-size:14px;color:#374151;border-bottom:1px solid #F3F4F6;text-align:center">${item.qty}</td>
      <td style="padding:12px 14px;font-size:14px;color:#374151;border-bottom:1px solid #F3F4F6;text-align:right">
        ${hasDisc ? `<div style="margin-bottom:2px"><span style="font-size:11px;color:#EF4444;font-weight:600"><span style="font-size:15px;font-weight:900;line-height:1">&#10005;</span>&nbsp;${fmtRp(item.price)}&nbsp;<span style="font-size:15px;font-weight:900;line-height:1">&#10005;</span></span></div>` : ''}
        <span style="font-size:14px;font-weight:${hasDisc?'700':'400'};color:${hasDisc?'#111827':'#374151'}">${hasDisc ? fmtRp(item.price - (item.discItemType==='rupiah' ? item.discItem : item.price * item.discItem / 100)) : fmtRp(item.price)}</span>
      </td>
      <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#111827;border-bottom:1px solid #F3F4F6;text-align:right">${fmtRp(itemTotal)}</td>
    </tr>`;
  }).join('');

  const discRow = inv.disc > 0
    ? `<tr><td colspan="2" style="padding:5px 0;font-size:13px;color:#6B7280">Diskon ${inv.discType === 'rupiah' ? fmtRp(inv.disc) : inv.disc + '%'}</td><td colspan="2" style="padding:5px 0;font-size:13px;color:#6B7280;text-align:right">- ${fmtRp(inv.discAmt)}</td></tr>` : '';
  const ongkirLabel = inv.ekspedisi ? `Ongkir (${xss(inv.ekspedisi)})` : 'Ongkir';
  const ongkirRow = inv.ongkir > 0
    ? `<tr><td colspan="2" style="padding:5px 0;font-size:13px;color:#6B7280">${ongkirLabel}</td><td colspan="2" style="padding:5px 0;font-size:13px;color:#6B7280;text-align:right">${fmtRp(inv.ongkir)}</td></tr>` : '';

  const totalsTable = `
    <table style="width:100%;border-collapse:collapse;margin-top:4px">
      <tr><td colspan="2" style="padding:5px 0;font-size:13px;color:#6B7280">Subtotal</td><td colspan="2" style="padding:5px 0;font-size:13px;color:#374151;text-align:right;font-weight:600">${fmtRp(inv.sub)}</td></tr>
      ${discRow}${ongkirRow}
    </table>`;

  const dpRow = inv.dp > 0
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:10px 14px;background:${C.dark};border-radius:6px"><span style="font-size:13px;font-weight:700;color:${C.text}">DP / Uang Muka</span><span style="font-size:14px;font-weight:800;color:${C.text}">${fmtRp(inv.dp)}</span></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding:12px 14px;background:${C.darker};border-radius:6px;border:2px solid ${C.darkest}"><span style="font-size:14px;font-weight:800;color:${C.soft}">Sisa Pembayaran</span><span style="font-size:15px;font-weight:900;color:${C.soft}">${fmtRp(inv.sisa)}</span></div>` : '';

  const bankInfo = (s.bankName || s.bankNo)
    ? `<div style="margin-top:16px;padding:12px 14px;background:#F8FAFC;border-radius:8px;border:1px solid #E5E7EB"><div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Info Pembayaran</div><div style="font-size:13px;color:#374151">${xss(s.bankName||'')} &nbsp;·&nbsp; <strong style="color:#111827">${xss(s.bankNo||'')}</strong></div>${s.bankOwner ? `<div style="font-size:12px;color:#9CA3AF;margin-top:2px">a.n. ${xss(s.bankOwner)}</div>` : ''}${s.bankNote ? `<div style="font-size:12px;color:#6B7280;margin-top:5px;padding-top:5px;border-top:1px solid #E5E7EB;line-height:1.5">${xss(s.bankNote)}</div>` : ''}</div>` : '';

  const notesRow = inv.notes
    ? `<div style="margin-top:12px;padding:12px 14px;background:#F8FAFC;border-radius:8px;border:1px solid #E5E7EB"><div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Catatan</div><div style="font-size:13px;color:#6B7280;line-height:1.5">${xss(inv.notes)}</div></div>` : '';

  const stamp_el = ''; // removed from body, stamp is now at bottom
  const stamp_bottom = `<div style="padding:8px 20px;border-radius:8px;border:3px solid ${sc};color:${sc};font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.18em;background:${sc}18;display:inline-flex;align-items:center;justify-content:center;min-width:140px">${sl}</div>`;

  // ── CLASSIC ─────────────────────────────────────────────────
  let html = '';

  if (tpl === 'classic') {
    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column">
      <!-- Header -->
      <div style="background:${C.dark};padding:36px 48px 32px;display:flex;justify-content:space-between;align-items:center;position:relative">
        <div style="display:flex;align-items:center;gap:14px;max-width:55%">
          <div style="width:60px;height:60px;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">${logoImg}</div>
          <div style="min-width:0">
            <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.02em">${xss(s.storeName||'Nama Toko')}</div>
            ${s.storeAddress ? `<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px;line-height:1.4;word-break:break-word;white-space:normal">${xss(s.storeAddress)}</div>` : ''}
            ${s.storePhone ? `<div style="font-size:12px;color:rgba(255,255,255,.7)">${xss(s.storePhone)}</div>` : ''}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:34px;font-weight:900;color:#fff;letter-spacing:-.03em;line-height:1">INVOICE</div>
          <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px">${xss(inv.number)}</div>
        </div>
      </div>

      <!-- Body -->
      <div style="flex:1;padding:32px 40px;position:relative">
        ${stamp_el}

        <!-- Meta: invoice to + dates -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px;padding-bottom:24px;border-bottom:1.5px solid #E5E7EB">
          <div>
            <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Invoice Kepada</div>
            <div style="font-size:22px;font-weight:700;color:#111827">${xss(inv.customer?.name||'-')}</div>
            ${inv.customer?.phone ? `<div style="font-size:13px;color:#6B7280;margin-top:3px">${xss(inv.customer.phone)}</div>` : ''}
            ${inv.customer?.address ? `<div style="font-size:12px;color:#9CA3AF;margin-top:2px;line-height:1.5">${xss(inv.customer.address)}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="margin-bottom:6px">
              <span style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em">Tanggal</span>
              <div style="font-size:14px;font-weight:600;color:#111827;margin-top:2px">${fmtDate(inv.date)}</div>
            </div>

          </div>
        </div>

        <!-- Items table -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:0">
          <thead>
            <tr style="background:${C.dark}">
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:left;border-radius:6px 0 0 6px">Deskripsi</th>
              <th style="padding:12px 10px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:center">Qty</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:right">Harga</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:right;border-radius:0 6px 6px 0">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <!-- Totals -->
        <div style="margin-top:24px">
          <div style="width:100%">
            ${totalsTable}
            <div style="margin-top:10px;padding:12px 16px;background:${C.main};border-radius:8px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:16px;font-weight:700;color:${C.text};text-align:center">GRAND TOTAL</span>
              <span style="font-size:22px;font-weight:900;color:${C.text};text-align:center">${fmtRp(inv.grand)}</span>
            </div>
            ${dpRow}
          </div>
        </div>

        ${bankInfo}${notesRow}

        <!-- Sign + Stamp row -->
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px">
          <div>${stamp_bottom}</div>
          <div style="text-align:center">
            <div style="width:120px;height:60px;border-bottom:1.5px solid #CBD5E1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;margin-bottom:4px">${signImg}</div>
            <div style="font-size:12px;color:#9CA3AF">${xss(signLabel)}</div>
            ${s.storeName ? `<div style="font-size:13px;font-weight:600;color:#6B7280;margin-top:1px">${xss(s.storeName)}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:${C.soft};border-top:2px solid ${C.main};padding:18px 48px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:${C.dark};font-style:italic">${xss(thankyou)}</div>
        <div style="font-size:11px;color:${C.dark};letter-spacing:.08em">NOTASERU · INVOICE PRO</div>
      </div>
    </div>`;

  // ── MODERN ──────────────────────────────────────────────────
  } else if (tpl === 'modern') {
    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column">
      <!-- Header gradient -->
      <div style="background:linear-gradient(135deg,${C.dark} 0%,${C.main} 100%);padding:36px 40px 32px;position:relative;overflow:hidden">
        <div style="position:absolute;top:-60px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.06)"></div>
        <div style="position:absolute;bottom:-80px;left:-30px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.04)"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1">
          <div>
            <div style="font-size:36px;font-weight:900;color:#fff;letter-spacing:-.04em;line-height:1">INVOICE</div>
            <div style="font-size:13px;color:rgba(255,255,255,.65);margin-top:5px">${xss(inv.number)} · ${fmtDate(inv.date)}</div>
          </div>
          <div style="text-align:right;display:flex;align-items:center;gap:14px">
            <div>
              <div style="font-size:17px;font-weight:800;color:#fff">${xss(s.storeName||'Nama Toko')}</div>
              ${s.storeAddress ? `<div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:2px;line-height:1.4;word-break:break-word;white-space:normal;max-width:220px">${xss(s.storeAddress)}</div>` : ''}
              ${s.storePhone ? `<div style="font-size:12px;color:rgba(255,255,255,.65)">${xss(s.storePhone)}</div>` : ''}
            </div>
            <div style="width:56px;height:56px;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0">${logoImg}</div>
          </div>
        </div>
      </div>

      <!-- Info bar -->
      <div style="background:${C.softer};padding:22px 48px;display:grid;grid-template-columns:1fr 1fr;gap:24px;border-bottom:1px solid ${C.border}">
        <div>
          <div style="font-size:11px;font-weight:700;color:${C.dark};text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Invoice Kepada</div>
          <div style="font-size:17px;font-weight:700;color:#111827">${xss(inv.customer?.name||'-')}</div>
          ${inv.customer?.phone ? `<div style="font-size:12px;color:#6B7280;margin-top:2px">${xss(inv.customer.phone)}</div>` : ''}
          ${inv.customer?.address ? `<div style="font-size:12px;color:#9CA3AF;margin-top:1px;line-height:1.4">${xss(inv.customer.address)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;font-weight:700;color:${C.dark};text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Detail Invoice</div>
          <div style="font-size:13px;color:#374151">No: <strong>${xss(inv.number)}</strong></div>
          <div style="font-size:13px;color:#374151;margin-top:2px">Tanggal: <strong>${fmtDate(inv.date)}</strong></div>
        </div>
      </div>

      <!-- Body -->
      <div style="flex:1;padding:32px 48px;position:relative">
        ${stamp_el}
        <!-- Items table -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:0">
          <thead>
            <tr style="background:linear-gradient(135deg,${C.dark},${C.main})">
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;text-align:left">Deskripsi</th>
              <th style="padding:12px 10px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;text-align:center">Qty</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;text-align:right">Harga</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:24px">
          <div style="width:100%">
            ${totalsTable}
            <div style="margin-top:10px;padding:12px 16px;background:${C.main};border-radius:8px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:16px;font-weight:700;color:${C.text};text-align:center">GRAND TOTAL</span>
              <span style="font-size:22px;font-weight:900;color:${C.text};text-align:center">${fmtRp(inv.grand)}</span>
            </div>
            ${dpRow}
          </div>
        </div>

        ${bankInfo}${notesRow}

        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px">
          <div>${stamp_bottom}</div>
          <div style="text-align:center">
            <div style="width:120px;height:60px;border-bottom:1.5px solid #CBD5E1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;margin-bottom:4px">${signImg}</div>
            <div style="font-size:12px;color:#9CA3AF">${xss(signLabel)}</div>
            ${s.storeName ? `<div style="font-size:13px;font-weight:600;color:#6B7280;margin-top:1px">${xss(s.storeName)}</div>` : ''}
          </div>
        </div>
      </div>

      <div style="background:linear-gradient(135deg,${C.softer},${C.soft});border-top:1px solid ${C.border};padding:18px 48px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:${C.dark};font-style:italic">${xss(thankyou)}</div>
        <div style="font-size:11px;color:${C.main};letter-spacing:.08em">NOTASERU · INVOICE PRO</div>
      </div>
    </div>`;

  // ── MINIMAL ─────────────────────────────────────────────────
  } else if (tpl === 'minimal') {
    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column">
      <!-- Header minimal -->
      <div style="padding:44px 56px 32px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111827">
        <div>
          <div style="font-size:44px;font-weight:900;color:#111827;letter-spacing:-.05em;line-height:1">INVOICE</div>
          <div style="font-size:12px;color:#9CA3AF;margin-top:6px;letter-spacing:.04em">${xss(inv.number)}</div>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:14px">
          <div>
            <div style="font-size:17px;font-weight:800;color:#111827">${xss(s.storeName||'Nama Toko')}</div>
            ${s.storeAddress ? `<div style="font-size:12px;color:#6B7280;margin-top:2px;line-height:1.4;word-break:break-word;white-space:normal;max-width:220px">${xss(s.storeAddress)}</div>` : ''}
            ${s.storePhone ? `<div style="font-size:12px;color:#6B7280">${xss(s.storePhone)}</div>` : ''}
          </div>
          <div style="width:56px;height:56px;border-radius:10px;overflow:hidden;background:#F3F4F6;border:1px solid #E5E7EB;display:flex;align-items:center;justify-content:center;flex-shrink:0">${logoImg}</div>
        </div>
      </div>

      <!-- Info strip -->
      <div style="padding:24px 56px;background:#F9FAFB;display:grid;grid-template-columns:1fr 1fr;gap:24px;border-bottom:1px solid #E5E7EB">
        <div>
          <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">Invoice Kepada</div>
          <div style="font-size:17px;font-weight:700;color:#111827">${xss(inv.customer?.name||'-')}</div>
          ${inv.customer?.phone ? `<div style="font-size:12px;color:#6B7280;margin-top:2px">${xss(inv.customer.phone)}</div>` : ''}
          ${inv.customer?.address ? `<div style="font-size:12px;color:#9CA3AF;margin-top:1px;line-height:1.4">${xss(inv.customer.address)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">Tanggal Invoice</div>
          <div style="font-size:16px;font-weight:600;color:#111827">${fmtDate(inv.date)}</div>
        </div>
      </div>

      <!-- Body -->
      <div style="flex:1;padding:32px 56px;position:relative">
        ${stamp_el}
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid #111827">
              <th style="padding:10px 0 12px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;text-align:left">Deskripsi</th>
              <th style="padding:10px 0 12px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;text-align:center">Qty</th>
              <th style="padding:10px 0 12px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;text-align:right">Harga</th>
              <th style="padding:10px 0 12px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:24px">
          <div style="width:100%">
            ${totalsTable}
            <div style="margin-top:10px;padding:12px 16px;border:2.5px solid ${C.dark};background:${C.soft};border-radius:8px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:16px;font-weight:700;color:${C.dark};text-align:center">GRAND TOTAL</span>
              <span style="font-size:22px;font-weight:900;color:${C.dark};text-align:center">${fmtRp(inv.grand)}</span>
            </div>
            ${dpRow}
          </div>
        </div>

        ${bankInfo}${notesRow}

        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px">
          <div>${stamp_bottom}</div>
          <div style="text-align:center">
            <div style="width:120px;height:60px;border-bottom:1.5px solid #CBD5E1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;margin-bottom:4px">${signImg}</div>
            <div style="font-size:12px;color:#9CA3AF">${xss(signLabel)}</div>
            ${s.storeName ? `<div style="font-size:13px;font-weight:600;color:#6B7280;margin-top:1px">${xss(s.storeName)}</div>` : ''}
          </div>
        </div>
      </div>

      <div style="border-top:2px solid ${C.border};background:${C.softer};padding:18px 56px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:${C.dark};font-style:italic">${xss(thankyou)}</div>
        <div style="font-size:11px;color:${C.main};letter-spacing:.08em">NOTASERU · INVOICE PRO</div>
      </div>
    </div>`;

  // ── BOLD ────────────────────────────────────────────────────
  } else if (tpl === 'bold') {
    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column">
      <!-- Header dark -->
      <div style="background:${C.darker};padding:40px 48px 32px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:60px;height:60px;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">${logoImg}</div>
            <div>
              <div style="font-size:19px;font-weight:800;color:${C.text}">${xss(s.storeName||'Nama Toko')}</div>
              ${s.storeAddress ? `<div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px;line-height:1.4;word-break:break-word;white-space:normal;max-width:220px">${xss(s.storeAddress)}</div>` : ''}
              ${s.storePhone ? `<div style="font-size:12px;color:rgba(255,255,255,.6)">${xss(s.storePhone)}</div>` : ''}
            </div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;text-align:center">Invoice</div>
            <div style="font-size:34px;font-weight:900;color:${C.text};letter-spacing:-.03em;line-height:1.1;text-align:center">${xss(inv.number)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px;text-align:center">${fmtDate(inv.date)}</div>
          </div>
        </div>
      </div>

      <!-- Customer strip -->
      <div style="background:${C.dark};padding:18px 48px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div>
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Invoice Kepada</div>
            <div style="font-size:17px;font-weight:700;color:${C.text}">${xss(inv.customer?.name||'-')}</div>
            ${inv.customer?.phone ? `<div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px">${xss(inv.customer.phone)}</div>` : ''}
            ${inv.customer?.address ? `<div style="font-size:12px;color:rgba(255,255,255,.4);margin-top:1px;line-height:1.4">${xss(inv.customer.address)}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Tanggal</div>
            <div style="font-size:14px;font-weight:600;color:${C.text}">${fmtDate(inv.date)}</div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div style="flex:1;padding:32px 48px;position:relative">
        ${stamp_el}
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:${C.darker};border-radius:6px">
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:left">Deskripsi</th>
              <th style="padding:12px 10px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:center">Qty</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:right">Harga</th>
              <th style="padding:12px 14px;font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.06em;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:24px">
          <div style="width:100%">
            ${totalsTable}
            <div style="margin-top:10px;padding:14px 16px;background:${C.main};border-radius:8px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:16px;font-weight:700;color:${C.text};text-align:center">GRAND TOTAL</span>
              <span style="font-size:22px;font-weight:900;color:${C.text};text-align:center">${fmtRp(inv.grand)}</span>
            </div>
            ${dpRow}
          </div>
        </div>

        ${bankInfo}${notesRow}

        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px">
          <div>${stamp_bottom}</div>
          <div style="text-align:center">
            <div style="width:120px;height:60px;border-bottom:1.5px solid #CBD5E1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;margin-bottom:4px">${signImg}</div>
            <div style="font-size:12px;color:#9CA3AF">${xss(signLabel)}</div>
            ${s.storeName ? `<div style="font-size:13px;font-weight:600;color:#6B7280;margin-top:1px">${xss(s.storeName)}</div>` : ''}
          </div>
        </div>
      </div>

      <div style="background:${C.darker};padding:18px 48px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:rgba(255,255,255,.7);font-style:italic">${xss(thankyou)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.4);letter-spacing:.08em">NOTASERU · INVOICE PRO</div>
      </div>
    </div>`;

  // ── ELEGANT ─────────────────────────────────────────────────
  // Layout dua-kolom (isi kiri + sidebar ringkasan kanan) — sangat berbeda
  // dari 4 template sebelumnya yang semuanya satu kolom dari atas ke bawah.
  } else if (tpl === 'elegant') {
    const elRows = (inv.items || []).filter(i => i.name).map((item, idx) => {
      const itemTotal = calcItemTotal(item);
      const hasDisc = item.discItem > 0;
      return `
      <tr>
        <td style="padding:10px 0;font-size:11px;color:#9CA3AF;border-bottom:1px solid #E7E1D5;vertical-align:top;width:22px">${String(idx+1).padStart(2,'0')}</td>
        <td style="padding:10px 10px;font-size:13.5px;color:#292420;border-bottom:1px solid #E7E1D5;font-family:Georgia,'Times New Roman',serif">
          ${xss(item.name)}${hasDisc ? `<div style="font-size:10.5px;color:${C.dark};margin-top:2px;font-family:-apple-system,sans-serif">diskon ${item.discItemType==='rupiah' ? fmtRp(item.discItem) : item.discItem+'%'}</div>` : ''}
          <div style="font-size:11px;color:#9CA3AF;margin-top:2px;font-family:-apple-system,sans-serif">${item.qty} × ${fmtRp(item.price)}</div>
        </td>
        <td style="padding:10px 0;font-size:13.5px;color:#292420;border-bottom:1px solid #E7E1D5;text-align:right;font-weight:600;font-family:Georgia,'Times New Roman',serif;white-space:nowrap">${fmtRp(itemTotal)}</td>
      </tr>`;
    }).join('');

    html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#292420;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column;background:#FFFDF8">
      <!-- Header centered, letterhead style -->
      <div style="padding:40px 56px 22px;text-align:center;border-bottom:3px double ${C.dark}">
        <div style="width:52px;height:52px;border-radius:50%;overflow:hidden;background:${C.softer};border:1px solid ${C.border};display:flex;align-items:center;justify-content:center;margin:0 auto 10px">${logoImg}</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1C1917;letter-spacing:.03em">${xss(s.storeName||'Nama Toko')}</div>
        <div style="font-size:11.5px;color:#78716C;margin-top:4px">${[s.storeAddress, s.storePhone].filter(Boolean).map(xss).join(' &nbsp;·&nbsp; ')}</div>
        <div style="font-size:11px;font-weight:700;color:${C.dark};letter-spacing:.35em;text-transform:uppercase;margin-top:16px">Invoice</div>
      </div>

      <!-- Body: 2 kolom -->
      <div style="flex:1;padding:32px 56px;display:grid;grid-template-columns:1fr 246px;gap:32px;align-items:start">
        <!-- Kolom kiri -->
        <div>
          <div style="margin-bottom:20px">
            <div style="font-size:10.5px;font-weight:700;color:#A8A29E;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px">Ditagihkan kepada</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:#1C1917">${xss(inv.customer?.name||'-')}</div>
            ${inv.customer?.phone ? `<div style="font-size:12px;color:#78716C;margin-top:2px">${xss(inv.customer.phone)}</div>` : ''}
            ${inv.customer?.address ? `<div style="font-size:11.5px;color:#A8A29E;margin-top:1px;line-height:1.5">${xss(inv.customer.address)}</div>` : ''}
          </div>

          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr>
                <th style="padding:0 0 8px;font-size:10.5px;font-weight:700;color:#A8A29E;text-transform:uppercase;letter-spacing:.1em;text-align:left;border-bottom:2px solid ${C.dark}">No</th>
                <th style="padding:0 0 8px 10px;font-size:10.5px;font-weight:700;color:#A8A29E;text-transform:uppercase;letter-spacing:.1em;text-align:left;border-bottom:2px solid ${C.dark}">Deskripsi</th>
                <th style="padding:0 0 8px;font-size:10.5px;font-weight:700;color:#A8A29E;text-transform:uppercase;letter-spacing:.1em;text-align:right;border-bottom:2px solid ${C.dark}">Jumlah</th>
              </tr>
            </thead>
            <tbody>${elRows}</tbody>
          </table>

          ${notesRow}

          <div style="margin-top:32px;display:flex;justify-content:flex-end">
            <div style="text-align:center">
              <div style="width:130px;height:58px;border-bottom:1.5px solid #D6D3D1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;margin-bottom:4px">${signImg}</div>
              <div style="font-size:11.5px;color:#A8A29E;font-family:Georgia,'Times New Roman',serif;font-style:italic">${xss(signLabel)}</div>
              ${s.storeName ? `<div style="font-size:12.5px;font-weight:700;color:#44403C;margin-top:1px">${xss(s.storeName)}</div>` : ''}
            </div>
          </div>
        </div>

        <!-- Sidebar kanan -->
        <div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;background:#fff">
          <div style="background:${C.softer};padding:14px 16px;border-bottom:1px solid ${C.border}">
            <div style="font-size:10px;font-weight:700;color:${C.dark};text-transform:uppercase;letter-spacing:.1em">No. Invoice</div>
            <div style="font-size:13px;font-weight:700;color:#1C1917;margin-top:2px">${xss(inv.number)}</div>
            <div style="font-size:10px;font-weight:700;color:${C.dark};text-transform:uppercase;letter-spacing:.1em;margin-top:10px">Tanggal</div>
            <div style="font-size:13px;font-weight:600;color:#1C1917;margin-top:2px">${fmtDate(inv.date)}</div>
          </div>
          <div style="padding:14px 16px">
            <div style="display:flex;justify-content:center;margin-bottom:14px">${stamp_bottom}</div>
            <div style="font-size:10px;font-weight:700;color:#A8A29E;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Ringkasan</div>
            <div style="font-size:12.5px;color:#57534E;display:flex;justify-content:space-between;padding:4px 0"><span>Subtotal</span><span style="font-weight:600;color:#292420">${fmtRp(inv.sub)}</span></div>
            ${inv.disc > 0 ? `<div style="font-size:12.5px;color:#57534E;display:flex;justify-content:space-between;padding:4px 0"><span>Diskon</span><span style="font-weight:600;color:#292420">- ${fmtRp(inv.discAmt)}</span></div>` : ''}
            ${inv.ongkir > 0 ? `<div style="font-size:12.5px;color:#57534E;display:flex;justify-content:space-between;padding:4px 0"><span>${ongkirLabel}</span><span style="font-weight:600;color:#292420">${fmtRp(inv.ongkir)}</span></div>` : ''}
            <div style="margin-top:10px;padding:12px 14px;background:${C.dark};border-radius:8px">
              <div style="font-size:10.5px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:.1em;opacity:.85">Grand Total</div>
              <div style="font-size:19px;font-weight:900;color:${C.text};margin-top:2px">${fmtRp(inv.grand)}</div>
            </div>
            ${dpRow}
          </div>
          ${bankInfo ? `<div style="padding:0 16px 16px">${bankInfo.replace('margin-top:16px;', 'margin-top:0;')}</div>` : ''}
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:18px 56px 30px;text-align:center;border-top:3px double ${C.dark}">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:13.5px;color:${C.dark};font-style:italic">${xss(thankyou)}</div>
        <div style="font-size:10px;color:#A8A29E;letter-spacing:.14em;margin-top:6px">NOTASERU · INVOICE PRO</div>
      </div>
    </div>`;

  // ── TICKET ──────────────────────────────────────────────────
  // Gaya struk/receipt sempit di tengah, monospace, garis putus-putus —
  // struktur & lebar berbeda total dari 5 template lainnya.
  } else if (tpl === 'ticket') {
    const tkItems = (inv.items || []).filter(i => i.name).map(item => {
      const itemTotal = calcItemTotal(item);
      const hasDisc = item.discItem > 0;
      return `
      <div style="padding:7px 0;border-bottom:1px dashed #D4D4D8">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span style="font-size:12.5px;color:#18181B;font-weight:700">${xss(item.name)}</span>
          <span style="font-size:12.5px;color:#18181B;font-weight:700;white-space:nowrap">${fmtRp(itemTotal)}</span>
        </div>
        <div style="font-size:11px;color:#71717A;margin-top:1px">${item.qty} x ${fmtRp(item.price)}${hasDisc ? `  (disc ${item.discItemType==='rupiah' ? fmtRp(item.discItem) : item.discItem+'%'})` : ''}</div>
      </div>`;
    }).join('');

    const dashRow = (label, val, bold) => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:${bold?'13.5px':'12px'};color:${bold?'#18181B':'#52525B'};font-weight:${bold?'800':'400'}">
      <span>${label}</span><span>${val}</span></div>`;

    html = `<div style="font-family:'Courier New',Courier,monospace;color:#18181B;width:794px;min-height:1123px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;background:#F4F4F5;padding:50px 0">
      <div style="width:380px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:0 28px 26px;position:relative">
        <!-- notch perforasi atas -->
        <div style="height:14px;margin:0 -28px 14px;background:radial-gradient(circle at 8px 0, transparent 8px, #fff 8.5px) repeat-x left top / 22px 14px, #F4F4F5"></div>

        <div style="text-align:center;padding-top:2px">
          <div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:#F4F4F5;display:flex;align-items:center;justify-content:center;margin:0 auto 8px">${logoImg}</div>
          <div style="font-size:15px;font-weight:800;letter-spacing:.02em;text-transform:uppercase">${xss(s.storeName||'Nama Toko')}</div>
          ${s.storeAddress ? `<div style="font-size:10.5px;color:#71717A;margin-top:4px;line-height:1.5">${xss(s.storeAddress)}</div>` : ''}
          ${s.storePhone ? `<div style="font-size:10.5px;color:#71717A">${xss(s.storePhone)}</div>` : ''}
        </div>

        <div style="border-top:1px dashed #A1A1AA;margin:14px 0 10px"></div>
        <div style="text-align:center;font-size:11px;color:#52525B">
          <div>No. ${xss(inv.number)}</div>
          <div style="margin-top:2px">${fmtDate(inv.date)}</div>
        </div>
        <div style="border-top:1px dashed #A1A1AA;margin:10px 0"></div>

        <div style="font-size:11px;color:#52525B;line-height:1.6">
          <div><strong style="color:#18181B">Kepada:</strong> ${xss(inv.customer?.name||'-')}</div>
          ${inv.customer?.phone ? `<div>${xss(inv.customer.phone)}</div>` : ''}
        </div>

        <div style="border-top:1px dashed #A1A1AA;margin:12px 0 2px"></div>
        ${tkItems}
        <div style="border-top:1px dashed #A1A1AA;margin:8px 0 6px"></div>

        ${dashRow('Subtotal', fmtRp(inv.sub))}
        ${inv.disc > 0 ? dashRow('Diskon', '- ' + fmtRp(inv.discAmt)) : ''}
        ${inv.ongkir > 0 ? dashRow(ongkirLabel, fmtRp(inv.ongkir)) : ''}
        <div style="border-top:1.5px dashed #18181B;margin:6px 0"></div>
        ${dashRow('TOTAL', fmtRp(inv.grand), true)}
        ${inv.dp > 0 ? dashRow('DP', fmtRp(inv.dp)) : ''}
        ${inv.dp > 0 ? dashRow('Sisa', fmtRp(inv.sisa), true) : ''}

        ${(s.bankName || s.bankNo) ? `<div style="border-top:1px dashed #A1A1AA;margin:10px 0 8px"></div>
        <div style="text-align:center;font-size:10.5px;color:#52525B;line-height:1.6">
          <div>Pembayaran: ${xss(s.bankName||'')} ${xss(s.bankNo||'')}</div>
          ${s.bankOwner ? `<div>a.n. ${xss(s.bankOwner)}</div>` : ''}
          ${s.bankNote ? `<div style="margin-top:3px">${xss(s.bankNote)}</div>` : ''}
        </div>` : ''}

        ${inv.notes ? `<div style="border-top:1px dashed #A1A1AA;margin:10px 0 8px"></div><div style="font-size:10.5px;color:#52525B;text-align:center;line-height:1.5">${xss(inv.notes)}</div>` : ''}

        <div style="border-top:1px dashed #A1A1AA;margin:14px 0 10px"></div>
        <div style="display:flex;justify-content:center;margin-bottom:6px"><div style="transform:scale(.82)">${stamp_bottom}</div></div>
        <div style="text-align:center">
          <div style="width:100px;height:44px;display:flex;align-items:flex-end;justify-content:center;margin:0 auto 2px">${signImg}</div>
          <div style="font-size:10px;color:#A1A1AA">${xss(signLabel)}</div>
        </div>

        <div style="text-align:center;font-size:11px;font-style:italic;color:#3F3F46;margin-top:14px">${xss(thankyou)}</div>
        <div style="text-align:center;font-size:9px;color:#A1A1AA;letter-spacing:.15em;margin-top:8px">· NOTASERU · INVOICE PRO ·</div>

        <!-- notch perforasi bawah -->
        <div style="height:14px;margin:14px -28px -26px;background:radial-gradient(circle at 8px 14px, transparent 8px, #fff 8.5px) repeat-x left bottom / 22px 14px, #F4F4F5"></div>
      </div>
    </div>`;
  }

  document.getElementById('invoicePreview').innerHTML = html;
  window._lastInvoiceHTML = html;
  // Auto-scale preview to fit screen
  requestAnimationFrame(scalePreview);
}

function scalePreview() {
  const wrap = document.getElementById('previewWrap');
  const scaler = document.getElementById('previewScaler');
  if (!wrap || !scaler) return;
  // Available width = wrap width minus padding (32px total)
  const available = wrap.clientWidth - 32;
  const invoiceWidth = 794;
  const scale = Math.min(1, available / invoiceWidth);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.transformOrigin = 'top center';
  scaler.style.display = 'block';
  // Set wrap height to exactly scaled invoice height (no extra gap)
  const invoiceHeight = 1123;
  const scaledH = invoiceHeight * scale;
  wrap.style.height = (scaledH + 20) + 'px';
  wrap.style.minHeight = '';
}
window.addEventListener('resize', () => { if (curPage === 'preview') scalePreview(); });


// ── Export ──────────────────────────────────

// ── Export Keuangan ke Excel ─────────────────
async function exportKeuanganXLSX() {
  try {
    toast('Menyiapkan data...', 'info');

    const invs    = DB.get('invoices', []);
    const exps    = DB.get('expenses', []);
    const settings = DB.get('settings', {});
    const bizName  = settings.businessName || 'Bisnis Saya';

    const fmtTgl = d => d ? new Date(d).toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' }) : '-';
    const fmtNum = n => Number(n) || 0;

    // ── Sheet 1: Ringkasan ──────────────────
    const totalOmset = invs.reduce((s,i) => s + fmtNum(i.grand), 0);
    const totalExp   = exps.reduce((s,e) => s + fmtNum(e.amount), 0);
    const totalLaba  = totalOmset - totalExp;
    const byStatus   = { lunas:0, dp:0, belum:0 };
    invs.forEach(i => { byStatus[i.status||'belum'] = (byStatus[i.status||'belum']||0) + fmtNum(i.grand); });

    const sheetRingkasan = [
      [`Laporan Keuangan — ${bizName}`],
      [`Diekspor:`, new Date().toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})],
      [],
      ['METRIK', 'NILAI (Rp)'],
      ['Total Omset (Pemasukan)', totalOmset],
      ['Total Pengeluaran', totalExp],
      ['Laba Bersih', totalLaba],
      [],
      ['STATUS PEMASUKAN', 'NILAI (Rp)'],
      ['✓ Lunas', byStatus.lunas],
      ['◐ DP / Uang Muka', byStatus.dp],
      ['✗ Belum Bayar', byStatus.belum],
      [],
      ['Jumlah Nota', invs.length],
      ['Jumlah Pengeluaran', exps.length],
    ];

    // ── Sheet 2: Pemasukan per transaksi ────
    const sortedInvs = [...invs].sort((a,b) => new Date(b.date||b.createdAt) - new Date(a.date||a.createdAt));
    const sheetPemasukan = [
      ['No','Tanggal','Nomor Nota','Nama Pelanggan','Status','Total (Rp)','Keterangan']
    ];
    sortedInvs.forEach((inv, idx) => {
      const statusLabel = inv.status === 'lunas' ? 'Lunas' : inv.status === 'dp' ? 'DP / Uang Muka' : 'Belum Bayar';
      sheetPemasukan.push([
        idx + 1,
        fmtTgl(inv.date || inv.createdAt),
        inv.number || '-',
        inv.customer?.name || '-',
        statusLabel,
        fmtNum(inv.grand),
        inv.notes || ''
      ]);
    });
    sheetPemasukan.push([], ['', '', '', '', 'TOTAL', totalOmset, '']);

    // ── Sheet 3: Pengeluaran per transaksi ──
    const sortedExps = [...exps].sort((a,b) => new Date(b.date) - new Date(a.date));
    const sheetPengeluaran = [
      ['No','Tanggal','Nama Pengeluaran','Kategori','Sumber','Jumlah (Rp)']
    ];
    sortedExps.forEach((exp, idx) => {
      const sumber = exp.sourceType === 'nota' ? 'Dari Nota' : exp.sourceType === 'grup' ? 'Dari Grup Nota' : 'Manual';
      sheetPengeluaran.push([
        idx + 1,
        fmtTgl(exp.date),
        exp.name || '-',
        exp.cat || 'lainnya',
        sumber,
        fmtNum(exp.amount)
      ]);
    });
    sheetPengeluaran.push([], ['', '', '', '', 'TOTAL', totalExp]);

    // ── Sheet 4: Grup transaksi (profit per nota) ──
    const sheetGrup = [
      ['No','Nomor Nota','Pelanggan','Omset (Rp)','Total Pengeluaran Nota (Rp)','Profit Bersih (Rp)','Margin (%)']
    ];
    sortedInvs.forEach((inv, idx) => {
      const profitData = DB.get('inv_profit_' + inv.id, null);
      const notaExp = profitData ? profitData.expenses.reduce((s,e) => s + (e.amount||0), 0) : null;
      const notaProfit = notaExp !== null ? fmtNum(inv.grand) - notaExp : null;
      const margin = (notaProfit !== null && fmtNum(inv.grand) > 0)
        ? ((notaProfit / fmtNum(inv.grand)) * 100).toFixed(1)
        : '-';
      sheetGrup.push([
        idx + 1,
        inv.number || '-',
        inv.customer?.name || '-',
        fmtNum(inv.grand),
        notaExp !== null ? notaExp : 'Belum dicatat',
        notaProfit !== null ? notaProfit : 'Belum dicatat',
        notaProfit !== null ? margin + '%' : '-'
      ]);
    });

    // ── Sheet 5: Grup Nota ──────────────────
    // Kumpulkan semua grup unik dari invoice
    const grupMap = {};
    invs.forEach(inv => {
      if (inv.grupKey) {
        if (!grupMap[inv.grupKey]) {
          const gdata = DB.get(inv.grupKey, null);
          grupMap[inv.grupKey] = { key: inv.grupKey, ids: inv.grupIds || [], data: gdata };
        }
      }
    });
    const allGrups = Object.values(grupMap);
    const sheetGrupNota = [
      ['No','Nama Grup','Nota-nota dalam Grup','Jumlah Nota','Total Omset (Rp)','Total Pengeluaran Grup (Rp)','Profit Bersih (Rp)','Margin (%)']
    ];
    allGrups.forEach((g, idx) => {
      const grupInvs = invs.filter(i => g.ids.includes(i.id));
      const grupOmset = grupInvs.reduce((s,i) => s + fmtNum(i.grand), 0);
      const grupExpTotal = g.data ? g.data.expenses.reduce((s,e) => s+(e.amount||0), 0) : 0;
      const grupProfit = grupOmset - grupExpTotal;
      const margin = grupOmset > 0 ? ((grupProfit/grupOmset)*100).toFixed(1)+'%' : '-';
      const notaNames = grupInvs.map(i => (i.customer?.name || i.number || i.id)).join(', ');
      const gName = g.data?.name || ('Grup ' + g.ids.length + ' Nota');
      sheetGrupNota.push([
        idx+1, gName, notaNames, g.ids.length, grupOmset, grupExpTotal, grupProfit, margin
      ]);
    });
    if (!allGrups.length) sheetGrupNota.push(['', 'Belum ada grup nota tersimpan']);

    // ── Build workbook ──────────────────────
    const XLSX = window.XLSX;
    if (!XLSX) { toast('Library Excel belum siap, coba lagi', 'err'); return; }

    const wb = XLSX.utils.book_new();

    const mkSheet = (data, colWidths) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = colWidths.map(w => ({ wch: w }));
      return ws;
    };

    XLSX.utils.book_append_sheet(wb, mkSheet(sheetRingkasan,    [28, 26]),              'Ringkasan');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetPemasukan,    [5,22,16,24,16,16,28]), 'Pemasukan');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetPengeluaran,  [5,22,28,16,14,16]),       'Pengeluaran');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetGrup,         [5,16,24,16,20,16,10]), 'Profit per Nota');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetGrupNota,     [5,22,38,12,18,20,16,10]), 'Grup Nota');

    const filename = `Keuangan_${bizName.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
    const wbArr = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob  = new Blob([wbArr], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Share sheet native (seperti ekspor PNG)
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare({ files:[file] })) {
          await navigator.share({ files:[file], title:`Data Keuangan — ${bizName}` });
          return;
        }
      } catch(err) {
        if (err.name === 'AbortError') return; // user cancel
      }
    }

    // Fallback download langsung
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('File Excel berhasil didownload ✓', 'ok');

  } catch(err) {
    console.error('exportKeuanganXLSX error:', err);
    toast('Gagal export: ' + err.message, 'err');
  }
}

// Helper: load gambar dari data URL → HTMLImageElement (aman, tidak taint canvas)
function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    if (!dataUrl) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}

// ── Export ──────────────────────────────────

// ── Export: Invoice HTML → Canvas (SVG foreignObject, zero CORS) ─────────────
// Strategy: measure actual rendered height from live preview, then embed
// the Poppins @font-face (already base64 in style.css) into the SVG so
// the exported image uses the exact same font as the preview.

function _buildExportHTML(inv) {
  buildPreview(inv);
  return window._lastInvoiceHTML || '';
}

// Extract all @font-face rules from page stylesheets (Poppins already embedded as base64)
function _extractFontFaceCSS() {
  try {
    const rules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            rules.push(rule.cssText);
          }
        }
      } catch(e) {} // skip cross-origin sheets
    }
    return rules.join('\n');
  } catch(e) { return ''; }
}


async function renderCanvas() {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  if (!inv) throw new Error('Invoice tidak ditemukan');

  // Rebuild HTML (now free of SVG background-image that taint iOS canvas)
  buildPreview(inv);
  const invoiceHTML = window._lastInvoiceHTML || '';
  if (!invoiceHTML) throw new Error('HTML nota kosong');

  const W = 794;

  // Isolated wrapper: render inside zero-scroll fixed host so html2canvas
  // never sees a non-zero scrollY offset (fixes text-shift-down bug)
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;top:0;left:0;width:794px;background:#ffffff;overflow:visible;box-shadow:none;border-radius:0;padding:0;margin:0;box-sizing:border-box';
  wrapper.innerHTML = invoiceHTML;

  // Clean up top-level div
  const topDiv = wrapper.firstElementChild;
  if (topDiv) {
    topDiv.style.boxShadow = 'none';
    topDiv.style.borderRadius = '0';
    topDiv.style.overflow = 'visible';
    topDiv.style.margin = '0';
  }

  // Mount inside a fixed zero-size host so page scroll = 0
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-9999px;width:794px;height:0;overflow:visible;z-index:-9999;pointer-events:none';
  host.appendChild(wrapper);
  document.body.appendChild(host);

  // Wait for fonts + full layout paint
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 250));

  const H = Math.max(wrapper.scrollHeight, 1123);
  wrapper.style.height = H + 'px';
  host.style.height = H + 'px';

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const canvas = await html2canvas(wrapper, {
    scale: 3,
    useCORS: false,
    allowTaint: false,
    backgroundColor: '#ffffff',
    width: W,
    height: H,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    windowWidth: W + 100,
    windowHeight: H + 100,
    logging: false,
    foreignObjectRendering: false,
    imageTimeout: 0
  });

  document.body.removeChild(host);
  return canvas;
}

// ── OLD Canvas 2D renderer — replaced by renderCanvas above ─────────────────
async function _renderCanvas_OLD() {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  if (!inv) throw new Error('Invoice tidak ditemukan');
  const s = DB.get('settings', {});
  const colorKey = inv.tplColor || curTplColor || 'amber';
  const C = TPL_COLORS[colorKey] || TPL_COLORS['custom'] || TPL_COLORS.amber;

  const W = 794, H = 1123, SC = 2; // A4 @ 72dpi, 2x scale
  const canvas = document.createElement('canvas');
  canvas.width = W * SC; canvas.height = H * SC;
  const ctx = canvas.getContext('2d');
  ctx.scale(SC, SC);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const FONT = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  function ff(size, weight, italic) {
    return `${italic?'italic ':''} ${weight||400} ${size}px/${size+4}px ${FONT}`;
  }
  function fmtM(n) { // format money
    return 'Rp' + Number(n||0).toLocaleString('id-ID');
  }
  function fmtD(ds) { // format date
    if (!ds) return '-';
    try { return new Date(ds).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); }
    catch(e){ return ds; }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r, y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x, y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  }
  function fillRoundRect(ctx,x,y,w,h,r,color) {
    ctx.fillStyle = color; roundRect(ctx,x,y,w,h,r); ctx.fill();
  }
  function strokeRoundRect(ctx,x,y,w,h,r,color,lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw||1;
    roundRect(ctx,x,y,w,h,r); ctx.stroke();
  }
  function wrapText(ctx, text, x, y, maxW, lineH) {
    // simple word wrap, returns final y
    const words = String(text||'').split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const test = line + words[n] + ' ';
      if (ctx.measureText(test).width > maxW && n > 0) {
        ctx.fillText(line.trim(), x, y);
        line = words[n] + ' ';
        y += lineH;
      } else { line = test; }
    }
    ctx.fillText(line.trim(), x, y);
    return y;
  }
  function truncate(ctx, text, maxW) {
    const t = String(text||'');
    if (ctx.measureText(t).width <= maxW) return t;
    let cut = t;
    while (cut.length > 1 && ctx.measureText(cut+'…').width > maxW) cut = cut.slice(0,-1);
    return cut + '…';
  }

  // ── Background ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── HEADER ───────────────────────────────────────────────────────────────
  const HDR_H = 110;
  // Header gradient via createLinearGradient
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, C.dark);
  grad.addColorStop(1, C.main);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, HDR_H);

  // Subtle diagonal stripes pattern
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  for (let xi = -H; xi < W+H; xi += 22) {
    ctx.beginPath(); ctx.moveTo(xi, 0); ctx.lineTo(xi+H, H); ctx.stroke();
  }
  ctx.restore();

  // Store name
  ctx.font = ff(22, 800);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(truncate(ctx, s.storeName||'Nama Toko', 280), 40, 40);

  // Store address / phone
  if (s.storeAddress || s.storePhone) {
    ctx.font = ff(11, 400);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    let iy = 58;
    if (s.storeAddress) { ctx.fillText(truncate(ctx, s.storeAddress, 280), 40, iy); iy += 15; }
    if (s.storePhone)   { ctx.fillText(truncate(ctx, s.storePhone, 280), 40, iy); }
  }

  // "INVOICE" text right side
  ctx.font = ff(38, 900);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText('INVOICE', W - 40, 46);
  ctx.font = ff(12, 400);
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.fillText(String(inv.number||''), W - 40, 64);

  // Logo (if exists, as image)
  if (s.logo) {
    try {
      const logoImg = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = s.logo; // always base64 data URL — safe
      });
      if (logoImg) {
        const lx = 40, ly = HDR_H - 56, lw = 50, lh = 50;
        ctx.save();
        roundRect(ctx, lx, ly, lw, lh, 8);
        ctx.clip();
        ctx.drawImage(logoImg, lx, ly, lw, lh);
        ctx.restore();
      }
    } catch(e) {}
  }

  // ── INFO BAR ─────────────────────────────────────────────────────────────
  const INFO_Y = HDR_H;
  const INFO_H = 68;
  ctx.fillStyle = C.softer || '#FFFBEB';
  ctx.fillRect(0, INFO_Y, W, INFO_H);
  ctx.strokeStyle = C.border || '#FDE68A';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, INFO_Y); ctx.lineTo(W, INFO_Y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, INFO_Y+INFO_H); ctx.lineTo(W, INFO_Y+INFO_H); ctx.stroke();

  // Customer info left
  ctx.font = ff(10, 700);
  ctx.fillStyle = C.dark;
  ctx.textAlign = 'left';
  ctx.fillText('INVOICE KEPADA', 40, INFO_Y + 18);
  ctx.font = ff(16, 700);
  ctx.fillStyle = '#111827';
  ctx.fillText(truncate(ctx, inv.customer?.name||'-', 320), 40, INFO_Y + 36);
  ctx.font = ff(11, 400);
  ctx.fillStyle = '#6B7280';
  let custY = INFO_Y + 50;
  if (inv.customer?.phone) { ctx.fillText(truncate(ctx, inv.customer.phone, 320), 40, custY); custY += 14; }

  // Date right
  ctx.font = ff(10, 700);
  ctx.fillStyle = C.dark;
  ctx.textAlign = 'right';
  ctx.fillText('TANGGAL', W-40, INFO_Y + 18);
  ctx.font = ff(13, 600);
  ctx.fillStyle = '#111827';
  ctx.fillText(fmtD(inv.date), W-40, INFO_Y + 36);

  // ── ITEMS TABLE ───────────────────────────────────────────────────────────
  let Y = INFO_Y + INFO_H + 24;
  const PAD = 40;
  const COL = { desc: PAD, qty: W-PAD-200, price: W-PAD-110, total: W-PAD };
  const TH_H = 32;

  // Table header
  const thGrad = ctx.createLinearGradient(PAD, Y, W-PAD, Y);
  thGrad.addColorStop(0, C.dark); thGrad.addColorStop(1, C.main);
  fillRoundRect(ctx, PAD, Y, W-PAD*2, TH_H, 6, 'transparent');
  ctx.fillStyle = thGrad;
  roundRect(ctx, PAD, Y, W-PAD*2, TH_H, 6);
  ctx.fill();

  ctx.font = ff(11, 700);
  ctx.fillStyle = C.text || '#FEF3C7';
  ctx.textAlign = 'left';
  ctx.fillText('DESKRIPSI', COL.desc + 10, Y + 20);
  ctx.textAlign = 'center';
  ctx.fillText('QTY', COL.qty + 30, Y + 20);
  ctx.textAlign = 'right';
  ctx.fillText('HARGA', COL.price, Y + 20);
  ctx.fillText('TOTAL', COL.total, Y + 20);

  Y += TH_H;

  // Table rows
  const items = (inv.items||[]).filter(i=>i.name);
  const ROW_H = 34;
  items.forEach((item, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#F9FAFB';
      ctx.fillRect(PAD, Y, W-PAD*2, ROW_H);
    }
    ctx.strokeStyle = '#F3F4F6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, Y+ROW_H); ctx.lineTo(W-PAD, Y+ROW_H); ctx.stroke();

    ctx.font = ff(13, 400);
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'left';
    ctx.fillText(truncate(ctx, item.name, COL.qty - COL.desc - 20), COL.desc + 10, Y + 21);
    ctx.textAlign = 'center';
    ctx.fillText(String(item.qty), COL.qty + 30, Y + 21);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#374151';
    ctx.fillText(fmtM(item.price), COL.price, Y + 21);
    ctx.font = ff(13, 700);
    ctx.fillStyle = '#111827';
    ctx.fillText(fmtM(item.qty * item.price), COL.total, Y + 21);
    Y += ROW_H;
  });

  Y += 16;

  // ── TOTALS ────────────────────────────────────────────────────────────────
  const TOT_X = W/2;
  const TOT_W = W/2 - PAD;

  function totRow(label, val, bold, color) {
    ctx.font = ff(13, bold ? 600 : 400);
    ctx.fillStyle = color || '#6B7280';
    ctx.textAlign = 'left';
    ctx.fillText(label, TOT_X, Y + 14);
    ctx.font = ff(13, bold ? 700 : 400);
    ctx.fillStyle = color || '#374151';
    ctx.textAlign = 'right';
    ctx.fillText(val, W - PAD, Y + 14);
    Y += 20;
  }

  totRow('Subtotal', fmtM(inv.sub), true, '#374151');
  if (inv.disc > 0) {
    const discLabel = 'Diskon ' + (inv.discType==='rupiah' ? fmtM(inv.disc) : inv.disc+'%');
    totRow(discLabel, '- '+fmtM(inv.discAmt), false, '#6B7280');
  }
  if (inv.ongkir > 0) {
    const ongLabel = inv.ekspedisi ? 'Ongkir ('+inv.ekspedisi+')' : 'Ongkir';
    totRow(ongLabel, fmtM(inv.ongkir), false, '#6B7280');
  }

  Y += 6;

  // Grand Total bar
  const GT_H = 40;
  const gtGrad = ctx.createLinearGradient(TOT_X-10, Y, W-PAD, Y);
  gtGrad.addColorStop(0, C.dark); gtGrad.addColorStop(1, C.main);
  fillRoundRect(ctx, TOT_X-10, Y, TOT_W+10, GT_H, 8, 'transparent');
  ctx.fillStyle = gtGrad;
  roundRect(ctx, TOT_X-10, Y, TOT_W+10, GT_H, 8); ctx.fill();
  ctx.font = ff(13, 700);
  ctx.fillStyle = C.text || '#FEF3C7';
  ctx.textAlign = 'left';
  ctx.fillText('GRAND TOTAL', TOT_X, Y + 25);
  ctx.font = ff(18, 800);
  ctx.textAlign = 'right';
  ctx.fillText(fmtM(inv.grand), W-PAD, Y + 26);
  Y += GT_H + 8;

  // DP / Sisa
  if (inv.dp > 0) {
    fillRoundRect(ctx, TOT_X-10, Y, TOT_W+10, 32, 6, C.dark);
    ctx.font = ff(12, 700); ctx.fillStyle = C.text; ctx.textAlign = 'left';
    ctx.fillText('DP / Uang Muka', TOT_X, Y + 21);
    ctx.textAlign = 'right';
    ctx.fillText(fmtM(inv.dp), W-PAD, Y + 21);
    Y += 38;
    fillRoundRect(ctx, TOT_X-10, Y, TOT_W+10, 34, 6, C.darker);
    ctx.strokeStyle = C.darkest || '#451A03'; ctx.lineWidth = 2;
    roundRect(ctx, TOT_X-10, Y, TOT_W+10, 34, 6); ctx.stroke();
    ctx.font = ff(13, 800); ctx.fillStyle = C.soft || '#FEF3C7'; ctx.textAlign = 'left';
    ctx.fillText('Sisa Pembayaran', TOT_X, Y + 23);
    ctx.textAlign = 'right';
    ctx.fillText(fmtM(inv.sisa), W-PAD, Y + 23);
    Y += 42;
  }

  // Bank info
  if (s.bankName || s.bankNo) {
    Y += 8;
    fillRoundRect(ctx, PAD, Y, W-PAD*2, 52, 8, '#F8FAFC');
    strokeRoundRect(ctx, PAD, Y, W-PAD*2, 52, 8, '#E5E7EB', 1);
    ctx.font = ff(10, 700); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'left';
    ctx.fillText('INFO PEMBAYARAN', PAD+12, Y + 16);
    ctx.font = ff(12, 400); ctx.fillStyle = '#374151';
    ctx.fillText((s.bankName||'') + '  ·  ' + (s.bankNo||''), PAD+12, Y + 32);
    if (s.bankOwner) { ctx.font = ff(11,400); ctx.fillStyle='#9CA3AF'; ctx.fillText('a.n. '+s.bankOwner, PAD+12, Y+46); }
    Y += 60;
  }

  // Notes
  if (inv.notes) {
    Y += 4;
    fillRoundRect(ctx, PAD, Y, W-PAD*2, 50, 8, '#F8FAFC');
    strokeRoundRect(ctx, PAD, Y, W-PAD*2, 50, 8, '#E5E7EB', 1);
    ctx.font = ff(10, 700); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'left';
    ctx.fillText('CATATAN', PAD+12, Y + 16);
    ctx.font = ff(12, 400); ctx.fillStyle = '#6B7280';
    wrapText(ctx, inv.notes, PAD+12, Y + 32, W-PAD*2-24, 16);
    Y += 56;
  }

  // ── SIGNATURE + STAMP ────────────────────────────────────────────────────
  Y = Math.max(Y + 24, H - 140); // push to bottom area

  // Stamp (status)
  const stampColors = { lunas:['#10B981','LUNAS'], dp:['#F59E0B','DP'], belum:['#EF4444','BELUM BAYAR'] };
  const [sc, sl] = stampColors[inv.status] || stampColors.belum;
  const SW = ctx.measureText(sl).width + 60;
  const SH = 36;
  const SX = PAD, SY = Y;
  strokeRoundRect(ctx, SX, SY, SW, SH, 8, sc, 3);
  ctx.fillStyle = sc + '1A';
  roundRect(ctx, SX, SY, SW, SH, 8); ctx.fill();
  ctx.font = ff(15, 900); ctx.fillStyle = sc; ctx.textAlign = 'center';
  ctx.fillText(sl, SX + SW/2, SY + 24);

  // Signature right
  const signLabel = s.signLabel || 'Hormat kami';
  ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W-180, Y+32); ctx.lineTo(W-PAD, Y+32); ctx.stroke();
  ctx.font = ff(11, 400); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center';
  ctx.fillText(signLabel, W-110, Y+46);
  if (s.storeName) {
    ctx.font = ff(12, 600); ctx.fillStyle = '#6B7280';
    ctx.fillText(truncate(ctx, s.storeName, 140), W-110, Y+60);
  }

  // Signature image
  if (s.signature) {
    try {
      const sigImg = await new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = s.signature;
      });
      if (sigImg) {
        const maxW=130, maxH=44, sx=W-180, sy=Y-12;
        const ratio=Math.min(maxW/sigImg.width, maxH/sigImg.height);
        const sw=sigImg.width*ratio, sh=sigImg.height*ratio;
        ctx.drawImage(sigImg, sx+(maxW-sw)/2, sy+(maxH-sh)/2, sw, sh);
      }
    } catch(e){}
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const FTR_Y = H - 44;
  ctx.fillStyle = C.soft || '#FEF3C7';
  ctx.fillRect(0, FTR_Y, W, 44);
  ctx.strokeStyle = C.main; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, FTR_Y); ctx.lineTo(W, FTR_Y); ctx.stroke();

  const thankyou = s.thankyou || 'Terima kasih atas kepercayaan Anda \uD83D\uDE4F';
  ctx.font = ff(12, 400, true); ctx.fillStyle = C.dark; ctx.textAlign = 'left';
  ctx.fillText(truncate(ctx, thankyou, 360), PAD, FTR_Y + 27);
  ctx.font = ff(10, 700, false); ctx.textAlign = 'right';
  ctx.fillText('NOTASERU · INVOICE PRO', W-PAD, FTR_Y + 27);

  return canvas;
}

// Helper: get invoice filename base
function invFilename() {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  return inv?.number || 'invoice';
}

// Helper: get WA message text
function waMessage() {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  const s = DB.get('settings', {});
  return `Halo kak, berikut invoice pesanan Anda 🙏\n\n📋 *${inv?.number || 'Invoice'}*\n👤 ${inv?.customer?.name || ''}\n💰 Total: ${fmtRp(inv?.grand || 0)}\n\n_Terima kasih sudah berbelanja di ${s.storeName || 'toko kami'}_ ✨`;
}

// Helper: get customer WA URL
function waURL(text) {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  const phone = inv?.customer?.phone?.replace(/[^0-9]/g, '') || '';
  const msg = encodeURIComponent(text);
  return phone
    ? `https://wa.me/${phone.startsWith('0') ? '62' + phone.slice(1) : phone}?text=${msg}`
    : `https://wa.me/?text=${msg}`;
}

// Pastikan halaman preview aktif sebelum export (fix utama: page-preview harus visible)
async function ensurePreviewVisible() {
  const pagePreview = document.getElementById('page-preview');
  if (!pagePreview.classList.contains('active')) {
    closeSheets();
    nav('preview');
    // Tunggu animasi page transition selesai
    await new Promise(r => setTimeout(r, 350));
  } else {
    closeSheets();
    await new Promise(r => setTimeout(r, 150));
  }
}

// Export PDF — canvas → jsPDF → share (works on iOS)
async function exportPDF() {
  toast('Menyiapkan PDF...');
  try {
    const fname = invFilename();
    // Render invoice to canvas (uses html2canvas on mobile)
    const canvas = await renderCanvas();
    const canvasW = canvas.width, canvasH = canvas.height;
    const mmW = 210;
    const mmH = Math.round((canvasH / canvasW) * mmW);

    // Build PDF from canvas image
    if (window.jspdf) {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [mmW, mmH] });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, mmW, mmH);
      const pdfBlob = pdf.output('blob');
      const file = new File([pdfBlob], `${fname}.pdf`, { type: 'application/pdf' });

      // Try Web Share API first (iOS/Android)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: fname, text: waMessage(), files: [file] });
          toast('PDF dibagikan ✓', 'ok');
          return;
        } catch (e) {
          if (e.name === 'AbortError') { toast('Dibatalkan', ''); return; }
        }
      }
      // Fallback: download
      pdf.save(`${fname}.pdf`);
      toast('PDF diunduh ✓', 'ok');
      openShareSheet('pdf', pdfBlob, fname);
    } else {
      // jsPDF belum load, fallback PNG
      toast('PDF library belum siap, coba lagi', 'err');
    }
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

// Export PNG — lalu tampilkan share sheet
async function exportPNG() {
  toast('Memproses gambar...');
  try {
    const canvas = await renderCanvas();
    const fname = invFilename();

    // FIX: canvas.toBlob() langsung — aman, tidak trigger SecurityError
    const blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob(function(b){ if(b) resolve(b); else reject(new Error('toBlob gagal')); }, 'image/png'); }
      catch(e){ reject(e); }
    });
    const file = new File([blob], `${fname}.png`, { type: 'image/png' });

    // Coba Web Share API (support di mobile)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: fname,
          text: waMessage(),
          files: [file]
        });
        toast('Dibagikan ✓', 'ok');
        return;
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') { toast('Dibatalkan', ''); return; }
        // fallback ke download
      }
    }
    // Fallback: langsung download + buka share sheet custom
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `${fname}.png`;
    a.href = url; a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
    toast('Gambar diunduh ✓', 'ok');
    openShareSheet('png', blob, fname);
  } catch (e) { toast('Gagal: ' + e.message, 'err'); }
}

// Share sheet fallback — muncul setelah download
function openShareSheet(type, blob, fname) {
  const objUrl = URL.createObjectURL(blob);
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  const s = DB.get('settings', {});
  const phone = inv?.customer?.phone?.replace(/[^0-9]/g, '') || '';
  const waNum = phone ? (phone.startsWith('0') ? '62' + phone.slice(1) : phone) : '';
  const waText = encodeURIComponent(waMessage());
  const waLink = waNum ? `https://wa.me/${waNum}?text=${waText}` : `https://wa.me/?text=${waText}`;
  const typeLabel = type === 'pdf' ? 'PDF' : 'Gambar PNG';
  const typeIcon = type === 'pdf'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

  document.getElementById('shareSheetContent').innerHTML = `
    <div style="padding:0 20px 8px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg-input);border-radius:var(--r-md);margin-bottom:16px">
        <div style="width:36px;height:36px;border-radius:var(--r-sm);background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center">${typeIcon}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--txt-1)">${fname}.${type}</div>
          <div style="font-size:11px;color:var(--txt-3)">Siap dibagikan</div>
        </div>
        <a href="${objUrl}" download="${fname}.${type}" style="margin-left:auto;padding:6px 12px;background:var(--primary);color:#fff;border-radius:var(--r-sm);font-size:11px;font-weight:700;text-decoration:none" onclick="toast('Diunduh ✓','ok')">Unduh</a>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Bagikan via</div>
    </div>
    <div class="as-item" onclick="window.open('${waLink}','_blank');closeSheets()">
      <div class="as-ic" style="background:#dcfce7;color:#16a34a">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#16a34a"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
      </div>
      <div><div class="as-label">WhatsApp</div><div class="as-sub">${waNum ? 'Kirim ke ' + inv?.customer?.name : 'Buka WhatsApp'}</div></div>
      <div style="margin-left:auto;padding:5px 12px;background:var(--success-soft);color:var(--success);border-radius:var(--r-full);font-size:11px;font-weight:700">Kirim</div>
    </div>
    <div class="as-item" onclick="shareViaEmail('${fname}','${type}','${objUrl}')">
      <div class="as-ic" style="background:var(--primary-soft);color:var(--primary)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <div><div class="as-label">Email</div><div class="as-sub">Kirim via aplikasi email</div></div>
    </div>
    <div class="as-item" onclick="copyWAText();closeSheets()">
      <div class="as-ic" style="background:var(--bg-input);color:var(--txt-2)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </div>
      <div><div class="as-label">Salin Pesan</div><div class="as-sub">Copy teks invoice ke clipboard</div></div>
    </div>
    <div style="height:8px"></div>
  `;
  openSheet('shareSheet');
}

function shareViaEmail(fname, type, objUrl) {
  const inv = DB.get('invoices', []).find(i => i.id === curInvId);
  const s = DB.get('settings', {});
  const subject = encodeURIComponent(`Invoice ${inv?.number || ''} - ${s.storeName || ''}`);
  const body = encodeURIComponent(`Halo,\n\nBerikut invoice pesanan Anda.\n\nNomor: ${inv?.number || ''}\nTotal: ${fmtRp(inv?.grand || 0)}\n\nTerima kasih,\n${s.storeName || ''}`);
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  closeSheets();
}

function copyWAText() {
  const text = waMessage();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Pesan disalin ✓', 'ok')).catch(() => fallbackCopy(text));
  } else { fallbackCopy(text); }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Pesan disalin ✓', 'ok'); } catch { toast('Gagal salin', 'err'); }
  document.body.removeChild(ta);
}

function sendWA() {
  window.open(waURL(waMessage()), '_blank');
}


// ── Dashboard ───────────────────────────────
function renderDashboard() {
  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();
  const invs = DB.get('invoices', []);
  const exps = DB.get('expenses', []);
  // Pemasukan: dari nota (invoices) bulan ini
  const mi = invs.filter(i => { const d = new Date(i.date||i.createdAt); return d.getMonth()===m && d.getFullYear()===y; });
  // Pengeluaran: dari tab pengeluaran bulan ini
  const me = exps.filter(e => { const d = new Date(e.date); return d.getMonth()===m && d.getFullYear()===y; });
  const income = mi.reduce((s,i) => s + (i.grand||0), 0);
  const expense = me.reduce((s,e) => s + (e.amount||0), 0);
  const laba = income - expense;
  setText('heroOmzet', fmtRp(income));
  setText('dashIncome', fmtRpShort(income));
  setText('dashExpense', fmtRpShort(expense));
  setText('dashCount', mi.length.toString());
  setText('dashLaba', fmtRp(laba));
  // Warna laba: hijau kalau positif, merah kalau minus
  const labaEl = document.getElementById('dashLaba');
  if (labaEl) labaEl.style.color = laba < 0 ? 'var(--danger,#DC2626)' : 'var(--success)';
  const s = DB.get('settings', {});
  const hn = document.getElementById('heroStoreName');
  if (hn) hn.textContent = s.storeName || 'Toko Saya';

}

// ── Finance Tab ──────────────────────────────
let _finPeriod = '1m', _finCustomFrom = null, _finCustomTo = null, _finTab = 'income';

function getFinDateRange() {
  const now = new Date();
  if (_finPeriod === '1m') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  if (_finPeriod === '3m') return { from: new Date(now.getFullYear(), now.getMonth()-2, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  if (_finPeriod === '6m') return { from: new Date(now.getFullYear(), now.getMonth()-5, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  if (_finPeriod === '1y') return { from: new Date(now.getFullYear()-1, now.getMonth()+1, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  if (_finPeriod === 'custom' && _finCustomFrom && _finCustomTo) {
    const [fy,fm] = _finCustomFrom.split('-').map(Number);
    const [ty,tm] = _finCustomTo.split('-').map(Number);
    return { from: new Date(fy, fm-1, 1), to: new Date(ty, tm, 0) };
  }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
}

function setFinPeriod(p, el) {
  _finPeriod = p;
  document.querySelectorAll('#finPeriodBar .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  if (p === 'custom') { openFinCustomModal(); return; }
  renderFinancePage();
}

function openFinCustomModal() {
  const m = document.getElementById('finCustomModal');
  if (m) { m.style.display = 'flex'; }
}
function closeFinCustomModal() {
  const m = document.getElementById('finCustomModal');
  if (m) m.style.display = 'none';
}
function applyFinCustomPeriod() {
  _finCustomFrom = document.getElementById('finFromMonth').value;
  _finCustomTo = document.getElementById('finToMonth').value;
  closeFinCustomModal();
  renderFinancePage();
}

function switchFinTab(tab) {
  _finTab = tab;
  const il = document.getElementById('finIncomeList'), el = document.getElementById('finExpenseList');
  const bi = document.getElementById('finTabIncome'), be = document.getElementById('finTabExpense');
  if (tab === 'income') {
    if (il) il.style.display = ''; if (el) el.style.display = 'none';
    if (bi) { bi.style.background = 'var(--primary)'; bi.style.color = '#fff'; }
    if (be) { be.style.background = 'var(--bg-input)'; be.style.color = 'var(--txt-2)'; }
  } else {
    if (el) el.style.display = ''; if (il) il.style.display = 'none';
    if (be) { be.style.background = 'var(--primary)'; be.style.color = '#fff'; }
    if (bi) { bi.style.background = 'var(--bg-input)'; bi.style.color = 'var(--txt-2)'; }
  }
}

function renderFinancePage() {
  const { from, to } = getFinDateRange();
  const invs = DB.get('invoices', []);
  const exps = DB.get('expenses', []);
  const filtInvs = invs.filter(i => { const d = new Date(i.date||i.createdAt); return d >= from && d <= to; });
  const filtExps = exps.filter(e => { const d = new Date(e.date); return d >= from && d <= to; });

  const totalOmset = filtInvs.reduce((s,i) => s+(i.grand||0), 0);
  const totalExp = filtExps.reduce((s,e) => s+(e.amount||0), 0);
  const totalLaba = totalOmset - totalExp;

  setText('finOmset', fmtRp(totalOmset));
  setText('finOmsetNote', `${filtInvs.length} nota`);
  const labaEl = document.getElementById('finLaba');
  if (labaEl) { labaEl.textContent = fmtRp(totalLaba); labaEl.style.color = totalLaba >= 0 ? 'var(--primary)' : 'var(--danger)'; }
  const labaNote = document.getElementById('finLabaNote');
  if (labaNote) labaNote.textContent = totalLaba >= 0 ? 'Profit' : 'Rugi';
  setText('finIncome', fmtRp(totalOmset));
  setText('finExpense', fmtRp(totalExp));

  // Build monthly data for chart
  const months = {};
  const addM = (dateStr, key, amt) => {
    const d = new Date(dateStr);
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!months[mk]) months[mk] = { omset:0, exp:0, count:0 };
    months[mk][key] += amt;
    if (key==='omset') months[mk].count++;
  };
  filtInvs.forEach(i => addM(i.date||i.createdAt, 'omset', i.grand||0));
  filtExps.forEach(e => addM(e.date, 'exp', e.amount||0));
  const sortedM = Object.entries(months).sort((a,b) => a[0].localeCompare(b[0]));

  // Draw chart
  drawFinChart(sortedM);

  // Render income list (tanpa riwayat nota - cukup summary)
  const incList = document.getElementById('finIncomeList');
  if (incList) {
    if (!filtInvs.length) {
      incList.innerHTML = emptyHTML('wallet','Belum Ada Pemasukan','Tidak ada invoice di periode ini');
    } else {
      const byStatus = { lunas:0, dp:0, belum:0 };
      filtInvs.forEach(i => { byStatus[i.status] = (byStatus[i.status]||0) + (i.grand||0); });
      incList.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${byStatus.lunas ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:var(--success-soft);border:1px solid rgba(16,185,129,0.35);border-radius:var(--r-md)"><div style="font-size:13px;font-weight:600;color:var(--success)">✓ Lunas</div><div style="font-size:13px;font-weight:700;color:var(--success)">${fmtRp(byStatus.lunas)}</div></div>` : ''}
          ${byStatus.dp ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:var(--warning-soft);border:1px solid rgba(245,158,11,0.35);border-radius:var(--r-md)"><div style="font-size:13px;font-weight:600;color:var(--warning)">◐ DP / Uang Muka</div><div style="font-size:13px;font-weight:700;color:var(--warning)">${fmtRp(byStatus.dp)}</div></div>` : ''}
          ${byStatus.belum ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:var(--danger-soft);border:1px solid rgba(244,63,94,0.35);border-radius:var(--r-md)"><div style="font-size:13px;font-weight:600;color:var(--danger)">✗ Belum Bayar</div><div style="font-size:13px;font-weight:700;color:var(--danger)">${fmtRp(byStatus.belum)}</div></div>` : ''}
          <div style="font-size:11px;color:var(--txt-3);text-align:center;margin-top:2px">${filtInvs.length} nota · Lihat detail di tab Nota</div>
        </div>`;
    }
  }

  // Render expense list
  const expList = document.getElementById('finExpenseList');
  if (expList) {
    const catIco = { operasional:'⚙️', bahan:'📦', transport:'🚚', marketing:'📣', gaji:'👤', utilitas:'⚡', lainnya:'🗂️' };
    const sorted = [...filtExps].sort((a,b) => new Date(b.date)-new Date(a.date));
    if (!sorted.length) {
      expList.innerHTML = emptyHTML('expense','Belum Ada Pengeluaran','Tambah pengeluaran dengan tombol +');
    } else {
      expList.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Riwayat Pengeluaran</div>` +
        sorted.map(e => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-md);margin-bottom:7px">
          <div style="width:38px;height:38px;border-radius:var(--r-sm);background:var(--danger-soft);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${catIco[e.cat]||'🗂️'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${xss(e.name)}</div>
            <div style="font-size:11px;color:var(--txt-3)">${e.date} · ${xss(e.cat||'lainnya')}${e.sourceType==='nota'?' · <span style=\"color:var(--primary);font-weight:600\">Dari Nota</span>':e.sourceType==='grup'?' · <span style=\"color:#5B4B8A;font-weight:600\">Dari Grup</span>':''}</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--danger);flex-shrink:0">-${fmtRp(e.amount)}</div>
        </div>`).join('');
    }
  }

  // Keep correct tab visible
  switchFinTab(_finTab);
}

let _finChartOpen = true;

function toggleFinChart() {
  _finChartOpen = !_finChartOpen;
  const body = document.getElementById('finChartBody');
  const chev = document.getElementById('finChartChevron');
  if (body) body.style.maxHeight = _finChartOpen ? '180px' : '0';
  if (chev) chev.style.transform = _finChartOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
}

function drawFinChart(sortedM) {
  const canvas = document.getElementById('finChart');
  if (!canvas || !_finChartOpen) return;
  requestAnimationFrame(() => {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const H = 120;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!sortedM.length) {
      ctx.fillStyle = '#bbb';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Belum ada data', W/2, H/2);
      return;
    }

    const padL = 8, padR = 8, padT = 12, padB = 22;
    const cW = W - padL - padR, cH = H - padT - padB;
    const n = sortedM.length;
    const omsets = sortedM.map(([,v]) => v.omset);
    const maxVal = Math.max(...omsets, 1);

    // Grid garis horizontal tipis
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1].forEach(r => {
      const gy = padT + cH * (1 - r);
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    });

    // Bar width — tipis seperti garis
    const slotW = n === 1 ? cW : cW / n;
    const barW = Math.max(3, Math.min(8, slotW * 0.35));

    omsets.forEach((v, i) => {
      const xCenter = n === 1 ? padL + cW / 2 : padL + i * slotW + slotW / 2;
      const barH = (v / maxVal) * cH;
      const x = xCenter - barW / 2;
      const y = padT + cH - barH;

      // Gradient per bar
      const grad = ctx.createLinearGradient(0, y, 0, padT + cH);
      grad.addColorStop(0, 'rgba(99,102,241,0.9)');
      grad.addColorStop(1, 'rgba(99,102,241,0.3)');

      // Bar dengan rounded top
      const r = Math.min(barW / 2, 3);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, padT + cH);
      ctx.lineTo(x, padT + cH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // Label bulan
    ctx.fillStyle = '#aaa';
    ctx.font = `${Math.max(8, Math.min(10, slotW * 0.55))}px sans-serif`;
    ctx.textAlign = 'center';
    sortedM.forEach(([mk], i) => {
      const [yr, mo] = mk.split('-').map(Number);
      const lbl = new Date(yr, mo - 1, 1).toLocaleDateString('id-ID', { month: 'short' });
      const xCenter = n === 1 ? padL + cW / 2 : padL + i * slotW + slotW / 2;
      ctx.fillText(lbl, xCenter, H - 5);
    });
  });
}

// Legacy shim – renderIncomePage is no longer needed but kept as alias
function renderMonthChips() {}
function renderIncomePage() { renderFinancePage(); }

// ── Expense ─────────────────────────────────
function renderExpensePage() {
  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();
  const exps = DB.get('expenses', []);
  const me = exps.filter(e => { const d = new Date(e.date); return d.getMonth()===m && d.getFullYear()===y; });
  const total = me.reduce((s,e) => s+(e.amount||0), 0);
  setText('expTotalVal', fmtRp(total));
  const el = document.getElementById('expMonthLbl');
  if (el) el.textContent = new Date(y,m,1).toLocaleDateString('id-ID', { month:'long', year:'numeric' });
  const catIco = { operasional:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', bahan:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>', transport:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', marketing:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>', gaji:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>', utilitas:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', lainnya:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>' };
  const list = document.getElementById('expList'); if (!list) return;
  const sorted = [...exps].sort((a,b) => new Date(b.date)-new Date(a.date));
  if (!sorted.length) { list.innerHTML = emptyHTML('expense', 'Belum Ada Pengeluaran', 'Catat pengeluaran pertama Anda'); return; }
  list.innerHTML = sorted.map(e => `
    <div class="exp-card">
      <div class="exp-ic">${catIco[e.category]||catIco.lainnya}</div>
      <div class="exp-info">
        <div class="exp-name">${xss(e.name)}</div>
        <div class="exp-date">${fmtDate(e.date)} · ${e.category||'lainnya'}</div>
        ${e.notes ? `<div style="font-size:11px;color:var(--txt-3);margin-top:2px">${xss(e.notes)}</div>` : ''}
      </div>
      <div class="exp-right">
        <div class="exp-amount">${fmtRp(e.amount)}</div>
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
          <button onclick="openExpenseSheet('${e.id}')" style="padding:4px 10px;border-radius:6px;background:var(--warning-soft);color:var(--warning);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Edit</button>
          <button onclick="delExp('${e.id}')" style="padding:4px 10px;border-radius:6px;background:var(--danger-soft);color:var(--danger);border:none;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Hapus</button>
        </div>
      </div>
    </div>`).join('');
}

function openExpenseSheet(id = null) {
  if (id) {
    const e = DB.get('expenses',[]).find(x => x.id === id); if (!e) return;
    setText('expSheetTitle', 'Edit Pengeluaran');
    document.getElementById('editExpId').value = e.id;
    document.getElementById('expName').value = e.name;
    document.getElementById('expCat').value = e.category;
    document.getElementById('expAmount').value = fmtRp(e.amount);
    document.getElementById('expDate').value = e.date;
    document.getElementById('expNotes').value = e.notes||'';
  } else {
    setText('expSheetTitle','Tambah Pengeluaran');
    document.getElementById('editExpId').value = '';
    document.getElementById('expName').value = '';
    document.getElementById('expAmount').value = '';
    document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('expNotes').value = '';
  }
  openSheet('expenseSheet');
}

function saveExpense() {
  const name = document.getElementById('expName').value.trim();
  const amount = parseMoney(document.getElementById('expAmount').value);
  const date = document.getElementById('expDate').value;
  if (!name) { toast('Nama wajib diisi', 'err'); return; }
  if (!amount) { toast('Nominal wajib diisi', 'err'); return; }
  const exps = DB.get('expenses', []);
  const eid = document.getElementById('editExpId').value;
  const exp = { id: eid||Date.now().toString(), name, amount, date, category: document.getElementById('expCat').value, notes: document.getElementById('expNotes').value };
  if (eid) { const idx = exps.findIndex(e => e.id === eid); exp.createdAt = idx !== -1 ? exps[idx].createdAt : Date.now(); if (idx !== -1) exps[idx]=exp; else exps.unshift(exp); }
  else { exp.createdAt = Date.now(); exps.unshift(exp); }
  DB.set('expenses', exps);
  closeSheets(); toast('Pengeluaran disimpan ✓', 'ok');
  renderExpensePage();
}

function delExp(id) {
  if (!confirm('Hapus pengeluaran ini?')) return;
  DB.set('expenses', DB.get('expenses',[]).filter(e => e.id !== id));
  toast('Dihapus', 'ok'); renderExpensePage();
}

// ── Settings ────────────────────────────────
function loadSettingsUI() {
  // Update tampilan akun setiap kali settings dibuka
  if (typeof updateSettAkunRow === 'function') updateSettAkunRow();
  const s = DB.get('settings', {});
  const fields = { settName:'storeName', settAddr:'storeAddress', settPhone:'storePhone', settEmail:'storeEmail', settBank:'bankName', settBankNo:'bankNo', settBankOwner:'bankOwner', settThankyou:'thankyou', settSignLabel:'signLabel', settBankNote:'bankNote' };
  const activeEl = document.activeElement;
  // Ambil draft lokal (ketikan yang belum disimpan) agar sync cloud tidak menimpa
  let draft = null;
  try { const raw = localStorage.getItem('ns3_settingsDraft'); if (raw) draft = JSON.parse(raw); } catch {}
  for (const [id, key] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) {
      // Jangan overwrite field yang sedang diketik user (mencegah teks hilang saat sync)
      if (el === activeEl) continue;
      // Prioritaskan draft lokal (ketikan belum tersimpan) atas data cloud
      el.value = (draft && draft[key] !== undefined) ? draft[key] : (s[key] || '');
      // Auto-resize textarea fields (rAF ensures the element is laid out/visible first)
      if (el.tagName === 'TEXTAREA') {
        requestAnimationFrame(() => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; });
      }
    }
  }
  // Reset logo
  const logoPrev = document.getElementById('logoPrev');
  const logoPh   = document.getElementById('logoPh');
  if (s.logo) {
    if (logoPrev) { logoPrev.src = s.logo; logoPrev.style.display = 'block'; }
    if (logoPh)   logoPh.style.display = 'none';
  } else {
    if (logoPrev) { logoPrev.src = ''; logoPrev.style.display = 'none'; }
    if (logoPh)   logoPh.style.display = '';
  }
  // Reset tanda tangan
  setText('signStatus', s.signature ? 'Tanda tangan tersimpan ✓' : '');
}

function applyAppearance() {
  const s = DB.get('settings', {});
  if (s.darkMode) { document.documentElement.setAttribute('data-theme','dark'); const t = document.getElementById('darkToggle'); if (t) t.checked = true; }
  if (s.themeColor) {
    document.documentElement.setAttribute('data-color', s.themeColor);
    setTimeout(() => { document.querySelectorAll('#colorPicker .color-opt').forEach(el => el.classList.toggle('active', el.dataset.c === s.themeColor)); }, 50);
  }
}

function saveSettings() {
  const s = DB.get('settings', {});
  const fields = { settName:'storeName', settAddr:'storeAddress', settPhone:'storePhone', settEmail:'storeEmail', settBank:'bankName', settBankNo:'bankNo', settBankOwner:'bankOwner', settThankyou:'thankyou', settSignLabel:'signLabel', settBankNote:'bankNote' };
  for (const [id, key] of Object.entries(fields)) {
    const el = document.getElementById(id); if (el) s[key] = el.value.trim();
  }
  // Hapus flag draft karena sudah disimpan resmi
  try { localStorage.removeItem('ns3_settingsDraft'); } catch {}
  DB.set('settings', s);
  renderDashboard();
  toast('Pengaturan disimpan ✓', 'ok');
}

// Simpan ketikan sementara ke localStorage agar tidak hilang saat sync cloud masuk.
// Dipanggil dari oninput pada field settings di HTML.
// Tidak push ke cloud — hanya pelindung sementara sampai user klik Simpan.
function _saveSettingsDraft() {
  try {
    const fields = { settName:'storeName', settAddr:'storeAddress', settPhone:'storePhone', settEmail:'storeEmail', settBank:'bankName', settBankNo:'bankNo', settBankOwner:'bankOwner', settThankyou:'thankyou', settSignLabel:'signLabel', settBankNote:'bankNote' };
    const draft = {};
    for (const [id, key] of Object.entries(fields)) {
      const el = document.getElementById(id); if (el) draft[key] = el.value;
    }
    localStorage.setItem('ns3_settingsDraft', JSON.stringify(draft));
  } catch {}
}

function uploadLogo(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    const data = e.target.result;
    // Simpan logo langsung ke localStorage dengan key ns3_logo (tanpa trigger DB.set patch)
    try { localStorage.setItem('ns3_logo', JSON.stringify(data)); } catch {}
    // Push logo ke cloud terpisah
    if (typeof CloudDB !== 'undefined' && CloudDB._push) CloudDB._push('logo', data);
    // Simpan ke settings untuk kompatibilitas render nota (slim, tanpa logo untuk cloud)
    const s = DB.get('settings', {}); s.logo = data; DB.set('settings', s);
    const p = document.getElementById('logoPrev'); const ph = document.getElementById('logoPh');
    if (p) { p.src = data; p.style.display = 'block'; } if (ph) ph.style.display = 'none';
    toast('Logo diupload ✓', 'ok');
  };
  r.readAsDataURL(file);
}

function toggleDark(on) {
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  const s = DB.get('settings', {}); s.darkMode = on; DB.set('settings', s);
}

function setColor(c, el) {
  document.documentElement.setAttribute('data-color', c);
  document.querySelectorAll('#colorPicker .color-opt').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  const s = DB.get('settings', {}); s.themeColor = c; DB.set('settings', s);
}

// ── Signature ───────────────────────────────
let _sd = false;
function openSheet_sign() { openSheet('signSheet'); setTimeout(initSignCanvas, 100); }
function initSignCanvas() {
  const canvas = document.getElementById('signatureCanvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ex = DB.get('settings',{}).signature;
  if (ex) { const img = new Image(); img.onload = () => { ctx.drawImage(img,0,0,rect.width,rect.height); signHasContent=true; document.getElementById('signPh').style.display='none'; }; img.src = ex; }
  const pos = e => { const r = canvas.getBoundingClientRect(); const t = e.touches?e.touches[0]:e; return { x:t.clientX-r.left, y:t.clientY-r.top }; };
  canvas.onmousedown = canvas.ontouchstart = e => { e.preventDefault(); _sd=true; signHasContent=true; document.getElementById('signPh').style.display='none'; const {x,y}=pos(e); ctx.beginPath(); ctx.moveTo(x,y); };
  canvas.onmousemove = canvas.ontouchmove = e => { e.preventDefault(); if(!_sd) return; const {x,y}=pos(e); ctx.lineTo(x,y); ctx.stroke(); };
  canvas.onmouseup = canvas.ontouchend = e => { e.preventDefault(); _sd=false; };
}
function clearSign() {
  const canvas = document.getElementById('signatureCanvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
  signHasContent = false; document.getElementById('signPh').style.display='flex';
  try { localStorage.removeItem('ns3_signature'); } catch {}
  if (typeof CloudDB !== 'undefined' && CloudDB._push) CloudDB._push('signature', null);
  const s = DB.get('settings',{}); delete s.signature; DB.set('settings',s);
  setText('signStatus','Ketuk untuk menggambar');
}
function saveSign() {
  if (!signHasContent) { toast('Gambar tanda tangan dulu', 'wrn'); return; }
  const canvas = document.getElementById('signatureCanvas');
  const dataUrl = canvas.toDataURL('image/png');
  // Simpan signature langsung ke localStorage (tanpa trigger DB.set patch)
  try { localStorage.setItem('ns3_signature', JSON.stringify(dataUrl)); } catch {}
  // Push signature ke cloud terpisah
  if (typeof CloudDB !== 'undefined' && CloudDB._push) CloudDB._push('signature', dataUrl);
  // Simpan ke settings untuk kompatibilitas render nota
  const s = DB.get('settings',{}); s.signature = dataUrl; DB.set('settings',s);
  setText('signStatus','Tanda tangan tersimpan ✓');
  closeSheets(); toast('Tanda tangan disimpan ✓', 'ok');
}

// ── Backup/Restore ──────────────────────────
function backupData() {
  const data = { invoices:DB.get('invoices',[]), expenses:DB.get('expenses',[]), settings:DB.get('settings',{}), exportedAt:new Date().toISOString(), version:'3.0' };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download = `notaseru-backup-${new Date().toISOString().split('T')[0]}.json`; a.click();
  toast('Backup berhasil ✓','ok');
}
function handleRestore(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!confirm('Restore data? Data saat ini akan diganti.')) return;
      if (d.invoices) DB.set('invoices',d.invoices);
      if (d.expenses) DB.set('expenses',d.expenses);
      if (d.settings) { DB.set('settings',d.settings); loadSettingsUI(); applyAppearance(); }
      toast('Data direstore ✓','ok'); renderDashboard();
    } catch { toast('File tidak valid','err'); }
  };
  r.readAsText(file); input.value='';
}
function confirmClear() {
  if (!confirm('HAPUS SEMUA DATA?\n\nTindakan ini TIDAK BISA dibatalkan!')) return;
  localStorage.clear(); toast('Data dihapus','ok'); setTimeout(()=>location.reload(),900);
}

// ── Calculator (floating) ──────────────────
// tokens = rangkaian angka & simbol operator yang SUDAH dikonfirmasi (belum dihitung).
// current = angka yang sedang diketik sekarang.
// exprDisplay = dipakai untuk menampilkan "expr =" setelah tombol "=" ditekan.
let calc = { tokens: [], current: '0', overwrite: true, exprDisplay: '' };
const CALC_OPS = ['+', '−', '×', '÷'];

function openCalculator() {
  renderCalcHistory();
  calcRender();
  document.getElementById('calcFab')?.classList.add('hide');
  openSheet('calcSheet');
}

// Tutup HANYA sheet kalkulator — sheet lain di belakangnya (mis. Kelola Profit)
// tetap terbuka. closeSheets() lama menutup SEMUA sheet sekaligus, makanya
// panel Kelola Profit ikut ketutup kalau kalkulator ditutup.
function closeCalcSheet() {
  const sheet = document.getElementById('calcSheet');
  if (!sheet) return;
  sheet.classList.remove('visible');
  document.getElementById('calcFab')?.classList.remove('hide');
  // Overlay & scroll lock cuma dilepas kalau memang sudah tidak ada sheet lain yang masih terbuka
  const anyOtherOpen = Array.from(document.querySelectorAll('.sheet.visible')).some(s => s.id !== 'calcSheet');
  if (!anyOtherOpen) {
    document.getElementById('overlay')?.classList.remove('visible');
    document.body.style.overflow = '';
  }
}

function calcFormatDisplay(str) {
  if (str === '' || str == null) return '0';
  str = String(str);
  let neg = str.startsWith('-');
  if (neg) str = str.slice(1);
  let [intPart, decPart] = str.split('.');
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (intPart === '') intPart = '0';
  let out = Number(intPart).toLocaleString('id-ID');
  if (decPart !== undefined) out += ',' + decPart;
  return (neg ? '-' : '') + out;
}

// Susun seluruh rangkaian token (yang sudah dikonfirmasi) jadi satu baris teks,
// supaya seluruh proses penjumlahan/pengurangan/dst tetap terlihat, bukan cuma operator terakhir.
function calcTokensText(tokens) {
  return tokens.map(t => CALC_OPS.includes(t) ? t : calcFormatDisplay(t)).join(' ');
}

function calcRender() {
  const exprEl = document.getElementById('calcExprLine');
  const mainEl = document.getElementById('calcMain');
  if (!exprEl || !mainEl) return;
  let top = calc.exprDisplay || calcTokensText(calc.tokens);
  exprEl.textContent = top;
  mainEl.textContent = calcFormatDisplay(calc.current);
  // Auto-scroll baris rangkaian ke kanan supaya bagian yang baru diketik selalu terlihat
  exprEl.scrollLeft = exprEl.scrollWidth;
}

function calcDigit(d) {
  if (calc.overwrite) {
    calc.current = d === '.' ? '0.' : d;
    calc.overwrite = false;
    calc.exprDisplay = '';
  } else {
    if (d === '.' && calc.current.includes('.')) { calcRender(); return; }
    if (calc.current === '0' && d !== '.') calc.current = d;
    else calc.current += d;
  }
  calcRender();
}

// Tambahkan operator ke rangkaian TANPA langsung menghitung —
// biar rangkaian penjumlahan/perkalian dsb tetap terlihat semua di atas.
function calcOp(symbol) {
  if (!CALC_OPS.includes(symbol)) return;
  const last = calc.tokens[calc.tokens.length - 1];
  if (calc.tokens.length && CALC_OPS.includes(last) && calc.overwrite) {
    // Operator ditekan dua kali berturut-turut -> ganti operator terakhir saja
    calc.tokens[calc.tokens.length - 1] = symbol;
  } else {
    calc.tokens.push(calc.current);
    calc.tokens.push(symbol);
  }
  calc.current = '0';
  calc.overwrite = true;
  calc.exprDisplay = '';
  calcRender();
}

// Hitung seluruh rangkaian sesuai urutan operasi matematika standar (× dan ÷ duluan,
// baru + dan −) — supaya hasilnya sama persis dengan kalkulator bawaan iOS/Android.
function calcEvalTokens(fullTokens) {
  // Tahap 1: selesaikan semua × dan ÷ dulu, sisain cuma angka + operator +/− di antaranya
  let vals = [parseFloat(fullTokens[0] || '0')];
  let ops = [];
  for (let i = 1; i < fullTokens.length; i += 2) {
    const op = fullTokens[i];
    const b = parseFloat(fullTokens[i + 1] || '0');
    if (op === '×' || op === '÷') {
      const last = vals[vals.length - 1];
      vals[vals.length - 1] = op === '×' ? last * b : (b === 0 ? NaN : last / b);
    } else {
      vals.push(b);
      ops.push(op);
    }
  }
  // Tahap 2: baru jumlahkan/kurangkan dari kiri ke kanan
  let r = vals[0];
  for (let i = 0; i < ops.length; i++) {
    r = ops[i] === '+' ? r + vals[i + 1] : r - vals[i + 1];
  }
  return r;
}

function calcEquals() {
  if (!calc.tokens.length) return; // belum ada operator yang ditekan
  const fullTokens = calc.tokens.concat([calc.current]);
  const exprText = calcTokensText(fullTokens);
  let r = calcEvalTokens(fullTokens);
  if (!isFinite(r)) { toast('Tidak bisa dibagi 0', 'err'); calcClearAll(); return; }
  r = Math.round(r * 1e8) / 1e8;
  const resultText = calcFormatDisplay(String(r));
  calcSaveHistory(exprText, resultText);
  calc.exprDisplay = exprText + ' =';
  calc.tokens = [];
  calc.current = String(r);
  calc.overwrite = true;
  calcRender();
}

function calcPercent() {
  const v = parseFloat(calc.current || '0');
  calc.current = String(v / 100);
  calc.overwrite = true;
  calcRender();
}

function calcToggleSign() {
  if (calc.current === '0') return;
  calc.current = calc.current.startsWith('-') ? calc.current.slice(1) : '-' + calc.current;
  calcRender();
}

function calcBackspace() {
  if (calc.overwrite) {
    // Belum ada digit baru diketik -> hapus operator terakhir dari rangkaian (kalau ada)
    if (calc.tokens.length && CALC_OPS.includes(calc.tokens[calc.tokens.length - 1])) {
      calc.tokens.pop();
      calc.current = calc.tokens.pop() ?? '0';
      calc.overwrite = false;
      calcRender();
    }
    return;
  }
  calc.current = calc.current.length > 1 ? calc.current.slice(0, -1) : '0';
  if (calc.current === '-') calc.current = '0';
  calcRender();
}

function calcClearAll() {
  calc = { tokens: [], current: '0', overwrite: true, exprDisplay: '' };
  calcRender();
}

function calcCopyCurrent() {
  calcCopyText(calcFormatDisplay(calc.current));
}

function calcCopyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Hasil disalin ✓', 'ok')).catch(() => fallbackCopy(text));
  } else { fallbackCopy(text); }
}

function calcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function calcSaveHistory(expr, result) {
  const nameInput = document.getElementById('calcNameInput');
  const name = nameInput ? nameInput.value.trim() : '';
  let hist = DB.get('calcHistory', []);
  hist.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), name, expr, result, ts: Date.now() });
  if (hist.length > 50) hist = hist.slice(0, 50);
  DB.set('calcHistory', hist);
  if (nameInput) nameInput.value = '';
  renderCalcHistory();
}

function renderCalcHistory() {
  const wrap = document.getElementById('calcHistoryList');
  if (!wrap) return;
  const hist = DB.get('calcHistory', []);
  if (!hist.length) {
    wrap.innerHTML = `<div class="calc-hist-empty">Belum ada riwayat perhitungan</div>`;
    return;
  }
  wrap.innerHTML = hist.map(h => `
    <div class="calc-hist-item" onclick="calcCopyText('${calcEsc(h.result).replace(/'/g, "\\'")}')">
      <div class="calc-hist-info">
        ${h.name ? `<div class="calc-hist-name">${calcEsc(h.name)}</div>` : ''}
        <div class="calc-hist-expr">${calcEsc(h.expr)}</div>
        <div class="calc-hist-result">= ${calcEsc(h.result)}</div>
      </div>
      <button class="calc-hist-copy" onclick="event.stopPropagation();calcCopyText('${calcEsc(h.result).replace(/'/g, "\\'")}')" title="Salin hasil">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>
  `).join('');
}

function calcClearHistory() {
  if (!confirm('Hapus semua riwayat perhitungan?')) return;
  DB.set('calcHistory', []);
  renderCalcHistory();
  toast('Riwayat dihapus', 'ok');
}

// Swipe-down-to-close pada kalkulator SAJA (bukan seluruh sheet yang sedang terbuka).
// Bisa di-drag dari handle, header, MAUPUN bagian tengah kalkulator (area display),
// tidak perlu selalu dari atas — tapi tombol angka/operator, input nama, dan riwayat
// tetap aman disentuh/scroll seperti biasa.
function initCalcSwipeClose() {
  const sheet = document.getElementById('calcSheet');
  if (!sheet) return;
  const handleZones = [sheet.querySelector('.sheet-handle'), sheet.querySelector('.sheet-hd')].filter(Boolean);
  const bodyZone = sheet.querySelector('.sheet-body');
  let startY = 0, deltaY = 0, dragging = false;

  function getY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

  // Elemen yang HARUS tetap bisa ditap/discroll normal -> jangan mulai drag-nutup dari sini
  function isInteractive(el) {
    return !!el.closest('button, input, textarea, select, .calc-hist-list, .calc-keypad, a');
  }

  function onStart(e, fromBody) {
    if (fromBody) {
      if (isInteractive(e.target)) return; // lagi pencet tombol/ketik nama -> jangan diganggu
      if (sheet.scrollTop > 0) return;     // lagi scroll baca riwayat -> jangan diganggu
    }
    dragging = true;
    startY = getY(e);
    deltaY = 0;
    sheet.style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging) return;
    deltaY = Math.max(0, getY(e) - startY);
    sheet.style.transform = `translateX(-50%) translateY(${deltaY}px)`;
    if (e.cancelable) e.preventDefault();
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (deltaY > 110) closeCalcSheet(); // <- nutup kalkulator SAJA, sheet lain di belakang tetap terbuka
    deltaY = 0;
  }

  handleZones.forEach(el => {
    el.addEventListener('touchstart', e => onStart(e, false), { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('mousedown', e => onStart(e, false));
  });
  if (bodyZone) {
    bodyZone.addEventListener('touchstart', e => onStart(e, true), { passive: true });
    bodyZone.addEventListener('touchmove', onMove, { passive: false });
    bodyZone.addEventListener('touchend', onEnd, { passive: true });
    bodyZone.addEventListener('mousedown', e => onStart(e, true));
  }
  document.addEventListener('mousemove', e => { if (dragging) onMove(e); });
  document.addEventListener('mouseup', onEnd);
}

// ── Sheets ──────────────────────────────────
function openSheet(id) {
  // Special handler for sign sheet
  if (id === 'signSheet') { document.getElementById('signSheet').classList.add('visible'); document.getElementById('overlay').classList.add('visible'); document.body.style.overflow='hidden'; setTimeout(initSignCanvas,120); return; }
  document.getElementById(id)?.classList.add('visible');
  document.getElementById('overlay')?.classList.add('visible');
  document.body.style.overflow='hidden';
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('visible'));
  document.getElementById('overlay')?.classList.remove('visible');
  document.body.style.overflow='';
  document.getElementById('calcFab')?.classList.remove('hide');
}

// ── Toast ───────────────────────────────────
function toast(msg, type='') {
  const wrap = document.getElementById('toastWrap'); if(!wrap) return;
  const t = document.createElement('div');
  t.className = `toast${type?' '+type:''}`;
  const ico = {ok:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>', err:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>', wrn:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'};
  t.innerHTML = `${ico[type]||'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'}<span>${msg}</span>`;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.cssText='opacity:0;transform:translateY(-8px) scale(.95);transition:.3s'; setTimeout(()=>t.remove(),300); },2500);
}

// ── PWA ─────────────────────────────────────
function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{}); }
function setupInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); window._dip = e;
    if (!DB.get('ibDismissed')) { const b = document.getElementById('installBanner'); if (b) b.classList.remove('gone'); }
  });
  window.addEventListener('appinstalled', () => { const b = document.getElementById('installBanner'); if(b) b.classList.add('gone'); toast('NotaSeru berhasil diinstall! 🎉','ok'); });
}
function triggerInstall() { if (window._dip) { window._dip.prompt(); document.getElementById('installBanner')?.classList.add('gone'); } }
function dismissInstall(e) { e.stopPropagation(); document.getElementById('installBanner')?.classList.add('gone'); DB.set('ibDismissed',true); }

// ── Utils ────────────────────────────────────
function fmtRp(n) {
  if (!n && n!==0) return 'Rp 0';
  return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0,maximumFractionDigits:0}).format(n);
}
function fmtRpShort(n) {
  if (n>=1e9) return 'Rp'+(n/1e9).toFixed(1)+'M';
  if (n>=1e6) return 'Rp'+(n/1e6).toFixed(1)+'jt';
  if (n>=1e3) return 'Rp'+(n/1e3).toFixed(0)+'rb';
  return fmtRp(n);
}
function parseMoney(v) { return parseInt(String(v||'').replace(/[^0-9]/g,''))||0; }
function fmtInline(input) { const r=parseMoney(input.value); if(r>0) input.value=fmtRp(r); else input.value=''; }
function fmtInlineFocus(input) { const r=parseMoney(input.value); if(!input.value||r===0) input.value=''; }
function fmtDiscFocus(input) {
  if (curDiscType === 'rupiah') { const r=parseMoney(input.value); if(!input.value||r===0) input.value=''; }
  else { if(!input.value||parseFloat(input.value)===0) input.value=''; }
}
function fmtDiscInput(input) {
  if(curDiscType==='rupiah') { const r=parseMoney(input.value); if(r>0) input.value=fmtRp(r); else input.value=''; }
  // for persen, just allow plain number
}
function fmtDate(s) { if(!s) return '-'; try { return new Date(s).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); } catch { return s; } }
function xss(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setText(id, txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }
function emptyHTML(type, title, sub) {
  const ico = { invoice:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', wallet:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>', expense:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/></svg>' };
  return `<div class="empty"><div class="empty-icon">${ico[type]||ico.invoice}</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div>`;
}

// ── Custom Color Picker ──────────────────────────────────────
let _cpHue = 30, _cpSat = 0.8, _cpVal = 0.7;
let _cpDragging = false, _cpHueDragging = false;

function hexToHsv(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d/max, v = max;
  if (d !== 0) {
    if (max === r) h = ((g-b)/d + (g<b?6:0))/6;
    else if (max === g) h = ((b-r)/d + 2)/6;
    else h = ((r-g)/d + 4)/6;
  }
  return [h*360, s, v];
}

function hsvToHex(h, s, v) {
  h = h/360; let r,g,b;
  const i = Math.floor(h*6), f = h*6-i, p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  switch(i%6){ case 0:r=v;g=t;b=p;break; case 1:r=q;g=v;b=p;break; case 2:r=p;g=v;b=t;break;
    case 3:r=p;g=q;b=v;break; case 4:r=t;g=p;b=v;break; case 5:r=v;g=p;b=q;break; }
  return '#' + [r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

function generateCustomTPLColor(hex) {
  // Parse hex to HSV, derive dark/darker/soft shades
  const [h,s,v] = hexToHsv(hex);
  const main = hex;
  const dark = hsvToHex(h, Math.min(s*1.1,1), v*0.65);
  const darker = hsvToHex(h, Math.min(s*1.2,1), v*0.45);
  const darkest = hsvToHex(h, Math.min(s*1.3,1), v*0.28);
  const soft = hsvToHex(h, s*0.18, 0.97);
  const softer = hsvToHex(h, s*0.08, 0.99);
  const text = hsvToHex(h, s*0.18, 0.98);
  const border = hsvToHex(h, s*0.35, 0.94);
  return { main, dark, darker, darkest, soft, softer, text, border };
}

function drawColorCanvas() {
  const cv = document.getElementById('colorPickerCanvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  // Saturation gradient (white to pure hue)
  const baseHex = hsvToHex(_cpHue, 1, 1);
  const gS = ctx.createLinearGradient(0,0,W,0);
  gS.addColorStop(0,'#fff'); gS.addColorStop(1, baseHex);
  ctx.fillStyle = gS; ctx.fillRect(0,0,W,H);
  // Value gradient (transparent to black)
  const gV = ctx.createLinearGradient(0,0,0,H);
  gV.addColorStop(0,'rgba(0,0,0,0)'); gV.addColorStop(1,'#000');
  ctx.fillStyle = gV; ctx.fillRect(0,0,W,H);
  // Cursor
  const cx = _cpSat * W, cy = (1-_cpVal) * H;
  ctx.beginPath(); ctx.arc(cx,cy,8,0,Math.PI*2);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,9.5,0,Math.PI*2);
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.5; ctx.stroke();
}

function drawHueSlider() {
  const cv = document.getElementById('hueSliderCanvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const g = ctx.createLinearGradient(0,0,W,0);
  for (let i=0;i<=12;i++) g.addColorStop(i/12, `hsl(${i/12*360},100%,50%)`);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  // Thumb
  const tx = (_cpHue/360)*W;
  ctx.beginPath(); ctx.arc(tx, H/2, H/2-1, 0, Math.PI*2);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(tx, H/2, H/2+0.5, 0, Math.PI*2);
  ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1.5; ctx.stroke();
}

function updateColorUI() {
  const hex = hsvToHex(_cpHue, _cpSat, _cpVal);
  const prev = document.getElementById('colorPreviewBox');
  const inp = document.getElementById('colorHexInput');
  if (prev) prev.style.background = hex;
  if (inp && document.activeElement !== inp) inp.value = hex.toUpperCase();
  drawColorCanvas(); drawHueSlider();
}

function openCustomColorPicker() {
  const modal = document.getElementById('customColorModal');
  if (!modal) return;
  modal.style.display = 'flex';
  // init from current custom or default amber
  _cpHue = 30; _cpSat = 0.82; _cpVal = 0.85;
  setTimeout(() => { drawColorCanvas(); drawHueSlider(); updateColorUI(); }, 30);

  // Canvas events
  const cv = document.getElementById('colorPickerCanvas');
  const hcv = document.getElementById('hueSliderCanvas');

  function getPos(e, el) {
    const r = el.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { x: (touch.clientX - r.left) / r.width, y: (touch.clientY - r.top) / r.height };
  }

  function onCvDown(e) { e.preventDefault(); _cpDragging = true; onCvMove(e); }
  function onCvMove(e) {
    if (!_cpDragging) return; e.preventDefault();
    const p = getPos(e, cv);
    _cpSat = Math.max(0,Math.min(1,p.x));
    _cpVal = Math.max(0,Math.min(1,1-p.y));
    updateColorUI();
  }
  function onCvUp() { _cpDragging = false; }

  function onHueDown(e) { e.preventDefault(); _cpHueDragging = true; onHueMove(e); }
  function onHueMove(e) {
    if (!_cpHueDragging) return; e.preventDefault();
    const p = getPos(e, hcv);
    _cpHue = Math.max(0,Math.min(359.9, p.x * 360));
    updateColorUI();
  }
  function onHueUp() { _cpHueDragging = false; }

  cv.onmousedown = onCvDown; cv.ontouchstart = onCvDown;
  cv.onmousemove = onCvMove; cv.ontouchmove = onCvMove;
  cv.onmouseup = onCvUp; cv.ontouchend = onCvUp;
  hcv.onmousedown = onHueDown; hcv.ontouchstart = onHueDown;
  hcv.onmousemove = onHueMove; hcv.ontouchmove = onHueMove;
  hcv.onmouseup = onHueUp; hcv.ontouchend = onHueUp;
  document.onmouseup = () => { _cpDragging = false; _cpHueDragging = false; };
}

function closeCustomColorPicker() {
  const modal = document.getElementById('customColorModal');
  if (modal) modal.style.display = 'none';
}

function onHexInput(val) {
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    const [h,s,v] = hexToHsv(val);
    _cpHue = h; _cpSat = s; _cpVal = v;
    const prev = document.getElementById('colorPreviewBox');
    if (prev) prev.style.background = val;
    drawColorCanvas(); drawHueSlider();
  }
}

function applyCustomColor() {
  const hex = hsvToHex(_cpHue, _cpSat, _cpVal);
  // Register as 'custom' in TPL_COLORS dynamically
  TPL_COLORS['custom'] = generateCustomTPLColor(hex);
  curTplColor = 'custom';
  // Update the custom button bg to show selected color
  const btn = document.getElementById('customColorBtn');
  if (btn) {
    btn.style.background = hex;
    btn.style.border = '3px solid var(--primary)';
  }
  // Deselect other dots
  document.querySelectorAll('.tpl-color-dot').forEach(d => d.classList.remove('active'));
  closeCustomColorPicker();
  recalc();
}

// ═══════════════════════════════════════════════════════
// FEATURE 1: Tambah Katalog dari Product Picker
// ═══════════════════════════════════════════════════════
let _fromPicker = false;

function openProductFormFromPicker() {
  _fromPicker = true;
  closeSheets();
  setTimeout(() => openProductForm(), 120);
}

// ═══════════════════════════════════════════════════════
// FEATURE 2: Riwayat Keuangan di Beranda
// ═══════════════════════════════════════════════════════
let _dashPeriod = '1m'; // '1m','3m','6m','1y','custom'
let _dashCustomFrom = null, _dashCustomTo = null;

function setDashPeriod(period, el) {
  _dashPeriod = period;
  document.querySelectorAll('#dashPeriodChips .chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  if (period === 'custom') { openDashPeriodPicker(); return; }
  renderDashHistory();
}

function openDashPeriodPicker() {
  const modal = document.getElementById('dashCustomPeriodModal');
  if (!modal) return;
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  const from3 = new Date(now.getFullYear(), now.getMonth()-2, 1);
  const fromStr = `${from3.getFullYear()}-${pad(from3.getMonth()+1)}`;
  document.getElementById('dashFromMonth').value = _dashCustomFrom || fromStr;
  document.getElementById('dashToMonth').value = _dashCustomTo || nowStr;
  modal.style.display = 'flex';
}

function closeDashPeriodPicker() {
  const modal = document.getElementById('dashCustomPeriodModal');
  if (modal) modal.style.display = 'none';
  // revert chip to previous
  if (_dashPeriod === 'custom' && !_dashCustomFrom) {
    _dashPeriod = '1m';
    document.querySelectorAll('#dashPeriodChips .chip').forEach((c,i) => c.classList.toggle('active', i===0));
  }
}

function applyCustomDashPeriod() {
  const from = document.getElementById('dashFromMonth').value;
  const to = document.getElementById('dashToMonth').value;
  if (!from || !to) { toast('Pilih periode lengkap', 'err'); return; }
  if (from > to) { toast('Tanggal awal harus sebelum akhir', 'err'); return; }
  _dashCustomFrom = from;
  _dashCustomTo = to;
  _dashPeriod = 'custom';
  closeDashPeriodPicker();
  // Update label
  const fmtM = s => { const [y,m] = s.split('-'); return new Date(y,m-1,1).toLocaleDateString('id-ID',{month:'short',year:'numeric'}); };
  const lbl = document.getElementById('dashPeriodLbl');
  if (lbl) lbl.textContent = `${fmtM(from)} – ${fmtM(to)}`;
  renderDashHistory();
}

function getDashDateRange() {
  const now = new Date();
  if (_dashPeriod === '1m') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  } else if (_dashPeriod === '3m') {
    return { from: new Date(now.getFullYear(), now.getMonth()-2, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  } else if (_dashPeriod === '6m') {
    return { from: new Date(now.getFullYear(), now.getMonth()-5, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  } else if (_dashPeriod === '1y') {
    return { from: new Date(now.getFullYear()-1, now.getMonth()+1, 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
  } else if (_dashPeriod === 'custom' && _dashCustomFrom && _dashCustomTo) {
    const [fy,fm] = _dashCustomFrom.split('-').map(Number);
    const [ty,tm] = _dashCustomTo.split('-').map(Number);
    return { from: new Date(fy, fm-1, 1), to: new Date(ty, tm, 0) };
  }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth()+1, 0) };
}

function renderDashHistory() {
  const { from, to } = getDashDateRange();
  const invs = DB.get('invoices', []);
  const exps = DB.get('expenses', []);

  const filtInvs = invs.filter(i => { const d = new Date(i.date||i.createdAt); return d >= from && d <= to; });
  const filtExps = exps.filter(e => { const d = new Date(e.date); return d >= from && d <= to; });

  const totalOmset = filtInvs.reduce((s,i) => s+(i.grand||0), 0);
  const totalExp = filtExps.reduce((s,e) => s+(e.amount||0), 0);
  const totalLaba = totalOmset - totalExp;

  const omsetEl = document.getElementById('dashHistOmset');
  const labaEl = document.getElementById('dashHistLaba');
  const omsetNote = document.getElementById('dashHistOmsetNote');
  const expNote = document.getElementById('dashHistExpNote');
  if (omsetEl) omsetEl.textContent = fmtRp(totalOmset);
  if (labaEl) { labaEl.textContent = fmtRp(totalLaba); labaEl.style.color = totalLaba >= 0 ? 'var(--primary)' : 'var(--danger)'; }
  if (omsetNote) omsetNote.textContent = `${filtInvs.length} nota`;
  if (expNote) expNote.textContent = `${filtExps.length} pengeluaran`;

  // Build monthly breakdown
  const months = {};
  const addMonth = (dateStr, key, amount) => {
    const d = new Date(dateStr);
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!months[mk]) months[mk] = { omset:0, exp:0, count:0 };
    months[mk][key] += amount;
    if (key === 'omset') months[mk].count++;
  };
  filtInvs.forEach(i => addMonth(i.date||i.createdAt, 'omset', i.grand||0));
  filtExps.forEach(e => addMonth(e.date, 'exp', e.amount||0));

  const sortedMonths = Object.entries(months).sort((a,b) => b[0].localeCompare(a[0]));
  const maxOmset = Math.max(...sortedMonths.map(([,v]) => v.omset), 1);

  const list = document.getElementById('dashHistList');
  if (!list) return;

  if (!sortedMonths.length) {
    list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--txt-3);font-size:13px">Tidak ada data di periode ini</div>`;
    return;
  }

  list.innerHTML = sortedMonths.map(([mk, v]) => {
    const [y,m] = mk.split('-').map(Number);
    const lbl = new Date(y,m-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'});
    const laba = v.omset - v.exp;
    const barW = Math.round((v.omset / maxOmset) * 100);
    const labaColor = laba >= 0 ? 'var(--success)' : 'var(--danger)';
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:var(--r-md);padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--txt-1)">${lbl}</div>
        <div style="font-size:10px;color:var(--txt-3)">${v.count} nota</div>
      </div>
      <!-- Bar -->
      <div style="height:5px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;overflow:hidden">
        <div style="height:100%;width:${barW}%;background:var(--primary);border-radius:4px;transition:width .4s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between">
        <div>
          <div style="font-size:9px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Omset</div>
          <div style="font-size:12px;font-weight:700;color:var(--txt-1)">${fmtRp(v.omset)}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:9px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Pengeluaran</div>
          <div style="font-size:12px;font-weight:700;color:var(--danger)">${fmtRp(v.exp)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:9px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Laba</div>
          <div style="font-size:12px;font-weight:700;color:${labaColor}">${fmtRp(laba)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// FEATURE 3: Rekomendasi nama pelanggan
// ═══════════════════════════════════════════════════════
function getCustomerSuggestions(q) {
  const invs = DB.get('invoices', []);
  const seen = new Map();
  invs.forEach(inv => {
    const name = inv.customer?.name?.trim();
    const phone = inv.customer?.phone?.trim() || '';
    const addr = inv.customer?.address?.trim() || '';
    if (name) {
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, phone, addr });
    }
  });
  const all = Array.from(seen.values());
  if (!q) return all.slice(0, 6);
  const lq = q.toLowerCase();
  return all.filter(c => c.name.toLowerCase().includes(lq)).slice(0, 6);
}

function onCustNameInput(val) {
  const box = document.getElementById('custSuggestBox');
  if (!box) return;
  const suggestions = getCustomerSuggestions(val.trim());
  if (!suggestions.length || (suggestions.length === 1 && suggestions[0].name.toLowerCase() === val.toLowerCase())) {
    box.style.display = 'none'; return;
  }
  box.style.display = 'block';
  box.innerHTML = suggestions.map(c => `
    <div onclick="applyCustSuggest(${JSON.stringify(c).replace(/"/g,'&quot;')})"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:10px;transition:background .15s"
      onmousedown="event.preventDefault()"
      ontouchstart="event.preventDefault();applyCustSuggest(${JSON.stringify(c).replace(/"/g,'&quot;')})"
      onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">
        ${c.name.charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${xss(c.name)}</div>
        ${c.phone ? `<div style="font-size:11px;color:var(--txt-3)">${xss(c.phone)}</div>` : ''}
      </div>
    </div>`).join('');
}

function applyCustSuggest(c) {
  const ni = document.getElementById('custName');
  const pi = document.getElementById('custPhone');
  const ai = document.getElementById('custAddr');
  if (ni) ni.value = c.name;
  if (pi && c.phone) pi.value = c.phone;
  if (ai && c.addr) ai.value = c.addr;
  hideCustSuggest();
}

function hideCustSuggest() {
  const box = document.getElementById('custSuggestBox');
  if (box) box.style.display = 'none';
}

// ── Export Keuangan Sheet ────────────────────────────────────────
let _exportPeriod = 'bulan_ini';
let _exportFmt = 'xlsx';

function openExportKeuanganSheet() {
  _exportPeriod = 'bulan_ini';
  _exportFmt = 'xlsx';
  // Reset tombol period
  document.querySelectorAll('.export-period-btn').forEach(b => b.classList.remove('active'));
  var ep = document.getElementById('ep_bulan_ini');
  if (ep) ep.classList.add('active');
  // Reset tombol format
  document.querySelectorAll('.export-fmt-btn').forEach(b => b.classList.remove('active'));
  var fx = document.getElementById('fmtXLSX');
  if (fx) fx.classList.add('active');
  // Set tanggal default = bulan ini
  _setDateRange('bulan_ini');
  _updateExportInfo();
  openSheet('exportKeuanganSheet');
}

function _pad(n) { return String(n).padStart(2,'0'); }
function _isoDate(d) { return d.getFullYear() + '-' + _pad(d.getMonth()+1) + '-' + _pad(d.getDate()); }

function _setDateRange(period) {
  var now = new Date(), y = now.getFullYear(), m = now.getMonth();
  var from, to;
  if (period === 'bulan_ini')  { from = new Date(y,m,1);    to = new Date(y,m+1,0); }
  else if (period === 'bulan_lalu') { from = new Date(y,m-1,1); to = new Date(y,m,0); }
  else if (period === '3_bulan')    { from = new Date(y,m-2,1); to = new Date(y,m+1,0); }
  else if (period === '6_bulan')    { from = new Date(y,m-5,1); to = new Date(y,m+1,0); }
  else if (period === 'tahun_ini')  { from = new Date(y,0,1);   to = new Date(y,11,31); }
  else                              { from = new Date(2000,0,1); to = new Date(2099,11,31); }
  var df = document.getElementById('exportDateFrom');
  var dt = document.getElementById('exportDateTo');
  if (df) df.value = _isoDate(from);
  if (dt) dt.value = _isoDate(to);
}

function selectExportPeriod(period, btn) {
  _exportPeriod = period;
  document.querySelectorAll('.export-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _setDateRange(period);
  _updateExportInfo();
}

function onCustomDateChange() {
  _exportPeriod = 'custom';
  document.querySelectorAll('.export-period-btn').forEach(b => b.classList.remove('active'));
  _updateExportInfo();
}

function selectExportFmt(fmt, btn) {
  _exportFmt = fmt;
  document.querySelectorAll('.export-fmt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function _updateExportInfo() {
  var info = document.getElementById('exportPeriodInfo');
  if (!info) return;
  var fromVal = document.getElementById('exportDateFrom').value;
  var toVal   = document.getElementById('exportDateTo').value;
  if (!fromVal || !toVal) { info.textContent = ''; return; }
  var fromD = new Date(fromVal + 'T00:00:00');
  var toD   = new Date(toVal   + 'T23:59:59');
  var invs  = DB.get('invoices',[]).filter(function(i){ var d=new Date(i.date||i.createdAt); return d>=fromD && d<=toD; });
  var exps  = DB.get('expenses',[]).filter(function(e){ var d=new Date(e.date); return d>=fromD && d<=toD; });
  var opts  = {day:'2-digit',month:'short',year:'numeric'};
  var fmtD  = function(s){ return new Date(s+'T00:00:00').toLocaleDateString('id-ID',opts); };
  if (_exportPeriod === 'semua') {
    info.textContent = 'Semua data  \u00b7  ' + invs.length + ' nota, ' + exps.length + ' pengeluaran';
  } else {
    info.textContent = fmtD(fromVal) + ' \u2013 ' + fmtD(toVal) + '  \u00b7  ' + invs.length + ' nota, ' + exps.length + ' pengeluaran';
  }
}

async function doExportKeuangan() {
  var fromVal = document.getElementById('exportDateFrom').value;
  var toVal   = document.getElementById('exportDateTo').value;
  if (!fromVal || !toVal) { toast('Pilih rentang tanggal dulu', 'err'); return; }
  var fromD = new Date(fromVal + 'T00:00:00');
  var toD   = new Date(toVal   + 'T23:59:59');
  if (fromD > toD) { toast('Tanggal awal harus sebelum akhir', 'err'); return; }
  closeSheets();
  if (_exportFmt === 'csv') {
    await _exportCSV(fromD, toD, fromVal, toVal);
  } else {
    await _exportXLSX(fromD, toD, fromVal, toVal);
  }
}

async function _shareOrDownload(blob, filename) {
  if (navigator.share && navigator.canShare) {
    try {
      var file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files:[file] })) {
        await navigator.share({ files:[file], title: filename });
        toast('Berhasil dibagikan \u2713', 'ok');
        return;
      }
    } catch(err) { if (err.name === 'AbortError') return; }
  }
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
  toast('File berhasil diunduh \u2713', 'ok');
}

async function _exportCSV(fromD, toD, fromVal, toVal) {
  try {
    toast('Menyiapkan CSV...');
    var invs = DB.get('invoices',[]).filter(function(i){ var d=new Date(i.date||i.createdAt); return d>=fromD && d<=toD; });
    var exps = DB.get('expenses',[]).filter(function(e){ var d=new Date(e.date); return d>=fromD && d<=toD; });
    var s    = DB.get('settings',{});
    var biz  = s.storeName || s.businessName || 'Bisnis Saya';
    var fmtT = function(d){ return d ? new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'}) : '-'; };
    var fmtN = function(n){ return Number(n)||0; };

    var csv  = 'Laporan Keuangan \u2014 ' + biz + '\n';
    csv += 'Periode: ' + (fromD.toLocaleDateString('id-ID')) + ' s.d. ' + (toD.toLocaleDateString('id-ID')) + '\n\n';
    csv += 'PEMASUKAN (NOTA)\nNo,Tanggal,Nomor Nota,Pelanggan,Status,Total\n';
    invs.sort(function(a,b){ return new Date(b.date||b.createdAt)-new Date(a.date||a.createdAt); })
      .forEach(function(inv,i){
        var st = inv.status==='lunas'?'Lunas':inv.status==='dp'?'DP':'Belum Bayar';
        csv += (i+1)+',"'+fmtT(inv.date||inv.createdAt)+'","'+(inv.number||'-')+'","'+(inv.customer&&inv.customer.name||'-')+'","'+st+'",'+fmtN(inv.grand)+'\n';
      });
    var totInv = invs.reduce(function(s,i){ return s+fmtN(i.grand); },0);
    csv += '\nTotal Pemasukan,,,,,'+totInv+'\n\nPENGELUARAN\nNo,Tanggal,Nama,Kategori,Jumlah\n';
    exps.sort(function(a,b){ return new Date(b.date)-new Date(a.date); })
      .forEach(function(exp,i){
        csv += (i+1)+',"'+fmtT(exp.date)+'","'+(exp.name||'-')+'","'+(exp.cat||'lainnya')+'",'+fmtN(exp.amount)+'\n';
      });
    var totExp = exps.reduce(function(s,e){ return s+fmtN(e.amount); },0);
    csv += '\nTotal Pengeluaran,,,,'+totExp+'\n';

    // Profit per nota (dari data pembukuan yang sudah disimpan)
    csv += '\nPROFIT PER NOTA\nNo,Tanggal,Nomor Nota,Pelanggan,Total Omset,Total Pengeluaran Nota,Profit Bersih,Margin\n';
    invs.slice().sort(function(a,b){ return new Date(b.date||b.createdAt)-new Date(a.date||a.createdAt); })
      .forEach(function(inv,i){
        var profitData = DB.get('inv_profit_'+inv.id, null);
        var totalExpNota = profitData ? profitData.expenses.reduce(function(s,e){ return s+(e.amount||0); },0) : null;
        var profit = totalExpNota !== null ? fmtN(inv.grand)-totalExpNota : null;
        var margin = (profit !== null && fmtN(inv.grand) > 0) ? ((profit/fmtN(inv.grand))*100).toFixed(1)+'%' : '-';
        csv += (i+1)+',"'+fmtT(inv.date||inv.createdAt)+'","'+(inv.number||'-')+'","'+((inv.customer&&inv.customer.name)||'-')+'",'+fmtN(inv.grand)+','+(totalExpNota!==null?totalExpNota:'"Belum dicatat"')+','+(profit!==null?profit:'"Belum dicatat"')+',"'+margin+'"\n';
      });

    var blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' });
    var fname = ('Keuangan_'+biz+'_'+fromVal+'_'+toVal+'.csv').replace(/[^a-zA-Z0-9_.]/g,'_');
    await _shareOrDownload(blob, fname);
  } catch(err) { toast('Gagal: '+err.message, 'err'); }
}

async function _exportXLSX(fromD, toD, fromVal, toVal) {
  try {
    toast('Menyiapkan Excel...');
    var XLSX = window.XLSX;
    if (!XLSX) { toast('Library Excel belum siap, coba lagi', 'err'); return; }

    var invs = DB.get('invoices',[]).filter(function(i){ var d=new Date(i.date||i.createdAt); return d>=fromD && d<=toD; });
    var exps = DB.get('expenses',[]).filter(function(e){ var d=new Date(e.date); return d>=fromD && d<=toD; });
    var s    = DB.get('settings',{});
    var biz  = s.storeName || s.businessName || 'Bisnis Saya';
    var fmtT = function(d){ return d ? new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'}) : '-'; };
    var fmtN = function(n){ return Number(n)||0; };
    var periodeStr = fromD.toLocaleDateString('id-ID') + ' s.d. ' + toD.toLocaleDateString('id-ID');

    var totInv = invs.reduce(function(s,i){ return s+fmtN(i.grand); },0);
    var totExp = exps.reduce(function(s,e){ return s+fmtN(e.amount); },0);
    var byStatus = {lunas:0,dp:0,belum:0};
    invs.forEach(function(i){ var k=i.status||'belum'; byStatus[k]=(byStatus[k]||0)+fmtN(i.grand); });

    var sheetRingkasan = [
      ['Laporan Keuangan \u2014 '+biz],
      ['Periode:', periodeStr],
      ['Diekspor:', new Date().toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})],
      [],
      ['METRIK','NILAI (Rp)'],
      ['Total Omset (Pemasukan)', totInv],
      ['Total Pengeluaran', totExp],
      ['Laba Bersih', totInv-totExp],
      [],
      ['STATUS PEMASUKAN','NILAI (Rp)'],
      ['\u2713 Lunas', byStatus.lunas],
      ['\u25d0 DP / Uang Muka', byStatus.dp],
      ['\u2717 Belum Bayar', byStatus.belum],
      [],
      ['Jumlah Nota', invs.length],
      ['Jumlah Pengeluaran', exps.length],
    ];

    var sortedInvs = invs.slice().sort(function(a,b){ return new Date(b.date||b.createdAt)-new Date(a.date||a.createdAt); });
    var sheetPemasukan = [['No','Tanggal','Nomor Nota','Nama Pelanggan','Status','Total (Rp)','Keterangan']];
    sortedInvs.forEach(function(inv,i){
      var st = inv.status==='lunas'?'Lunas':inv.status==='dp'?'DP / Uang Muka':'Belum Bayar';
      sheetPemasukan.push([i+1, fmtT(inv.date||inv.createdAt), inv.number||'-', (inv.customer&&inv.customer.name)||'-', st, fmtN(inv.grand), inv.notes||'']);
    });
    sheetPemasukan.push([],['','','','','TOTAL',totInv,'']);

    var sortedExps = exps.slice().sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
    var sheetPengeluaran = [['No','Tanggal','Nama Pengeluaran','Kategori','Jumlah (Rp)']];
    sortedExps.forEach(function(exp,i){
      sheetPengeluaran.push([i+1, fmtT(exp.date), exp.name||'-', exp.cat||'lainnya', fmtN(exp.amount)]);
    });
    sheetPengeluaran.push([],['','','','TOTAL',totExp]);

    // ── Sheet 4: Profit per Nota (dari data pembukuan) ─────────────
    var sheetProfit = [['No','Tanggal','Nomor Nota','Pelanggan','Status','Total Omset (Rp)','Total Pengeluaran Nota (Rp)','Profit Bersih (Rp)','Margin (%)']];
    sortedInvs.forEach(function(inv,i){
      var st = inv.status==='lunas'?'Lunas':inv.status==='dp'?'DP':'Belum Bayar';
      var profitData = DB.get('inv_profit_'+inv.id, null);
      var totalExpNota = profitData ? profitData.expenses.reduce(function(s,e){ return s+(e.amount||0); },0) : null;
      var profit = totalExpNota !== null ? fmtN(inv.grand) - totalExpNota : null;
      var margin = (profit !== null && fmtN(inv.grand) > 0) ? ((profit/fmtN(inv.grand))*100).toFixed(1)+'%' : '-';
      sheetProfit.push([
        i+1,
        fmtT(inv.date||inv.createdAt),
        inv.number||'-',
        (inv.customer&&inv.customer.name)||'-',
        st,
        fmtN(inv.grand),
        totalExpNota !== null ? totalExpNota : 'Belum dicatat',
        profit !== null ? profit : 'Belum dicatat',
        margin
      ]);
    });
    var totProfit = sortedInvs.reduce(function(acc,inv){
      var pd = DB.get('inv_profit_'+inv.id, null);
      if (!pd) return acc;
      var expTotal = pd.expenses.reduce(function(s,e){ return s+(e.amount||0); },0);
      return acc + fmtN(inv.grand) - expTotal;
    }, 0);
    sheetProfit.push([],['','','','','TOTAL PROFIT','','',totProfit,'']);

    var mkSheet = function(data, widths){
      var ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = widths.map(function(w){ return {wch:w}; });
      return ws;
    };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetRingkasan,[28,26]), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetPemasukan,[5,22,16,24,16,16,28]), 'Pemasukan');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetPengeluaran,[5,22,28,16,16]), 'Pengeluaran');
    XLSX.utils.book_append_sheet(wb, mkSheet(sheetProfit,[5,18,16,22,12,16,14,14,10]), 'Profit per Nota');

    var wbArr = XLSX.write(wb, {bookType:'xlsx',type:'array'});
    var blob  = new Blob([wbArr], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var fname = ('Keuangan_'+biz+'_'+fromVal+'_'+toVal+'.xlsx').replace(/[^a-zA-Z0-9_.]/g,'_');
    await _shareOrDownload(blob, fname);
  } catch(err) { toast('Gagal: '+err.message, 'err'); }
}

/* =========================================================
   NotaSeru — NSPrint: cetak bersama (Kasir + Invoice)
   • Thermal 58/80 mm via Bluetooth BLE (Web Bluetooth, ESC/POS)
   • Thermal via RawBT (Android, printer Bluetooth klasik/SPP)
   • Dialog cetak sistem (USB/WiFi/AirPrint/PDF) untuk thermal, A5, A4
   ========================================================= */
(function () {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CFG_KEY = 'ns3_printCfg';
const PAPERS = {
  '58': { n: 'Thermal 58 mm', th: true, cols: 32, colsS: 42, css: '58mm auto', w: '54mm' },
  '80': { n: 'Thermal 80 mm', th: true, cols: 48, colsS: 64, css: '80mm auto', w: '76mm' },
  'a5': { n: 'A5', th: false, css: 'A5 portrait', ratio: 210 / 148 },
  'a4': { n: 'A4', th: false, css: 'A4 portrait', ratio: 297 / 210 },
};
const P = { cfg: { method: 'ble', paper: '58', small: false, cut: true, drawer: false, copies: 1, auto: false, btName: '', chunk: 100 }, doc: null, mode: 'print' };
try { Object.assign(P.cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
if (!PAPERS[P.cfg.paper]) P.cfg.paper = '58';
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(P.cfg)); } catch (e) {} };
const isThermal = (p) => PAPERS[p || P.cfg.paper].th;

function say(m, err) {
  const t = document.createElement('div'); t.className = 'nsp-toast' + (err ? ' err' : ''); t.textContent = m;
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4200 : 2400);
}

/* ---------- teks -> ASCII aman untuk printer ---------- */
function asc(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/[^\x20-\x7e]/g, '?');
}
function wrapTxt(s, w) {
  s = asc(s); const out = []; s.split('\n').forEach(par => {
    let line = ''; par.split(' ').forEach(word => {
      while (word.length > w) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!line) line = word; else if ((line + ' ' + word).length <= w) line += ' ' + word; else { out.push(line); line = word; }
    }); out.push(line);
  });
  return out;
}

/* ---------- ESC/POS ---------- */
function Esc(cols, small) {
  const b = [];
  const o = {
    b, cols,
    raw(...a) { b.push(...a); return o; },
    init() { return o.raw(0x1b, 0x40, 0x1b, 0x74, 0x00, 0x1b, 0x4d, small ? 1 : 0); },
    al(n) { return o.raw(0x1b, 0x61, n); },
    bold(on) { return o.raw(0x1b, 0x45, on ? 1 : 0); },
    sz(w, h) { return o.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); },
    t(s) { const a = asc(s); for (let i = 0; i < a.length; i++) b.push(a.charCodeAt(i)); return o; },
    nl(n) { for (let i = 0; i < (n || 1); i++) b.push(0x0a); return o; },
    hr(c) { return o.t((c || '-').repeat(cols)).nl(); },
    row(l, r, w) {
      w = w || cols; l = asc(l); r = asc(r);
      const room = w - r.length - 1; if (l.length > room) l = l.slice(0, Math.max(0, room));
      return o.t(l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r).nl();
    },
    kv(l, v) { // label: nilai — bungkus jika terlalu panjang
      l = asc(l); v = asc(v);
      if (l.length + v.length + 1 <= cols) return o.row(l, v);
      o.t(l).nl(); wrapTxt(v, cols - 2).forEach(x => o.t('  ' + x).nl()); return o;
    },
    cut(doCut) { return doCut ? o.nl(3).raw(0x1d, 0x56, 0x42, 0x00) : o.nl(4); },
    drawer() { return o.raw(0x1b, 0x70, 0x00, 0x19, 0xfa); },
  };
  return o;
}
function escBytes(doc, c) {
  const p = PAPERS[c.paper], cols = c.small ? p.colsS : p.cols, all = [];
  const copies = Math.max(1, Math.min(5, c.copies | 0 || 1));
  for (let k = 0; k < copies; k++) {
    const e = Esc(cols, c.small).init();
    if (k === 0 && c.drawer && doc.drawer) e.drawer();
    e.al(1);
    const nm = asc(doc.store.name || '');
    if (nm) { if (nm.length * 2 <= cols) e.bold(1).sz(2, 2).t(nm).nl().sz(1, 1).bold(0); else { e.bold(1).sz(1, 2); wrapTxt(nm, cols).forEach(x => e.t(x).nl()); e.sz(1, 1).bold(0); } }
    (doc.store.addr || []).forEach(a => wrapTxt(a, cols).forEach(x => e.t(x).nl()));
    if (doc.kind === 'invoice') e.nl().bold(1).sz(1, 2).t(doc.title || 'INVOICE').nl().sz(1, 1).bold(0);
    e.al(0).hr('-');
    (doc.meta || []).forEach(m => { if (m[1] !== '' && m[1] != null) e.kv(m[0], m[1]); });
    if (doc.party && doc.party.length) { e.hr('-'); doc.party.forEach(m => { if (m[1]) e.kv(m[0], m[1]); }); }
    e.hr('-');
    (doc.items || []).forEach(it => {
      e.bold(1); wrapTxt(it.name, cols).forEach(x => e.t(x).nl()); e.bold(0);
      e.row(it.qty + ' x ' + it.price, it.total);
      if (it.note) wrapTxt(it.note, cols - 2).forEach(x => e.t('  ' + x).nl());
    });
    e.hr('-');
    (doc.totals || []).forEach(t => {
      if (t.big) { e.hr('-').bold(1).sz(1, 2).row(t.l, t.v).sz(1, 1).bold(0); }
      else if (t.bold) e.bold(1).row(t.l, t.v).bold(0); else e.row(t.l, t.v);
    });
    e.hr('-');
    e.al(1); (doc.footer || []).forEach(f => wrapTxt(f, cols).forEach(x => e.t(x).nl()));
    e.al(0).cut(c.cut);
    all.push(...e.b);
  }
  return new Uint8Array(all);
}

/* ---------- Bluetooth BLE ---------- */
const SERV = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb'];
let dev = null, chr = null;
const bleOK = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
function bindDev(d) { dev = d; chr = null; d.addEventListener('gattserverdisconnected', () => { chr = null; }); }
async function pair() {
  if (!bleOK()) throw new Error('Browser ini belum mendukung Bluetooth langsung. Gunakan Chrome (Android/komputer), browser Bluefy (iPhone/iPad), atau pilih RawBT / Dialog cetak.');
  const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERV });
  bindDev(d); P.cfg.btName = d.name || 'Printer'; saveCfg(); return d;
}
async function getChr() {
  if (!bleOK()) throw new Error('Browser ini belum mendukung Bluetooth langsung.');
  if (!dev && navigator.bluetooth.getDevices) { try { const ds = await navigator.bluetooth.getDevices(); const d = ds.find(x => x.name === P.cfg.btName); if (d) bindDev(d); } catch (e) {} }
  if (!dev) await pair();
  if (chr && dev.gatt.connected) return chr;
  const srv = await dev.gatt.connect(), svcs = await srv.getPrimaryServices();
  for (const s of svcs) { for (const c of await s.getCharacteristics()) { if (c.properties.writeWithoutResponse || c.properties.write) { chr = c; return c; } } }
  throw new Error('Printer ini tidak punya jalur tulis BLE. Kemungkinan printer Bluetooth klasik: coba RawBT.');
}
async function bleWrite(bytes, size) {
  const c = await getChr();
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.slice(i, i + size);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part); else await c.writeValue(part);
    await sleep(25);
  }
}
async function bleSend(bytes) {
  try { await bleWrite(bytes, P.cfg.chunk || 100); }
  catch (e) { if (e && e.name === 'NotFoundError') throw e; chr = null; await sleep(300); await bleWrite(bytes, 20); P.cfg.chunk = 20; saveCfg(); }
}
function rawbt(bytes) {
  let bin = ''; for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  window.location.href = 'rawbt:base64,' + btoa(bin);
}

/* ---------- HTML (pratinjau + dialog cetak sistem) ---------- */
function thHtml(doc, p) {
  const w = PAPERS[p].w, fs = p === '58' ? 11.5 : 13;
  const R = (l, v, c) => `<div class="r ${c || ''}"><span>${esc(l)}</span><span>${esc(v)}</span></div>`;
  let h = `<div class="nsp-th" style="width:${w};font-size:${fs}px"><div class="c"><div class="nm">${esc(doc.store.name)}</div>${(doc.store.addr || []).map(a => `<div>${esc(a)}</div>`).join('')}</div>`;
  if (doc.kind === 'invoice') h += `<div class="c b ti">${esc(doc.title || 'INVOICE')}</div>`;
  h += '<hr>' + (doc.meta || []).filter(m => m[1]).map(m => R(m[0], m[1])).join('');
  if (doc.party && doc.party.length) h += '<hr>' + doc.party.filter(m => m[1]).map(m => R(m[0], m[1])).join('');
  h += '<hr>' + (doc.items || []).map(i => `<div class="it"><div class="n">${esc(i.name)}</div>${R(i.qty + ' x ' + i.price, i.total)}${i.note ? `<div class="nt">${esc(i.note)}</div>` : ''}</div>`).join('') + '<hr>';
  h += (doc.totals || []).map(t => (t.big ? '<hr>' : '') + R(t.l, t.v, (t.big ? 'big ' : '') + (t.bold ? 'b' : ''))).join('');
  h += '<hr><div class="c">' + (doc.footer || []).map(f => esc(f).replace(/\n/g, '<br>')).join('<br>') + '</div></div>';
  return h;
}
function pgHtml(doc, p) {
  const a5 = p === 'a5', fs = a5 ? 9 : 10.5, st = doc.store;
  const logo = st.logo ? `<img src="${st.logo}" class="lg">` : `<div class="lg ph">${esc((st.name || 'N').trim()[0] || 'N').toUpperCase()}</div>`;
  const rows = (doc.items || []).map((i, k) => `<tr><td class="n">${k + 1}</td><td><b>${esc(i.name)}</b>${i.note ? `<div class="nt">${esc(i.note)}</div>` : ''}</td><td class="rt">${esc(i.qty)}</td><td class="rt">${esc(i.price)}</td><td class="rt">${esc(i.total)}</td></tr>`).join('');
  const tot = (doc.totals || []).map(t => `<div class="tr${t.big ? ' big' : ''}${t.bold ? ' b' : ''}"><span>${esc(t.l)}</span><span>${esc(t.v)}</span></div>`).join('');
  return `<div class="nsp-pg" style="font-size:${fs}pt"><div class="bar"></div>
  <div class="hd">${logo}<div class="si"><div class="nm">${esc(st.name)}</div>${(st.addr || []).map(a => `<div>${esc(a)}</div>`).join('')}</div>
  <div class="mt"><div class="ttl">${esc(doc.title || (doc.kind === 'invoice' ? 'INVOICE' : 'STRUK PENJUALAN'))}</div>${(doc.meta || []).filter(m => m[1]).map(m => `<div><span>${esc(m[0])}</span> <b>${esc(m[1])}</b></div>`).join('')}</div></div>
  ${doc.party && doc.party.some(m => m[1]) ? `<div class="pt"><small>DITAGIHKAN KEPADA</small>${doc.party.filter(m => m[1]).map(m => `<div>${esc(m[1])}</div>`).join('')}</div>` : ''}
  <table><thead><tr><th class="n">#</th><th>DESKRIPSI</th><th class="rt">QTY</th><th class="rt">HARGA</th><th class="rt">JUMLAH</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tt">${tot}</div>
  ${(doc.footer || []).length ? `<div class="ft">${(doc.footer || []).map(f => esc(f).replace(/\n/g, '<br>')).join('<br>')}</div>` : ''}
  <div class="ns">Dibuat dengan NotaSeru</div></div>`;
}
const docHtml = (doc, p) => PAPERS[p].th ? thHtml(doc, p) : pgHtml(doc, p);

/* ---------- cetak sistem ---------- */
function printRoot() { let r = $('#nspPrint'); if (!r) { r = document.createElement('div'); r.id = 'nspPrint'; document.body.appendChild(r); } return r; }
function sysPrint(html, p) {
  const r = printRoot(); r.innerHTML = html;
  let st = $('#nspPage'); if (!st) { st = document.createElement('style'); st.id = 'nspPage'; document.head.appendChild(st); }
  const pp = PAPERS[p]; st.textContent = '@page{size:' + pp.css + ';margin:' + (pp.th ? '0' : p === 'a5' ? '8mm' : '12mm') + '}';
  const h = document.documentElement; h.classList.add('nsp-printing');
  const done = () => { h.classList.remove('nsp-printing'); r.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 120);
}
function slices(canvas, ratio) {
  const w = canvas.width, ph = Math.floor(w * ratio), out = [];
  for (let y = 0; y < canvas.height; y += ph) {
    const h = Math.min(ph, canvas.height - y), c = document.createElement('canvas'); c.width = w; c.height = ph;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, ph); x.drawImage(canvas, 0, y, w, h, 0, 0, w, h);
    out.push(c.toDataURL('image/jpeg', .95));
  }
  return out;
}

/* ---------- API cetak ---------- */
async function print(doc, over) {
  const c = Object.assign({}, P.cfg, over || {}), pp = PAPERS[c.paper];
  if (!pp.th) {
    if (doc.canvas) { const cv = await doc.canvas(); sysPrint(slices(cv, pp.ratio).map(u => `<img class="nsp-img" src="${u}">`).join(''), c.paper); }
    else sysPrint(docHtml(doc, c.paper), c.paper);
    return;
  }
  if (c.method === 'system') return sysPrint(docHtml(doc, c.paper), c.paper);
  const bytes = escBytes(doc, c);
  if (c.method === 'rawbt') return rawbt(bytes);
  return bleSend(bytes);
}
function errMsg(e) {
  if (!e) return 'Gagal mencetak';
  if (e.name === 'NotFoundError') return 'Pemilihan printer dibatalkan';
  if (e.name === 'SecurityError' || e.name === 'NotAllowedError') return 'Izin Bluetooth ditolak';
  return e.message || 'Gagal mencetak';
}

/* ---------- dialog ---------- */
function sample() {
  const s = (typeof DB !== 'undefined') ? DB.get('settings', {}) : {};
  return { kind: 'receipt', title: 'STRUK', drawer: false, store: { name: s.storeName || 'NotaSeru', addr: [s.storeAddress || 'Jl. Contoh No. 1', s.storePhone || ''].filter(Boolean) },
    meta: [['No', 'TES-001'], ['Tanggal', new Date().toLocaleDateString('id-ID') + ' ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })]],
    items: [{ name: 'Contoh Produk A', qty: 2, price: nf(15000), total: nf(30000) }, { name: 'Contoh Produk B', qty: 1, price: nf(8500), total: nf(8500) }],
    totals: [{ l: 'Subtotal', v: nf(38500) }, { l: 'TOTAL', v: nf(38500), big: true }, { l: 'Tunai', v: nf(50000) }, { l: 'Kembali', v: nf(11500) }], footer: ['Tes cetak berhasil', 'Terima kasih'] };
}
function ensureOv() {
  let ov = $('#nspOv'); if (ov) return ov;
  ov = document.createElement('div'); ov.id = 'nspOv'; ov.className = 'nsp-ov'; document.body.appendChild(ov);
  ov.addEventListener('click', onClick); return ov;
}
function open(doc) {
  P.mode = doc ? 'print' : 'settings'; P.doc = doc || sample();
  if (P.doc.canvas && !isThermal()) { /* tetap */ }
  ensureOv().classList.add('on'); render();
}
function close() { const ov = $('#nspOv'); if (ov) ov.classList.remove('on'); }
function tg(on) { return `<span class="nsp-sw${on ? ' on' : ''}"></span>`; }
function render() {
  const c = P.cfg, th = isThermal(), ov = ensureOv(), doc = P.doc;
  const M = [['ble', 'Bluetooth langsung', 'Printer thermal BLE (Chrome Android / komputer)'], ['rawbt', 'RawBT (Android)', 'Untuk printer Bluetooth klasik — butuh aplikasi RawBT'], ['system', 'Dialog cetak sistem', 'USB, WiFi, AirPrint, atau simpan PDF']];
  let hint = '';
  if (th && c.method === 'ble') hint = bleOK() ? `<div class="nsp-st"><div><small>Printer</small><b>${esc(c.btName || 'Belum terhubung')}</b></div><button class="nsp-mini" data-n="pair">${c.btName ? 'Ganti' : 'Hubungkan'}</button></div><div class="nsp-hint">Nyalakan printer, aktifkan Bluetooth perangkat, lalu tekan Hubungkan. Sekali terhubung, cetak berikutnya cukup satu ketukan.</div>` : `<div class="nsp-hint err">Browser ini belum mendukung Bluetooth langsung (iPhone/Safari memang belum bisa — aturan Apple). <b>Di iPhone/iPad:</b> buka aplikasi di browser <b>Bluefy</b> (gratis, App Store) lalu pilih Bluetooth langsung; data di Bluefy terpisah dari Safari, jadi pindahkan lewat Backup &amp; Restore. Atau pakai printer AirPrint lewat <b>Dialog cetak sistem</b>. Android: pakai Chrome.</div>`;
  if (th && c.method === 'rawbt') hint = `<div class="nsp-hint">Pasangkan printer di pengaturan Bluetooth Android, pasang aplikasi <b>RawBT</b>, lalu pilih printernya di RawBT. NotaSeru akan mengirim struk ke RawBT.</div>`;
  if (th && c.method === 'system') hint = `<div class="nsp-hint">Pilih printer thermal yang terpasang di sistem. Ukuran kertas ${PAPERS[c.paper].n} diatur otomatis.</div>`;
  if (!th) hint = `<div class="nsp-hint">${doc.canvas ? 'Nota dicetak persis seperti pratinjau (template &amp; warna Anda).' : 'Dokumen dicetak rapi satu halaman.'} Di dialog cetak pilih printer atau “Simpan sebagai PDF”.</div>`;
  const label = P.mode === 'settings' ? 'Tes Cetak' : (th && c.method !== 'system' ? 'Cetak sekarang' : 'Buka dialog cetak');
  ov.innerHTML = `<div class="nsp-sh" role="dialog" aria-modal="true"><div class="nsp-h"><b>${P.mode === 'settings' ? 'Printer & Kertas' : 'Cetak'}</b><button class="nsp-x" data-n="close" aria-label="Tutup">✕</button></div>
  <div class="nsp-b"><div class="nsp-l">Ukuran kertas</div><div class="nsp-seg">${Object.keys(PAPERS).map(k => `<button data-n="paper" data-v="${k}" class="${c.paper === k ? 'on' : ''}">${PAPERS[k].n.replace('Thermal ', '')}${PAPERS[k].th ? '<small>thermal</small>' : '<small>kertas</small>'}</button>`).join('')}</div>
  ${th ? `<div class="nsp-l">Cara cetak</div>${M.map(m => `<button class="nsp-opt${c.method === m[0] ? ' on' : ''}" data-n="method" data-v="${m[0]}"><span class="rd"></span><span><b>${m[1]}</b><small>${m[2]}</small></span></button>`).join('')}` : ''}
  ${hint}
  ${th ? `<div class="nsp-l">Opsi struk</div>
  <button class="nsp-tg" data-n="tg" data-v="cut"><span>Potong kertas otomatis</span>${tg(c.cut)}</button>
  <button class="nsp-tg" data-n="tg" data-v="small"><span>Font kecil (lebih banyak karakter)</span>${tg(c.small)}</button>
  ${doc.drawer || P.mode === 'settings' ? `<button class="nsp-tg" data-n="tg" data-v="drawer"><span>Buka laci kas (transaksi tunai)</span>${tg(c.drawer)}</button>` : ''}
  ${P.mode === 'settings' ? `<button class="nsp-tg" data-n="tg" data-v="auto"><span>Cetak otomatis setelah pembayaran</span>${tg(c.auto)}</button>` : ''}
  ${c.method !== 'system' ? `<div class="nsp-tg" style="cursor:default"><span>Jumlah salinan</span><span class="nsp-stp"><button data-n="cp" data-v="-1">−</button><b>${c.copies}</b><button data-n="cp" data-v="1">+</button></span></div>` : ''}
  <div class="nsp-l">Pratinjau</div><div class="nsp-prev">${thHtml(doc, c.paper)}</div>` : ''}
  </div><div class="nsp-f"><button class="nsp-go" data-n="go">${label}</button></div></div>`;
}
async function onClick(e) {
  const t = e.target.closest('[data-n]'); if (e.target.id === 'nspOv') return close(); if (!t) return;
  const a = t.dataset.n, v = t.dataset.v, c = P.cfg;
  if (a === 'close') return close();
  if (a === 'paper') { c.paper = v; if (!isThermal() && !P.doc.canvas) { } saveCfg(); return render(); }
  if (a === 'method') { c.method = v; saveCfg(); return render(); }
  if (a === 'tg') { c[v] = !c[v]; saveCfg(); return render(); }
  if (a === 'cp') { c.copies = Math.max(1, Math.min(5, (c.copies | 0 || 1) + Number(v))); saveCfg(); return render(); }
  if (a === 'pair') { try { await pair(); say('Terhubung ke ' + P.cfg.btName); } catch (er) { if (er.name !== 'NotFoundError') say(errMsg(er), true); } return render(); }
  if (a === 'go') {
    const b = t; b.disabled = true; const old = b.textContent; b.textContent = 'Memproses…';
    try {
      await print(P.doc);
      if (isThermal() && P.cfg.method === 'rawbt') say('Dikirim ke RawBT');
      else if (!isThermal() || P.cfg.method === 'system') say('Membuka dialog cetak…'); else say('Struk terkirim ke printer');
      if (P.mode !== 'settings') close();
    } catch (er) { console.error(er); say(errMsg(er), true); }
    b.disabled = false; b.textContent = old;
  }
}

/* ---------- Invoice ---------- */
function invoiceDoc(inv) {
  const s = DB.get('settings', {}), cur = inv.currency, F = n => fmtRp(n, cur);
  const st = inv.status === 'lunas' ? 'LUNAS' : inv.status === 'dp' ? 'DP' : 'BELUM BAYAR';
  const tot = [{ l: 'Subtotal', v: F(inv.sub) }];
  if (inv.discAmt > 0) tot.push({ l: 'Diskon' + (inv.discType === 'persen' && inv.disc ? ' ' + inv.disc + '%' : ''), v: '-' + F(inv.discAmt) });
  if (inv.ongkir > 0) tot.push({ l: 'Ongkir', v: F(inv.ongkir) });
  tot.push({ l: 'TOTAL', v: F(inv.grand), big: true });
  if (inv.dp > 0) tot.push({ l: 'DP', v: F(inv.dp) });
  if (inv.bayar > 0) tot.push({ l: 'Dibayar', v: F(inv.bayar) });
  if (inv.sisa > 0) tot.push({ l: 'Sisa tagihan', v: F(inv.sisa), bold: true });
  if (inv.lebih > 0) tot.push({ l: 'Kelebihan', v: F(inv.lebih) });
  return { kind: 'invoice', title: 'INVOICE', drawer: false,
    store: { name: s.storeName || 'Bisnis Saya', addr: [s.storeAddress, s.storePhone, s.storeEmail].filter(Boolean), logo: /^data:image\/(png|jpe?g|webp|gif)/.test(s.logo || '') ? s.logo : '' },
    meta: [['No', inv.number], ['Tanggal', fmtDate(inv.date)], ['Status', st]],
    party: [['Pelanggan', (inv.customer || {}).name], ['Telp', (inv.customer || {}).phone], ['Alamat', (inv.customer || {}).address]],
    items: (inv.items || []).filter(i => (i.name || '').trim()).map(i => ({ name: i.name, qty: (i.qty2 > 0 ? i.qty + 'x' + i.qty2 : i.qty) + (i.unit ? ' ' + i.unit : ''), price: F(i.price), total: F(calcItemTotal(i)), note: i.note || '' })),
    totals: tot, footer: [inv.notes || '', 'Terima kasih'].filter(Boolean),
    canvas: () => renderCanvas() };
}
function printInvoice() {
  const inv = (typeof curInvId !== 'undefined') && DB.get('invoices', []).find(i => i.id === curInvId);
  if (!inv) return say('Buka nota terlebih dahulu', true);
  open(invoiceDoc(inv));
}
const IC_PRINT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
function injectInvoiceUI() {
  const bar = document.querySelector('#page-preview .export-bar');
  if (bar && !$('#nspBarBtn')) {
    const b = document.createElement('button'); b.id = 'nspBarBtn'; b.className = 'btn btn-secondary'; b.style.gridColumn = 'span 2';
    b.innerHTML = IC_PRINT + ' Cetak Nota (Thermal / A4 / A5)'; b.onclick = printInvoice;
    const wa = bar.querySelector('.btn-wa'); bar.insertBefore(b, wa || null);
  }
  const first = document.querySelector('#exportSheet .as-item');
  if (first && !$('#nspSheetItem')) {
    const d = document.createElement('div'); d.className = 'as-item'; d.id = 'nspSheetItem'; d.onclick = () => { if (typeof closeSheets === 'function') closeSheets(); printInvoice(); };
    d.innerHTML = '<div class="as-ic" style="background:var(--primary-soft);color:var(--primary)">' + IC_PRINT.replace('width="15" height="15"', 'width="18" height="18"') + '</div><div><div class="as-label">Cetak Nota</div><div class="as-sub">Thermal 58/80 mm Bluetooth, A5, atau A4</div></div>';
    first.parentNode.insertBefore(d, first);
  }
}

/* ---------- gaya ---------- */
function injectCss() {
  const s = document.createElement('style'); s.textContent = `
#nspPrint{display:none}
.nsp-th{font-family:'Courier New',ui-monospace,monospace;color:#000;background:#fff;padding:3mm 2mm;line-height:1.4;box-sizing:border-box;margin:0 auto}
.nsp-th .c{text-align:center}.nsp-th .nm{font-size:1.3em;font-weight:800}.nsp-th .ti{margin-top:4px;font-size:1.15em}
.nsp-th hr{border:0;border-top:1px dashed #000;margin:5px 0}.nsp-th .r{display:flex;justify-content:space-between;gap:6px}.nsp-th .r span:last-child{text-align:right}
.nsp-th .it{margin-bottom:3px}.nsp-th .n{font-weight:700}.nsp-th .nt{font-size:.9em;padding-left:8px}.nsp-th .b{font-weight:800}.nsp-th .big{font-size:1.25em;font-weight:800}
.nsp-pg{font-family:'Manrope',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1E293B;background:#fff;width:100%;box-sizing:border-box}
.nsp-pg .bar{height:5px;background:linear-gradient(90deg,#1E40AF,#2563EB,#3B82F6);border-radius:3px;margin-bottom:5mm}
.nsp-pg .hd{display:flex;gap:4mm;align-items:flex-start;margin-bottom:6mm}.nsp-pg .lg{width:15mm;height:15mm;border-radius:3mm;object-fit:cover;flex:none}
.nsp-pg .lg.ph{background:#EAF0FF;color:#1D4ED8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.6em}
.nsp-pg .si{flex:1;line-height:1.5}.nsp-pg .nm{font-weight:800;font-size:1.5em;color:#1E3A8A;line-height:1.2}.nsp-pg .si div:not(.nm){color:#64748B;font-size:.85em}
.nsp-pg .mt{text-align:right;line-height:1.6;font-size:.88em}.nsp-pg .mt span{color:#94A3B8}.nsp-pg .ttl{font-size:1.5em;font-weight:800;color:#1D4ED8;letter-spacing:.04em;margin-bottom:2mm}
.nsp-pg .pt{background:#F8FAFC;border:1px solid #E5E9EF;border-radius:3mm;padding:3mm 4mm;margin-bottom:5mm;line-height:1.5}.nsp-pg .pt small{display:block;font-size:.7em;font-weight:800;color:#94A3B8;letter-spacing:.1em;margin-bottom:1mm}
.nsp-pg table{width:100%;border-collapse:collapse;margin-bottom:4mm}.nsp-pg th{background:#1E3A8A;color:#fff;font-size:.7em;letter-spacing:.08em;padding:2.4mm 3mm;text-align:left}
.nsp-pg td{padding:2.4mm 3mm;border-bottom:1px solid #E5E9EF;vertical-align:top}.nsp-pg tbody tr:nth-child(even) td{background:#F8FAFC}
.nsp-pg .rt{text-align:right;white-space:nowrap}.nsp-pg .n{width:8mm;color:#94A3B8}.nsp-pg .nt{font-size:.82em;color:#94A3B8}
.nsp-pg .tt{margin-left:auto;width:55%}.nsp-pg .tr{display:flex;justify-content:space-between;padding:1.6mm 3mm}.nsp-pg .tr.b{font-weight:800}
.nsp-pg .tr.big{background:#1D4ED8;color:#fff;border-radius:2mm;font-weight:800;font-size:1.2em;margin:2mm 0;padding:2.6mm 3mm}
.nsp-pg .ft{margin-top:8mm;padding-top:3mm;border-top:1px solid #E5E9EF;color:#64748B;font-size:.88em;line-height:1.6}.nsp-pg .ns{margin-top:6mm;text-align:center;color:#B0B5BC;font-size:.72em}
.nsp-img{display:block;width:100%;page-break-after:always;break-after:page}.nsp-img:last-child{page-break-after:auto;break-after:auto}
@media print{
  html.nsp-printing body>*{display:none!important}
  html.nsp-printing body>#nspPrint{display:block!important;background:#fff}
  html.nsp-printing,html.nsp-printing body{overflow:visible!important;height:auto!important;background:#fff!important}
  html.nsp-printing #nspPrint .nsp-th{padding:0 1mm}
  #nspPrint,#nspPrint *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
}
.nsp-ov{position:fixed;inset:0;z-index:9600;background:rgba(10,14,11,.5);display:none;align-items:flex-end;justify-content:center;font-family:var(--font,system-ui,sans-serif)}
.nsp-ov.on{display:flex}.nsp-ov *{box-sizing:border-box}
.nsp-sh{width:100%;max-width:520px;max-height:92vh;max-height:92dvh;background:var(--bg,#fff);color:var(--txt-1,#111);border-radius:28px 28px 0 0;display:flex;flex-direction:column;animation:nspUp .28s cubic-bezier(.22,1,.36,1)}
@keyframes nspUp{from{transform:translateY(40px);opacity:0}}
button:where(.nsp-ov button){font-family:inherit;cursor:pointer;border:0;background:none;color:inherit}
.nsp-h{display:flex;align-items:center;padding:20px 18px 8px;gap:10px}.nsp-h b{flex:1;font-size:17px;font-weight:800}
.nsp-x{width:34px;height:34px;border-radius:50%;background:var(--bg-input,#eef1f5);color:var(--txt-2,#555);font-size:13px}
.nsp-b{overflow-y:auto;padding:4px 18px 14px;flex:1;-webkit-overflow-scrolling:touch}
.nsp-f{padding:12px 18px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border-soft,#e5e9ef);background:var(--bg-card,#fff)}
.nsp-go{width:100%;height:48px;border-radius:var(--r-md,14px);background:var(--primary,#2E7BF6);color:#fff!important;font-weight:800;font-size:15px;box-shadow:var(--sh-pri,none)}.nsp-go:disabled{opacity:.6}
.nsp-l{font-size:11.5px;font-weight:800;color:var(--txt-3,#8a94a6);text-transform:uppercase;letter-spacing:.07em;margin:16px 2px 8px}
.nsp-seg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.nsp-seg button{padding:10px 0;border-radius:var(--r-md,14px);background:var(--bg-card,#fff);border:1.5px solid var(--border,#dfe4ec)!important;font-weight:800;font-size:14px;color:var(--txt-2,#555);display:flex;flex-direction:column;align-items:center;gap:1px}
.nsp-seg button small{font-size:9.5px;font-weight:700;opacity:.7}.nsp-seg button.on{border-color:var(--primary,#2E7BF6)!important;background:var(--primary-soft,#e8f0ff);color:var(--primary,#2E7BF6)}
.nsp-opt{width:100%;display:flex;gap:12px;align-items:center;text-align:left;padding:12px 14px;margin-bottom:8px;border-radius:var(--r-md,14px);background:var(--bg-card,#fff);border:1.5px solid var(--border-soft,#e5e9ef)!important}
.nsp-opt .rd{width:20px;height:20px;border-radius:50%;border:2px solid var(--border,#cfd6e0);flex:none;position:relative}
.nsp-opt.on{border-color:var(--primary,#2E7BF6)!important;background:var(--primary-soft,#e8f0ff)}.nsp-opt.on .rd{border-color:var(--primary,#2E7BF6)}.nsp-opt.on .rd::after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--primary,#2E7BF6)}
.nsp-opt b{display:block;font-size:14px;font-weight:800}.nsp-opt small{display:block;font-size:12px;color:var(--txt-3,#8a94a6);font-weight:600;margin-top:1px}
.nsp-st{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:var(--r-md,14px);background:var(--bg-input,#eef1f5);margin:4px 0 8px}
.nsp-st small{display:block;font-size:11px;color:var(--txt-3,#8a94a6);font-weight:700}.nsp-st b{font-size:14px;font-weight:800}
.nsp-mini{padding:8px 16px;border-radius:99px;background:var(--primary,#2E7BF6);color:#fff!important;font-weight:800;font-size:12.5px}
.nsp-hint{font-size:12.5px;line-height:1.55;color:var(--txt-2,#555);font-weight:600;padding:2px 4px 4px}.nsp-hint.err{color:var(--danger,#d33)}
.nsp-tg{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;margin-bottom:8px;background:var(--bg-card,#fff);border:1px solid var(--border-soft,#e5e9ef)!important;border-radius:var(--r-md,14px);font-size:14px;font-weight:700;text-align:left}
.nsp-sw{width:44px;height:26px;border-radius:99px;background:var(--border,#cfd6e0);position:relative;flex:none;transition:.2s}.nsp-sw::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s}.nsp-sw.on{background:var(--primary,#2E7BF6)}.nsp-sw.on::after{left:21px}
.nsp-stp{display:flex;align-items:center;gap:12px}.nsp-stp button{width:32px;height:32px;border-radius:50%;background:var(--primary-soft,#e8f0ff);color:var(--primary,#2E7BF6)!important;font-size:18px;font-weight:800}.nsp-stp b{min-width:14px;text-align:center}
.nsp-prev{background:var(--bg-input,#eef1f5);border-radius:var(--r-md,14px);padding:14px;display:flex;justify-content:center;max-height:260px;overflow:auto}.nsp-prev .nsp-th{box-shadow:0 2px 10px rgba(0,0,0,.12);border-radius:4px;flex:none}
.nsp-toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);z-index:9900;background:#111;color:#fff;padding:10px 18px;border-radius:99px;font-weight:700;font-size:13.5px;max-width:92%;text-align:center;font-family:var(--font,system-ui)}.nsp-toast.err{background:#d33}
`; document.head.appendChild(s);
}

window.NSPrint = { open, print, cfg: P.cfg, isThermal, printInvoice, invoiceDoc, say, errMsg, PAPERS, nf };
function boot() { injectCss(); injectInvoiceUI(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

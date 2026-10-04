'use strict';
/* ============================================
   NOTASERU — auth.js
   Supabase Auth + Cloud Sync Layer
   ============================================ */

// ── Config ──
const SUPABASE_URL     = window.NS_SUPABASE_URL     || '';
const SUPABASE_ANON_KEY = window.NS_SUPABASE_ANON_KEY || '';

// ── Supabase client ──
let _sb = null;
function getSB() {
  if (_sb) return _sb;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (SUPABASE_URL.includes('xxxx') || SUPABASE_ANON_KEY.includes('xxxx')) return null;
  try { _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch(e) { console.warn('Supabase init err', e); }
  return _sb;
}

// ── Auth state ──
let _authUser = null;
const GUEST_KEY    = 'ns3_guestMode';
const USERNAME_KEY = 'ns3_username';

// Toggle show/hide password
const EYE_OPEN   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
function togglePass(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isHidden = inp.type === 'password';
  inp.type      = isHidden ? 'text' : 'password';
  // Icon = kondisi saat ini: kalau sudah terlihat → mata terbuka, kalau tersembunyi → mata tertutup
  btn.innerHTML = isHidden ? EYE_OPEN : EYE_CLOSED;
}

// ── Status sinkronisasi lokal ──
// PERLINDUNGAN DATA: sebelumnya data cloud SELALU menimpa data lokal saat
// pullAll(), dan snapshot nota ditandai "sudah terkirim" SEBELUM upload benar2
// berhasil. Akibatnya perubahan yang belum sempat naik ke cloud (sinyal jelek,
// app ditutup, sesi login kadaluarsa, ganti versi app) bisa hilang tertimpa.
// Sekarang:
//  - key yang push-nya belum berhasil ditandai di PENDING_KEY → tidak ditimpa
//    cloud, dan dikirim ulang begitu online/login lagi;
//  - snapshot nota (SNAP_KEY) hanya diisi nota yang BENAR2 sudah sukses
//    terkirim, jadi nota baru/diedit yang belum naik selalu dipertahankan.
const PENDING_KEY = 'ns3_syncPending';
const SNAP_KEY    = 'ns3_invoicesCloudSnapV2'; // V2: V1 lama bisa berisi nota yang sebenarnya gagal terkirim
const OWNER_KEY   = 'ns3_ownerId';             // id akun pemilik data lokal saat ini
const SYNC_KEYS   = ['settings','expenses','incomes','products','ekspedisi','warehouses','stockLog'];

function _getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}') || {}; } catch { return {}; } }
function _setPending(k, on) {
  try {
    const p = _getPending();
    if (on) p[k] = 1; else delete p[k];
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {}
}
function _readSnap() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '{}') || {}; } catch { return {}; } }
function _snapUpdate(fn) {
  // Baca ulang tiap kali supaya beberapa push yang jalan bersamaan tidak saling timpa
  try { const snap = _readSnap(); fn(snap); localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch {}
}
function _isSyncKey(k) { return SYNC_KEYS.includes(k) || k.startsWith('grup_') || k.startsWith('inv_profit_'); }

// ── CloudDB ──
const CloudDB = {
  get(k, def = null) { return DB.get(k, def); },
  set(k, v) {
    DB.set(k, v);
    if (_authUser) CloudDB._push(k, v);
  },
  async _push(k, v) {
    const sb = getSB(); if (!sb || !_authUser) { if (k !== 'invoices') _setPending(k, true); return; }
    const uid = _authUser.id;
    const now = new Date().toISOString();
    const rows = [];

    if (k === 'settings') {
      // Pisahkan logo & signature ke row terpisah agar tidak melebihi batas JSONB Supabase
      const slim = Object.assign({}, v);
      const logo      = slim.logo;      delete slim.logo;
      const signature = slim.signature; delete slim.signature;
      rows.push({ user_id: uid, key: 'settings', value: slim, updated_at: now });
      if (logo      !== undefined) rows.push({ user_id: uid, key: 'logo',      value: logo,      updated_at: now });
      if (signature !== undefined) rows.push({ user_id: uid, key: 'signature', value: signature, updated_at: now });
    } else if (k === 'invoices') {
      // Tiap nota = 1 row (key "invoice:<id>"). Diff terhadap snapshot nota yang
      // SUDAH sukses terkirim, jadi hanya nota baru/berubah yang di-upload.
      const arr = Array.isArray(v) ? v : [];
      const prevSnap = _readSnap();
      const localIds = {};
      for (const inv of arr) {
        if (!inv || !inv.id) continue;
        localIds[inv.id] = 1;
        const sig = JSON.stringify(inv);
        if (prevSnap[inv.id] !== sig) {
          rows.push({ row: { user_id: uid, key: 'invoice:' + inv.id, value: inv, updated_at: now }, id: inv.id, sig });
        }
      }
      // Nota yang hilang dari array (dihapus user) → hapus juga row-nya di cloud
      let removedIds = Object.keys(prevSnap).filter(id => !localIds[id]);
      // PENGAMAN: kalau daftar nota lokal tiba-tiba KOSONG padahal sebelumnya
      // ada banyak nota tersinkron, hampir pasti itu data lokal yang rusak/
      // ter-reset (bukan user menghapus satu per satu). Jangan ikut hapus
      // semua nota di cloud — nanti nota-nota itu kembali lewat pullAll().
      if (!arr.length && removedIds.length >= 3) {
        console.warn('[NS] daftar nota lokal kosong, batal menghapus', removedIds.length, 'nota di cloud');
        removedIds = [];
      }
      for (const id of removedIds) {
        try {
          const { error } = await sb.from('userdata').delete().eq('user_id', uid).eq('key', 'invoice:' + id);
          if (error) console.warn('CloudDB delete invoice err', id, error);
          else _snapUpdate(snap => { delete snap[id]; });
        } catch(e) { console.warn('CloudDB delete invoice err', id, e); }
      }
      for (const r of rows) {
        try {
          const { error } = await sb.from('userdata').upsert(r.row, { onConflict: 'user_id,key' });
          if (error) console.warn('CloudDB push err', r.row.key, error);
          else _snapUpdate(snap => { snap[r.id] = r.sig; });
        } catch(e) { console.warn('CloudDB push err', r.row.key, e); }
      }
      return;
    } else {
      rows.push({ user_id: uid, key: k, value: v, updated_at: now });
    }

    // Tandai "belum terkirim" dulu; baru dihapus tandanya kalau SEMUA row sukses
    _setPending(k, true);
    let ok = true;
    for (const row of rows) {
      try {
        const { error } = await sb.from('userdata').upsert(row, { onConflict: 'user_id,key' });
        if (error) { ok = false; console.warn('CloudDB push err', row.key, error); }
      } catch(e) { ok = false; console.warn('CloudDB push err', row.key, e); }
    }
    // Hanya hapus tanda pending kalau yang barusan dikirim memang nilai terbaru
    if (ok && JSON.stringify(DB.get(k, null)) === JSON.stringify(v)) _setPending(k, false);
  },
  // Kirim ulang semua perubahan lokal yang belum sempat naik ke cloud
  async flushPending() {
    if (!_authUser) return;
    const pending = _getPending();
    for (const k of Object.keys(pending)) {
      if (k === 'invoices') { _setPending(k, false); continue; }
      await CloudDB._push(k, DB.get(k, null));
    }
    await CloudDB._push('invoices', DB.get('invoices', []));
  },
  async pullAll() {
    const sb = getSB(); if (!sb || !_authUser) return;
    try {
      const { data, error } = await sb.from('userdata').select('key, value, updated_at').eq('user_id', _authUser.id);
      if (error) throw error;
      const rowsData = data || [];
      // Tulis langsung ke localStorage (bypass patched DB.set) agar tidak
      // trigger push balik ke cloud (infinite push loop)
      let changed = false;
      const pending = _getPending();
      const cloudKeys = {};
      // Kumpulkan logo & signature dulu sebelum proses settings
      let incomingLogo = undefined, incomingSign = undefined;
      // Nota: row lama (blob "invoices") + row baru (satu row per nota, key "invoice:<id>")
      let legacyInvoices = undefined;
      const invoiceRowMap = {};
      for (const row of rowsData) {
        cloudKeys[row.key] = 1;
        if (row.key === 'logo')      { incomingLogo = row.value; continue; }
        if (row.key === 'signature') { incomingSign = row.value; continue; }
        if (row.key === 'invoices')  { legacyInvoices = row.value; continue; }
        if (row.key.startsWith('invoice:')) {
          const id = row.key.slice('invoice:'.length);
          if (row.value) invoiceRowMap[id] = row.value;
          continue;
        }
        // Perubahan lokal yang belum terkirim → JANGAN ditimpa data cloud yang lebih lama
        if (pending[row.key]) continue;
        if (row.key === 'settings') {
          try {
            const slim = Object.assign({}, row.value);
            const current = localStorage.getItem('ns3_settings');
            const currentObj = current ? JSON.parse(current) : {};
            // Pertahankan logo/signature lokal dulu, nanti di-override kalau ada dari cloud
            slim.logo      = currentObj.logo;
            slim.signature = currentObj.signature;
            const incoming = JSON.stringify(slim);
            if (current !== incoming) {
              localStorage.setItem('ns3_settings', incoming);
              changed = true;
            }
          } catch {}
          continue;
        }
        const current = localStorage.getItem('ns3_' + row.key);
        const incoming = JSON.stringify(row.value);
        if (current !== incoming) {
          try { localStorage.setItem('ns3_' + row.key, incoming); } catch {}
          changed = true;
        }
      }

      // ── Gabungkan nota (3 arah: cloud, lokal, snapshot terakhir yang tersinkron) ──
      const cloudById = {};
      if (Array.isArray(legacyInvoices)) for (const inv of legacyInvoices) if (inv && inv.id) cloudById[inv.id] = inv;
      for (const id in invoiceRowMap) cloudById[id] = invoiceRowMap[id];
      const localArr = DB.get('invoices', []);
      const snap = _readSnap();
      const byId = Object.assign({}, cloudById);
      for (const inv of (Array.isArray(localArr) ? localArr : [])) {
        if (!inv || !inv.id) continue;
        const sig = JSON.stringify(inv);
        if (!(inv.id in snap)) {
          // Belum pernah sukses terkirim (nota baru / dibuat offline) → pertahankan
          if (!(inv.id in cloudById)) byId[inv.id] = inv;
        } else if (snap[inv.id] !== sig) {
          // Diedit di perangkat ini tapi belum terkirim → versi lokal yang menang
          byId[inv.id] = inv;
        }
        // Selain itu: tidak berubah di lokal → cloud yang jadi acuan (termasuk kalau dihapus di device lain)
      }
      const merged = Object.values(byId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const mergedStr = JSON.stringify(merged);
      if (localStorage.getItem('ns3_invoices') !== mergedStr && (merged.length || localStorage.getItem('ns3_invoices'))) {
        try { localStorage.setItem('ns3_invoices', mergedStr); } catch {}
        changed = true;
      }
      // Snapshot = isi cloud saat ini, supaya push berikutnya tahu mana yang perlu di-upload
      try {
        const nextSnap = {};
        for (const id in cloudById) nextSnap[id] = JSON.stringify(cloudById[id]);
        localStorage.setItem(SNAP_KEY, JSON.stringify(nextSnap));
      } catch {}
      // Migrasi sekali jalan: blob "invoices" lama → row per-nota, lalu hapus blob lamanya
      if (legacyInvoices !== undefined) {
        const uid = _authUser.id;
        (async () => {
          try {
            let allOk = true;
            for (const inv of merged) {
              if (!inv || !inv.id) continue;
              const { error } = await sb.from('userdata').upsert(
                { user_id: uid, key: 'invoice:' + inv.id, value: inv, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,key' }
              );
              if (error) allOk = false;
              else { const sig = JSON.stringify(inv); _snapUpdate(s => { s[inv.id] = sig; }); }
            }
            // Blob lama baru dihapus kalau SEMUA nota sudah pasti tersimpan per-baris
            if (allOk) await sb.from('userdata').delete().eq('user_id', uid).eq('key', 'invoices');
            console.log('[NS] migrasi nota ke format per-baris', allOk ? 'selesai' : 'tertunda', '(' + merged.length + ' nota)');
          } catch(e) { console.warn('[NS] migrasi nota gagal', e); }
        })();
      }

      // Sekarang gabungkan logo & signature ke settings (kecuali settings lokal masih pending)
      if (!pending.settings) {
        try {
          const settingsRaw = localStorage.getItem('ns3_settings');
          const s = settingsRaw ? JSON.parse(settingsRaw) : {};
          let settingsDirty = false;
          if (incomingLogo !== undefined && localStorage.getItem('ns3_logo') !== JSON.stringify(incomingLogo)) {
            localStorage.setItem('ns3_logo', JSON.stringify(incomingLogo));
            changed = true;
          }
          if (incomingLogo !== undefined && s.logo !== (incomingLogo || undefined)) {
            if (incomingLogo) s.logo = incomingLogo; else delete s.logo;
            settingsDirty = true; changed = true;
          }
          if (incomingSign !== undefined && localStorage.getItem('ns3_signature') !== JSON.stringify(incomingSign)) {
            localStorage.setItem('ns3_signature', JSON.stringify(incomingSign));
            changed = true;
          }
          if (incomingSign !== undefined && s.signature !== (incomingSign || undefined)) {
            if (incomingSign) s.signature = incomingSign; else delete s.signature;
            settingsDirty = true; changed = true;
          }
          if (settingsDirty) localStorage.setItem('ns3_settings', JSON.stringify(s));
        } catch {}
      }

      // Data yang ada di lokal tapi belum pernah ada di cloud → kirim, jangan dibiarkan cuma di HP
      for (let i = 0; i < localStorage.length; i++) {
        const lk = localStorage.key(i);
        if (!lk || !lk.startsWith('ns3_')) continue;
        const k = lk.slice(4);
        if (_isSyncKey(k) && !cloudKeys[k] && localStorage.getItem(lk) !== 'null') _setPending(k, true);
      }
      // Termasuk nota lokal yang belum ada/berbeda di cloud (lewat diff snapshot)
      if (legacyInvoices === undefined) CloudDB.flushPending().catch(() => {});

      console.log('[NS] pulled', rowsData.length, 'keys, changed:', changed);
      if (changed) {
        if (typeof renderInvList       === 'function') renderInvList();
        if (typeof renderDashboard     === 'function') renderDashboard();
        if (typeof renderExpenseList   === 'function') renderExpenseList();
        if (typeof loadSettingsUI      === 'function') loadSettingsUI();
        if (typeof applyAppearance     === 'function') applyAppearance();
        if (typeof renderCatalogList   === 'function') renderCatalogList();
        if (typeof renderEkspedisiList === 'function') renderEkspedisiList();
        if (typeof populateEkspedisiSelect === 'function') populateEkspedisiSelect();
      }
    } catch(e) { console.warn('CloudDB pullAll err', e); }
  },
  async pushAll() {
    const sb = getSB(); if (!sb || !_authUser) return;
    const uid = _authUser.id;
    const now = new Date().toISOString();
    const rows = [];

    // --- Settings: pisahkan logo & signature agar tidak melebihi batas JSONB ---
    const rawSettings = DB.get('settings', null);
    if (rawSettings !== null) {
      const slim = Object.assign({}, rawSettings);
      delete slim.logo; delete slim.signature;
      rows.push({ key: 'settings', row: { user_id: uid, key: 'settings', value: slim, updated_at: now } });
    }

    // --- Logo & Signature: ambil langsung dari localStorage (bukan DB.get) ---
    try {
      const logoVal = localStorage.getItem('ns3_logo');
      if (logoVal) rows.push({ key: 'settings', row: { user_id: uid, key: 'logo', value: JSON.parse(logoVal), updated_at: now } });
    } catch {}
    try {
      const signVal = localStorage.getItem('ns3_signature');
      if (signVal) rows.push({ key: 'settings', row: { user_id: uid, key: 'signature', value: JSON.parse(signVal), updated_at: now } });
    } catch {}

    // --- Nota: satu row per nota (key: "invoice:<id>") ---
    try {
      for (const inv of DB.get('invoices', [])) {
        if (!inv || !inv.id) continue;
        rows.push({ inv: inv.id, sig: JSON.stringify(inv), row: { user_id: uid, key: 'invoice:' + inv.id, value: inv, updated_at: now } });
      }
    } catch {}

    // --- Key lain + grup_ dan inv_profit_ ---
    for (let i = 0; i < localStorage.length; i++) {
      const lk = localStorage.key(i);
      if (!lk?.startsWith('ns3_')) continue;
      const k = lk.slice(4);
      if (k === 'settings' || !_isSyncKey(k)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(lk));
        if (v !== null) rows.push({ key: k, row: { user_id: uid, key: k, value: v, updated_at: now } });
      } catch {}
    }

    if (!rows.length) return;
    // Push per-row agar satu row gagal tidak blok semua
    const failedKeys = {};
    for (const r of rows) {
      try {
        const { error } = await sb.from('userdata').upsert(r.row, { onConflict: 'user_id,key' });
        if (error) throw error;
        if (r.inv) _snapUpdate(snap => { snap[r.inv] = r.sig; });
      } catch(e) {
        console.warn('CloudDB pushAll row err', r.row.key, e);
        if (r.key) failedKeys[r.key] = 1;
      }
    }
    for (const r of rows) if (r.key && !failedKeys[r.key]) _setPending(r.key, false);
    return !Object.keys(failedKeys).length;
  }
};

// ── Realtime Sync ──
let _realtimeChannel = null;

let _realtimeReconnectTimer = null;

function startRealtimeSync() {
  const sb = getSB();
  if (!sb || !_authUser) return;
  stopRealtimeSync(); // bersihkan channel lama kalau ada

  // BUG FIX #2: channel name unik per user agar tidak konflik antar akun
  const channelName = 'userdata-changes-' + _authUser.id;

  _realtimeChannel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'userdata',
        filter: `user_id=eq.${_authUser.id}`
      },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const k = newRow.key;
          const v = newRow.value;

          // Ada perubahan lokal yang belum terkirim → jangan ditimpa versi cloud
          const _pend = _getPending();
          if (_pend[k] || ((k === 'logo' || k === 'signature') && _pend.settings)) return;
          if (k === 'settings') {
            // BUG FIX (logo/scale hilang sendiri): row 'settings' di cloud SELALU
            // "slim" (logo & signature sengaja dibuang sebelum push, lihat
            // CloudDB._push). Event realtime ini juga bisa nyantol balik ke
            // device yang BARU SAJA melakukan push (mis. setelah atur skala/
            // posisi logo lalu Simpan), karena subscription tidak membedakan
            // asal perubahan. Sebelumnya kode di sini langsung menimpa
            // localStorage['ns3_settings'] dengan payload slim itu apa adanya,
            // sehingga logo (dan kadang signature) ikut lenyap secara acak,
            // tergantung timing realtime — persis gejala "kadang ada kadang
            // hilang". Perbaikannya: gabungkan dulu dengan logo/signature yang
            // sudah tersimpan lokal, sama seperti yang dilakukan pullAll().
            try {
              const currentRaw = localStorage.getItem('ns3_settings');
              const currentObj = currentRaw ? JSON.parse(currentRaw) : {};
              const merged = Object.assign({}, v, {
                logo: currentObj.logo,
                signature: currentObj.signature
              });
              if (JSON.stringify(currentObj) === JSON.stringify(merged)) return;
              localStorage.setItem('ns3_settings', JSON.stringify(merged));
            } catch {}
          } else if (k.startsWith('invoice:')) {
            // Satu nota berubah (row "invoice:<id>") — dari device/tab lain, atau
            // gema dari push device ini sendiri. Update HANYA nota itu di array
            // lokal, tidak perlu tarik ulang semua nota.
            try {
              const arr = DB.get('invoices', []);
              const idx = arr.findIndex(i => i.id === v.id);
              const same = idx !== -1 && JSON.stringify(arr[idx]) === JSON.stringify(v);
              if (same) return;
              if (idx !== -1) arr[idx] = v; else arr.unshift(v);
              arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              localStorage.setItem('ns3_invoices', JSON.stringify(arr));
              // Ikut update snapshot diff, supaya push berikutnya dari device ini
              // tidak salah kira nota ini "berubah" lalu upload ulang tanpa perlu.
              _snapUpdate(snap => { snap[v.id] = JSON.stringify(v); });
            } catch {}
            _reRenderForKey('invoices');
            showSyncBadge('Tersinkron ✓');
            setTimeout(hideSyncBadge, 1500);
            return;
          } else {
            // Jangan re-render kalau nilai tidak berubah
            const current = DB.get(k, null);
            if (JSON.stringify(current) === JSON.stringify(v)) return;
            // BUG FIX #3: Tulis langsung ke localStorage (bypass patched DB.set)
            try { localStorage.setItem('ns3_' + k, JSON.stringify(v)); } catch {}
            // Gabungkan logo/signature ke dalam settings object agar render nota tetap jalan
            if (k === 'logo' || k === 'signature') {
              try {
                const s = JSON.parse(localStorage.getItem('ns3_settings') || '{}');
                if (v) s[k] = v; else delete s[k];
                localStorage.setItem('ns3_settings', JSON.stringify(s));
              } catch {}
            }
          }
          // Re-render UI yang relevan
          _reRenderForKey(k);
          showSyncBadge('Tersinkron ✓');
          setTimeout(hideSyncBadge, 1500);
        } else if (eventType === 'DELETE') {
          const k = oldRow.key;
          if (k.startsWith('invoice:')) {
            // Nota dihapus dari device/tab lain — buang dari array lokal juga.
            const id = k.slice('invoice:'.length);
            try {
              const arr = DB.get('invoices', []).filter(i => i.id !== id);
              localStorage.setItem('ns3_invoices', JSON.stringify(arr));
              _snapUpdate(snap => { delete snap[id]; });
            } catch {}
            _reRenderForKey('invoices');
            return;
          }
          // BUG FIX (DATA HILANG): row lain di cloud hanya pernah dihapus saat
          // migrasi blob "invoices" lama → per-nota, atau saat hapus akun.
          // Dulu event DELETE ini langsung menghapus key lokal yang sama —
          // termasuk SELURUH daftar nota (ns3_invoices) tepat setelah migrasi
          // jalan di update. Jangan pernah hapus data lokal dari event ini.
          return;
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[NS] Realtime sync aktif');
        // BUG FIX #4: batalkan timer reconnect kalau sudah tersambung
        if (_realtimeReconnectTimer) { clearTimeout(_realtimeReconnectTimer); _realtimeReconnectTimer = null; }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // BUG FIX #4: auto reconnect saat channel putus
        console.warn('[NS] Realtime channel ' + status + ', reconnect dalam 5 detik...');
        if (_realtimeReconnectTimer) clearTimeout(_realtimeReconnectTimer);
        _realtimeReconnectTimer = setTimeout(() => {
          if (_authUser) startRealtimeSync();
        }, 5000);
      }
    });
}

function stopRealtimeSync() {
  // BUG FIX #4: batalkan timer reconnect kalau ada
  if (_realtimeReconnectTimer) { clearTimeout(_realtimeReconnectTimer); _realtimeReconnectTimer = null; }
  const sb = getSB();
  if (_realtimeChannel && sb) {
    sb.removeChannel(_realtimeChannel).catch(() => {});
    _realtimeChannel = null;
  }
}

function _reRenderForKey(key) {
  try {
    if (key === 'invoices') {
      if (typeof renderInvList      === 'function') renderInvList();
      if (typeof renderDashboard    === 'function') renderDashboard();
      if (typeof renderIncomePage   === 'function') renderIncomePage();
      if (typeof renderGudang       === 'function') renderGudang();
    } else if (key === 'expenses') {
      if (typeof renderDashboard    === 'function') renderDashboard();
      if (typeof renderExpenseList  === 'function') renderExpenseList();
      if (typeof renderIncomePage   === 'function') renderIncomePage();
    } else if (key === 'settings' || key === 'logo' || key === 'signature') {
      // BUG FIX #7: loadSettingsUI sudah diproteksi agar tidak overwrite field yang sedang difokus
      if (typeof loadSettingsUI        === 'function') loadSettingsUI();
      if (typeof applyAppearance       === 'function') applyAppearance();
      if (typeof renderCatalogList     === 'function') renderCatalogList();
      if (typeof renderEkspedisiList   === 'function') renderEkspedisiList();
    } else if (key === 'warehouses' || key === 'stockLog') {
      if (typeof renderGudang          === 'function') renderGudang();
      if (typeof renderCatalogList     === 'function') renderCatalogList();
    } else if (key === 'products' || key === 'ekspedisi') {
      if (typeof renderGudang          === 'function') renderGudang();
      if (typeof renderCatalogList     === 'function') renderCatalogList();
      if (typeof renderEkspedisiList   === 'function') renderEkspedisiList();
      if (typeof populateEkspedisiSelect === 'function') populateEkspedisiSelect();
    } else if (key.startsWith('grup_')) {
      // BUG FIX #1: gunakan nama fungsi yang benar
      if (typeof renderInvList      === 'function') renderInvList();
    } else if (key.startsWith('inv_profit_')) {
      // BUG FIX #5: update UI profit ketika inv_profit_ key berubah
      if (typeof renderInvList      === 'function') renderInvList();
      if (typeof renderDashboard    === 'function') renderDashboard();
    }
  } catch(e) { console.warn('[NS] reRender err', key, e); }
}

// ── UI helpers ──
function showAuthPage() {
  const ap = document.getElementById('authPage');
  ap.style.display = 'flex';
  // Tombol ✕ hanya muncul kalau sudah ada user/guest (bisa tutup)
  const isGuest = localStorage.getItem(GUEST_KEY) === '1';
  const closable = _authUser || isGuest;
  const btn = document.getElementById('authCloseBtn');
  if (btn) btn.style.display = closable ? 'flex' : 'none';
}
function hideAuthPage() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('app').style.display = '';
}

// Buka popup auth dari pengaturan / tombol lain
function openAuthModal() {
  const ap = document.getElementById('authPage');
  ap.style.display = 'flex';
  // kalau sudah login → tampilkan tab login aktif; tetap bisa tutup
  const isGuest = localStorage.getItem(GUEST_KEY) === '1';
  const closable = _authUser || isGuest;
  const btn = document.getElementById('authCloseBtn');
  if (btn) btn.style.display = closable ? 'flex' : 'none';
}

// Tutup popup (hanya kalau ada sesi aktif)
function closeAuthModal() {
  const isGuest = localStorage.getItem(GUEST_KEY) === '1';
  if (!_authUser && !isGuest) return; // jangan tutup kalau belum ada sesi
  document.getElementById('authPage').style.display = 'none';
}

// Tampilkan layar sukses di dalam popup
function showAuthSuccess(email, isNew) {
  document.getElementById('authFormLogin').style.display    = 'none';
  document.getElementById('authFormRegister').style.display = 'none';
  document.getElementById('authErr').style.display          = 'none';
  document.getElementById('authSpinner').style.display      = 'none';
  document.querySelector('#authPage .auth-tabs').style.display = 'none';
  document.querySelector('#authPage .auth-tagline').style.display = 'none';
  document.getElementById('authCloseBtn').style.display     = 'none';
  const guestBtn = document.querySelector('#authPage [onclick="doGuestMode()"]');
  if (guestBtn) guestBtn.parentElement.style.display = 'none';
  document.getElementById('authSuccess').style.display      = '';
  document.getElementById('authSuccessTitle').textContent   = isNew ? 'Pendaftaran Berhasil!' : 'Login Berhasil!';
  document.getElementById('authSuccessEmail').textContent   = email;
  document.getElementById('authSuccessSub').textContent     = isNew ? 'Akun kamu sudah aktif dan siap digunakan.' : 'Selamat datang kembali!';
}

// Reset tampilan popup ke kondisi awal
function resetAuthModal() {
  document.getElementById('authSuccess').style.display = 'none';
  document.getElementById('authErr').textContent = '';
  document.getElementById('authErr').style.display = '';
  document.getElementById('authSpinner').style.display = 'none';
  document.querySelector('#authPage .auth-tabs').style.display = '';
  document.querySelector('#authPage .auth-tagline').style.display = '';
  const guestBtn = document.querySelector('#authPage [onclick="doGuestMode()"]');
  if (guestBtn) guestBtn.parentElement.style.display = '';
  switchAuthTab('login');
}

// Update tampilan section Akun di Pengaturan
function updateSettAkunRow() {
  const guestEl  = document.getElementById('settAkunGuest');
  const loggedEl = document.getElementById('settAkunLoggedIn');
  if (!guestEl || !loggedEl) return;
  if (_authUser) {
    guestEl.style.display  = 'none';
    loggedEl.style.display = '';
    // Username: dari metadata → localStorage → fallback nama depan email
    const username = _authUser.user_metadata?.username
      || localStorage.getItem(USERNAME_KEY)
      || _authUser.email.split('@')[0];
    const initial = username.charAt(0).toUpperCase();
    const avatarEl = document.getElementById('settAvatarInitial');
    if (avatarEl) avatarEl.textContent = initial;
    const unEl = document.getElementById('settUsernameDisplay');
    if (unEl) unEl.textContent = username;
    const emEl = document.getElementById('settEmailDisplay');
    if (emEl) emEl.textContent = _authUser.email;
  } else {
    guestEl.style.display  = '';
    loggedEl.style.display = 'none';
  }
}

// Konfirmasi logout
function confirmLogout() {
  if (confirm('Yakin mau keluar dari akun ' + (_authUser ? _authUser.email : '') + '?')) doLogout();
}
async function doDeleteAccount() {
  if (!_authUser) return;
  const email = _authUser.email;
  const first = confirm('⚠️ Hapus akun ' + email + ' secara permanen?\n\nSemua data cloud akan hilang dan tidak bisa dipulihkan.');
  if (!first) return;
  const second = confirm('Konfirmasi terakhir: Akun dan seluruh data akan DIHAPUS PERMANEN. Lanjutkan?');
  if (!second) return;
  const sb = getSB();
  if (!sb) { toast('Supabase tidak terkonfigurasi', 'err'); return; }
  try {
    showSyncBadge('Menghapus akun...');
    // Hapus semua data user dari tabel userdata
    await sb.from('userdata').delete().eq('user_id', _authUser.id).catch(() => {});
    // Hapus akun auth-nya juga (butuh fungsi delete_own_account di SETUP_SUPABASE.sql),
    // kalau tidak, email tetap "already registered" saat daftar ulang.
    const { error: delErr } = await sb.rpc('delete_own_account');
    if (delErr) {
      hideSyncBadge();
      toast('Akun belum bisa dihapus permanen: jalankan SETUP_SUPABASE.sql terbaru (' + delErr.message + ')', 'err');
      return;
    }
    // Sign out dulu agar tidak ada session aktif
    await sb.auth.signOut().catch(() => {});
    hideSyncBadge();
    stopRealtimeSync();
    _stopPolling();
    _authUser = null;
    clearLocalData();
    localStorage.removeItem(GUEST_KEY);
    if (typeof loadSettingsUI  === 'function') loadSettingsUI();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderInvList   === 'function') renderInvList();
    updateSettAkunRow();
    resetAuthModal();
    showAuthPage();
    toast('Akun berhasil dihapus', 'ok');
  } catch(e) {
    hideSyncBadge();
    toast('Gagal menghapus akun: ' + (e.message || e), 'err');
  }
}
function switchAuthTab(tab) {
  document.getElementById('authTabLogin').classList.toggle('auth-tab-active', tab === 'login');
  document.getElementById('authTabRegister').classList.toggle('auth-tab-active', tab === 'register');
  document.getElementById('authFormLogin').style.display   = tab === 'login'    ? '' : 'none';
  document.getElementById('authFormRegister').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('authErr').textContent = '';
}
function setAuthLoading(on) {
  document.getElementById('authBtnLogin').disabled    = on;
  document.getElementById('authBtnRegister').disabled = on;
  document.getElementById('authSpinner').style.display = on ? 'block' : 'none';
}
function showAuthErr(msg) { document.getElementById('authErr').textContent = msg; }
function showSyncBadge(msg) { const el = document.getElementById('syncBadge'); if (el) { el.textContent = '⟳ ' + msg; el.style.display = 'inline-flex'; } }
function hideSyncBadge()    { const el = document.getElementById('syncBadge'); if (el) el.style.display = 'none'; }

// ── Hapus semua data lokal ns3_ (kecuali GUEST_KEY & USERNAME_KEY) ──
function clearLocalData() {
  // Simpan cadangan otomatis dulu (dibaca sinkron sebelum dihapus) — lihat script.js
  if (typeof autoBackupLocal === 'function') autoBackupLocal('sebelum data perangkat dikosongkan', true);
  const preserve = [GUEST_KEY, USERNAME_KEY];
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('ns3_') && !preserve.includes(k)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

// ── Mode Tamu ──
function doGuestMode() {
  clearLocalData(); // mulai fresh, tidak ada sisa data akun sebelumnya
  localStorage.setItem(GUEST_KEY, '1');
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('app').style.display = '';
  loadSettingsUI();
  renderDashboard();
  if (typeof renderInvList === 'function') renderInvList();
  updateSettAkunRow();
  toast('Mode offline — data tersimpan di perangkat ini', 'ok');
}

// ── Login ──
async function doLogin() {
  const sb = getSB();
  if (!sb) { showAuthErr('Supabase belum dikonfigurasi di config.js'); return; }
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if (!email || !pass) { showAuthErr('Email dan password wajib diisi.'); return; }
  setAuthLoading(true);
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) { showAuthErr(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message); return; }
    localStorage.removeItem(GUEST_KEY);
    await onSignedIn(data.user, false);
  } catch(e) { showAuthErr('Gagal terhubung. Cek koneksi internet.'); }
  finally { setAuthLoading(false); }
}

// ── Register ──
async function doRegister() {
  const sb = getSB();
  if (!sb) { showAuthErr('Supabase belum dikonfigurasi di config.js'); return; }
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  if (!username)    { showAuthErr('Username wajib diisi.'); return; }
  if (!email || !pass) { showAuthErr('Email dan password wajib diisi.'); return; }
  if (pass.length < 6)  { showAuthErr('Password minimal 6 karakter.'); return; }
  if (pass !== pass2)   { showAuthErr('Password tidak cocok.'); return; }
  setAuthLoading(true);
  let signUpData = null;
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { username } } });
    if (error) {
      const msg = String(error.message || '');
      if (error.code === 'user_already_exists' || /already\s*(been\s*)?registered/i.test(msg)) {
        _suggestLogin(email);
      } else if (/rate limit|too many/i.test(msg)) {
        showAuthErr('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
      } else if (/password/i.test(msg)) {
        showAuthErr('Password terlalu lemah / tidak valid: ' + msg);
      } else {
        showAuthErr(msg);
      }
      return;
    }
    // Email sudah terdaftar & terkonfirmasi: Supabase mengembalikan user "palsu" tanpa identities
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      _suggestLogin(email);
      return;
    }
    signUpData = data;
  } catch(e) {
    showAuthErr('Gagal terhubung. Cek koneksi internet.');
    setAuthLoading(false);
    return;
  }
  // Akun SUDAH terbuat di titik ini. Error setelahnya tidak boleh membuat user mengulang daftar.
  try {
    if (signUpData?.user && !signUpData.user.email_confirmed_at && !signUpData.session) {
      showAuthErr('Cek email kamu untuk konfirmasi akun, lalu login.');
      switchAuthTab('login'); return;
    }
    if (signUpData?.user) {
      localStorage.setItem(USERNAME_KEY, username);
      localStorage.removeItem(GUEST_KEY);
      await onSignedIn(signUpData.user, true);
    }
  } catch(e) {
    console.warn('[NS] Post-register error', e);
    _suggestLogin(email, 'Akun berhasil dibuat, tapi terjadi kendala. Silakan login.');
  }
  finally { setAuthLoading(false); }
}

function _suggestLogin(email, msg) {
  switchAuthTab('login');
  const el = document.getElementById('loginEmail');
  if (el && email) el.value = email;
  showAuthErr(msg || 'Email ini sudah terdaftar. Silakan login (atau gunakan "lupa password" bila perlu).');
}

// ── Logout ──
let _explicitLogout = false;
async function doLogout() {
  const sb = getSB();
  if (sb && _authUser) {
    showSyncBadge('Menyimpan...');
    const allSaved = await CloudDB.pushAll().catch(() => false);
    hideSyncBadge();
    // Jangan hapus data di HP kalau ada yang belum berhasil tersimpan di cloud
    if (allSaved === false && !confirm('Sebagian data BELUM tersimpan ke cloud (cek koneksi internet).\n\nKalau tetap keluar, data yang belum tersimpan akan hilang dari perangkat ini. Tetap keluar?')) return;
    stopRealtimeSync();
    _explicitLogout = true;
    await sb.auth.signOut().catch(() => {});
  }
  _authUser = null;
  _stopPolling();
  clearLocalData();
  localStorage.removeItem(GUEST_KEY);
  // Sembunyikan header user
  const el = document.getElementById('headerUserEmail');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
  const lb = document.getElementById('logoutBtn');
  if (lb) lb.style.display = 'none';
  if (typeof loadSettingsUI  === 'function') loadSettingsUI();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderInvList   === 'function') renderInvList();
  updateSettAkunRow();
  resetAuthModal();
  showAuthPage();
  toast('Keluar berhasil', 'ok');
}

// ── After sign-in ──
async function onSignedIn(user, isNew) {
  // Data lokal milik akun LAIN (mis. HP dipakai bergantian) → kosongkan dulu
  // supaya tidak tercampur. Data milik akun yang sama / data tamu tetap dipakai
  // dan digabung ke cloud, bukan dibuang.
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner && owner !== user.id) clearLocalData();
  localStorage.setItem(OWNER_KEY, user.id);
  _authUser = user;
  _patchDB();
  // Simpan username dari metadata kalau ada
  if (user.user_metadata?.username) {
    localStorage.setItem(USERNAME_KEY, user.user_metadata.username);
  }
  // Tampilkan layar sukses dulu di dalam popup
  showAuthSuccess(user.email, isNew);
  // Load data di background
  showSyncBadge('Menyinkronkan...');
  await CloudDB.pullAll().catch(() => {});
  hideSyncBadge();
  renderDashboard();
  if (typeof renderInvList         === 'function') renderInvList();
  if (typeof renderExpenseList     === 'function') renderExpenseList();
  if (typeof renderCatalogList     === 'function') renderCatalogList();
  if (typeof renderEkspedisiList   === 'function') renderEkspedisiList();
  if (typeof populateEkspedisiSelect === 'function') populateEkspedisiSelect();
  loadSettingsUI();
  applyAppearance();
  updateSettAkunRow();
  // Mulai realtime sync
  startRealtimeSync();
  _startPolling(); // BUG FIX #8: mulai polling fallback
  // Tutup popup otomatis setelah 1.8 detik
  setTimeout(() => {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('app').style.display = '';
    resetAuthModal();
  }, 1800);
}

// Patch DB.set → auto push ke cloud
let _dbPatched = false;
function _patchDB() {
  if (_dbPatched) return; _dbPatched = true;
  const orig = DB.set.bind(DB);
  DB.set = (k, v) => {
    orig(k, v);
    if (k === 'formDraft' || k === 'ibDismissed') return;
    if (_authUser) CloudDB._push(k, v);
    // Sesi login sedang putus tapi data ini milik akun → tandai, dikirim saat login lagi
    else if (k !== 'invoices' && _isSyncKey(k) && localStorage.getItem(OWNER_KEY)) _setPending(k, true);
  };
}

// BUG FIX #6: Sync ulang data saat tab kembali aktif (pindah dari HP/laptop lain)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && _authUser) {
    const before = {
      settings:  JSON.stringify(DB.get('settings', {})),
      logo:      localStorage.getItem('ns3_logo'),
      signature: localStorage.getItem('ns3_signature'),
      products:  JSON.stringify(DB.get('products',  [])),
      ekspedisi: JSON.stringify(DB.get('ekspedisi', []))
    };
    await CloudDB.pullAll().catch(() => {});
    const settingsChanged = before.settings  !== JSON.stringify(DB.get('settings', {}))
                         || before.logo      !== localStorage.getItem('ns3_logo')
                         || before.signature !== localStorage.getItem('ns3_signature');
    if (settingsChanged) {
      if (typeof loadSettingsUI  === 'function') loadSettingsUI();
      if (typeof applyAppearance === 'function') applyAppearance();
    }
    if (before.products !== JSON.stringify(DB.get('products', [])) || before.ekspedisi !== JSON.stringify(DB.get('ekspedisi', []))) {
      if (typeof renderCatalogList     === 'function') renderCatalogList();
      if (typeof renderEkspedisiList   === 'function') renderEkspedisiList();
      if (typeof populateEkspedisiSelect === 'function') populateEkspedisiSelect();
    }
  }
});
// BUG FIX #6: Sync ulang saat koneksi internet kembali
window.addEventListener('online', () => {
  if (_authUser) {
    startRealtimeSync();
    CloudDB.pullAll().catch(() => {}); // pullAll juga mengirim ulang data yang tertunda
  }
});

// ── Boot ──
async function initAuth() {
  _patchDB(); // aktif sejak awal supaya perubahan saat sesi putus tetap ditandai "belum terkirim"
  try {
    // Kalau sebelumnya pilih guest mode, langsung masuk
    if (localStorage.getItem(GUEST_KEY) === '1') {
      document.getElementById('authPage').style.display = 'none';
      document.getElementById('app').style.display = '';
      loadSettingsUI();
      updateSettAkunRow();
      return;
    }

    const sb = getSB();
    if (!sb) {
      // config.js belum diisi → langsung masuk offline, tampilkan popup
      document.getElementById('app').style.display = '';
      showAuthPage();
      updateSettAkunRow();
      return;
    }

    // Cek sesi aktif
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw error;

    if (session?.user) {
      await onSignedIn(session.user);
    } else {
      // Tampilkan app di belakang, popup di atas
      document.getElementById('app').style.display = '';
      showAuthPage();
      updateSettAkunRow();
    }

    // Listen auth changes
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user && session.user.id !== _authUser?.id) await onSignedIn(session.user);
      if (event === 'SIGNED_OUT') {
        stopRealtimeSync();
        _stopPolling();
        _authUser = null;
        if (_explicitLogout) { _explicitLogout = false; return; } // doLogout() yang mengurus sisanya
        // BUG FIX (DATA HILANG SETELAH UPDATE): SIGNED_OUT juga dipicu OTOMATIS
        // oleh Supabase kalau refresh token gagal — mis. app dibuka ulang setelah
        // update sementara tab lama masih hidup (token dipakai 2x), atau sinyal
        // putus saat token diperbarui. Dulu di sini semua data lokal langsung
        // dihapus, termasuk yang belum sempat naik ke cloud & pengaturan akun.
        // Sekarang data di perangkat DIBIARKAN; user cukup login lagi dan
        // datanya otomatis digabung ke cloud.
        updateSettAkunRow();
        resetAuthModal();
        showAuthPage();
        showAuthErr('Sesi login berakhir. Silakan login lagi — data di perangkat ini tetap aman.');
      }
    });

  } catch(e) {
    // Apapun errornya → jangan blank, langsung masuk offline
    console.error('[NS] initAuth error', e);
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('app').style.display = '';
    loadSettingsUI();
    updateSettAkunRow();
  }
}

// Enter key support
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const ap = document.getElementById('authPage');
  if (!ap || ap.style.display === 'none') return;
  const isLogin = document.getElementById('authFormLogin').style.display !== 'none';
  if (isLogin) doLogin(); else doRegister();
});

// Klik backdrop (area luar auth-box) → tutup kalau bisa
document.getElementById('authPage').addEventListener('click', function(e) {
  if (e.target === this) closeAuthModal();
});

// BUG FIX #8: Polling fallback — pull setiap 60 detik sebagai safety net
// kalau Realtime channel miss event (Safari → Chrome sering bermasalah)
let _pollTimer = null;
function _startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  // 60 detik & hanya saat tab terlihat: pullAll mengunduh semua row (termasuk logo/nota),
  // jadi polling 15 detik membuat HP terasa berat. Realtime + visibilitychange tetap jalan.
  _pollTimer = setInterval(() => {
    if (_authUser && document.visibilityState === 'visible') CloudDB.pullAll().catch(() => {});
  }, 60000);
}
function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

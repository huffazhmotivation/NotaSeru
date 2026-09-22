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

// ── CloudDB ──
const CloudDB = {
  get(k, def = null) { return DB.get(k, def); },
  set(k, v) {
    DB.set(k, v);
    if (_authUser) CloudDB._push(k, v);
  },
  async _push(k, v) {
    const sb = getSB(); if (!sb || !_authUser) return;
    const now = new Date().toISOString();
    const rows = [];

    if (k === 'settings') {
      // Pisahkan logo & signature ke row terpisah agar tidak melebihi batas JSONB Supabase
      const slim = Object.assign({}, v);
      const logo      = slim.logo;      delete slim.logo;
      const signature = slim.signature; delete slim.signature;
      rows.push({ user_id: _authUser.id, key: 'settings', value: slim, updated_at: now });
      if (logo      !== undefined) rows.push({ user_id: _authUser.id, key: 'logo',          value: logo,      updated_at: now });
      if (signature !== undefined) rows.push({ user_id: _authUser.id, key: 'signature',     value: signature, updated_at: now });
    } else {
      rows.push({ user_id: _authUser.id, key: k, value: v, updated_at: now });
    }

    for (const row of rows) {
      try {
        const { error } = await sb.from('userdata').upsert(row, { onConflict: 'user_id,key' });
        if (error) console.warn('CloudDB push err', row.key, error);
      } catch(e) { console.warn('CloudDB push err', row.key, e); }
    }
  },
  async pullAll() {
    const sb = getSB(); if (!sb || !_authUser) return;
    try {
      const { data, error } = await sb.from('userdata').select('key, value, updated_at').eq('user_id', _authUser.id);
      if (error) throw error;
      if (!data?.length) return;
      // BUG FIX #3: Tulis langsung ke localStorage (bypass patched DB.set)
      // agar tidak trigger push balik ke cloud (infinite push loop)
      let changed = false;
      // Kumpulkan logo & signature dulu sebelum proses settings
      let incomingLogo = undefined, incomingSign = undefined;
      for (const row of data) {
        if (row.key === 'logo')      { incomingLogo = row.value; continue; }
        if (row.key === 'signature') { incomingSign = row.value; continue; }
        if (row.key === 'settings') {
          // Merge: settings dari cloud (slim) + logo/signature dari cloud/lokal
          try {
            const slim = Object.assign({}, row.value);
            // Logo & signature akan digabungkan setelah loop selesai
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
      // Sekarang gabungkan logo & signature ke settings
      try {
        const settingsRaw = localStorage.getItem('ns3_settings');
        const s = settingsRaw ? JSON.parse(settingsRaw) : {};
        let settingsDirty = false;
        if (incomingLogo !== undefined) {
          localStorage.setItem('ns3_logo', JSON.stringify(incomingLogo));
          if (incomingLogo) s.logo = incomingLogo; else delete s.logo;
          settingsDirty = true; changed = true;
        }
        if (incomingSign !== undefined) {
          localStorage.setItem('ns3_signature', JSON.stringify(incomingSign));
          if (incomingSign) s.signature = incomingSign; else delete s.signature;
          settingsDirty = true; changed = true;
        }
        if (settingsDirty) localStorage.setItem('ns3_settings', JSON.stringify(s));
      } catch {}
      console.log('[NS] pulled', data.length, 'keys, changed:', changed);
      // BUG FIX: render UI kalau ada data yang berubah
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
    const now = new Date().toISOString();
    const rows = [];

    // --- Settings: pisahkan logo & signature agar tidak melebihi batas JSONB ---
    const rawSettings = DB.get('settings', null);
    if (rawSettings !== null) {
      const slim = Object.assign({}, rawSettings);
      delete slim.logo; delete slim.signature;
      rows.push({ user_id: _authUser.id, key: 'settings', value: slim, updated_at: now });
    }

    // --- Logo & Signature: ambil langsung dari localStorage (bukan DB.get) ---
    try {
      const logoVal = localStorage.getItem('ns3_logo');
      if (logoVal) rows.push({ user_id: _authUser.id, key: 'logo', value: JSON.parse(logoVal), updated_at: now });
    } catch {}
    try {
      const signVal = localStorage.getItem('ns3_signature');
      if (signVal) rows.push({ user_id: _authUser.id, key: 'signature', value: JSON.parse(signVal), updated_at: now });
    } catch {}

    // --- Key lain ---
    const OTHER_KEYS = ['invoices','expenses','products','ekspedisi'];
    for (const k of OTHER_KEYS) {
      const v = DB.get(k, null);
      if (v !== null) rows.push({ user_id: _authUser.id, key: k, value: v, updated_at: now });
    }

    // --- grup_ dan inv_profit_ ---
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('ns3_')) continue;
      const clean = k.replace('ns3_','');
      if (clean.startsWith('grup_') || clean.startsWith('inv_profit_')) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          rows.push({ user_id: _authUser.id, key: clean, value: v, updated_at: now });
        } catch {}
      }
    }

    if (!rows.length) return;
    // Push per-row agar satu row gagal tidak blok semua
    for (const row of rows) {
      try {
        const { error } = await sb.from('userdata').upsert(row, { onConflict: 'user_id,key' });
        if (error) console.warn('CloudDB pushAll row err', row.key, error);
      } catch(e) { console.warn('CloudDB pushAll row err', row.key, e); }
    }
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
          // Re-render UI yang relevan
          _reRenderForKey(k);
          showSyncBadge('Tersinkron ✓');
          setTimeout(hideSyncBadge, 1500);
        } else if (eventType === 'DELETE') {
          const k = oldRow.key;
          localStorage.removeItem('ns3_' + k);
          _reRenderForKey(k);
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
    } else if (key === 'products' || key === 'ekspedisi') {
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
    // Sign out dulu agar tidak ada session aktif
    await sb.auth.signOut().catch(() => {});
    hideSyncBadge();
    stopRealtimeSync();
    _stopPolling();
    _authUser = null;
    _dbPatched = false;
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
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { username } } });
    if (error) { showAuthErr(error.message); return; }
    if (data?.user && !data.user.email_confirmed_at && !data.session) {
      showAuthErr('Cek email kamu untuk konfirmasi akun, lalu login.');
      switchAuthTab('login'); return;
    }
    if (data?.user) {
      localStorage.setItem(USERNAME_KEY, username);
      localStorage.removeItem(GUEST_KEY);
      await onSignedIn(data.user, true);
    }
  } catch(e) { showAuthErr('Gagal terhubung. Cek koneksi internet.'); }
  finally { setAuthLoading(false); }
}

// ── Logout ──
async function doLogout() {
  const sb = getSB();
  if (sb && _authUser) {
    showSyncBadge('Menyimpan...');
    await CloudDB.pushAll().catch(() => {});
    hideSyncBadge();
    stopRealtimeSync();
    await sb.auth.signOut().catch(() => {});
  }
  _authUser = null;
  _dbPatched = false;
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
    CloudDB.pullAll().catch(() => {});
  }
});

// ── Boot ──
async function initAuth() {
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
        _dbPatched = false;
        clearLocalData();
        if (typeof loadSettingsUI  === 'function') loadSettingsUI();
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderInvList   === 'function') renderInvList();
        resetAuthModal();
        showAuthPage();
        updateSettAkunRow();
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

// BUG FIX #8: Polling fallback — pull setiap 15 detik sebagai safety net
// kalau Realtime channel miss event (Safari → Chrome sering bermasalah)
let _pollTimer = null;
function _startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => {
    if (_authUser) CloudDB.pullAll().catch(() => {});
  }, 15000);
}
function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

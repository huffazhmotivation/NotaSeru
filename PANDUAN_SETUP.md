# 🚀 Panduan Setup NotaSeru dengan Login & Cloud Sync

## Langkah 1 — Buat Project Supabase (gratis)

1. Buka [https://supabase.com](https://supabase.com) → **Start your project**
2. Daftar / login dengan GitHub atau email
3. Klik **New Project** → isi nama project (misal: `notaseru`) dan password database
4. Tunggu ~2 menit sampai project siap

---

## Langkah 2 — Buat Tabel Database

1. Di dashboard Supabase, klik **SQL Editor** (menu kiri)
2. Klik **New query**
3. Copy-paste seluruh isi file `SETUP_SUPABASE.sql`
4. Klik **Run** → pastikan muncul "Success"

---

## Langkah 3 — Isi Config

1. Buka **Settings → API** di dashboard Supabase
2. Copy:
   - **Project URL** (contoh: `https://abcdefgh.supabase.co`)
   - **anon / public** key (string panjang dimulai `eyJ...`)
3. Buka file `config.js` dan isi kedua nilai tersebut

```js
window.NS_SUPABASE_URL     = 'https://abcdefgh.supabase.co';
window.NS_SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

---

## Langkah 4 — Deploy ke Netlify

1. Zip semua file (atau drag folder ke Netlify)
2. Buka [https://app.netlify.com](https://app.netlify.com)
3. Drag & drop zip ke **"Deploy manually"**

> ⚠️ Jangan lupa: `config.js` harus ikut ter-deploy berisi URL & key yang sudah diisi.

---

## Fitur yang ditambahkan

- ✅ **Login / Daftar** dengan email & password
- ✅ **Sinkronisasi otomatis** — semua nota, pengeluaran, produk, pengaturan tersimpan di cloud
- ✅ **Multi-device** — buka dari HP lain, data langsung muncul
- ✅ **Offline tetap bisa** — data tersimpan lokal, sync saat online
- ✅ **Row Level Security** — data tiap user terisolasi, tidak bisa diakses user lain

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| "Supabase belum dikonfigurasi" | Cek `config.js`, pastikan URL & key sudah diisi |
| Tidak bisa login | Pastikan SQL sudah dijalankan di Supabase |
| Data tidak muncul di device lain | Cek koneksi internet, lalu refresh halaman |
| Lupa password | Supabase punya fitur reset password via email (bisa diaktifkan) |

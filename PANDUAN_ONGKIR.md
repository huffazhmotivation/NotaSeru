# 📦 Panduan Setup Fitur "Cek Ongkir"

Fitur Cek Ongkir di tab bawah menampilkan tarif JNE, Wahana, Indah Cargo, Lion
Parcel, dan SiCepat — datanya diambil **langsung dari API resmi RajaOngkir
(by Komerce)**, bukan angka yang ditulis manual, supaya selalu akurat &
ikut update kalau tarif ekspedisi berubah.

Karena API key itu rahasia, dia **tidak boleh ditulis di kode** (kalau
ditulis di `script.js`, siapapun bisa lihat & pakai key kamu lewat DevTools
browser). Makanya sudah dibuatkan 1 file perantara di `api/ongkir.js` yang
jalan di server Vercel — browser bicara ke situ, dan situ yang bicara ke
RajaOngkir pakai key asli yang disimpan aman sebagai *Environment Variable*.

---

## Langkah 1 — Daftar Akun RajaOngkir (gratis)

1. Buka [https://rajaongkir.com](https://rajaongkir.com) → klik **Daftar Sekarang** (paket **Starter**, gratis, 100x cek/hari)
2. Selesaikan pendaftaran & verifikasi email
3. Login ke dashboard (collaborator.komerce.id)
4. Cari menu **API Key** → generate / copy API key kamu (string panjang)

---

## Langkah 2 — Simpan API Key di Vercel

1. Buka dashboard project NotaSeru kamu di [https://vercel.com](https://vercel.com)
2. Masuk ke **Settings → Environment Variables**
3. Tambahkan variable baru:
   - **Name**: `RAJAONGKIR_API_KEY`
   - **Value**: (paste API key dari Langkah 1)
   - **Environment**: centang semua (Production, Preview, Development)
4. Klik **Save**

---

## Langkah 3 — Deploy Ulang

1. Upload/replace seluruh isi zip ini ke repo/project Vercel kamu (termasuk folder `api/`)
2. Vercel akan otomatis mendeteksi `api/ongkir.js` sebagai serverless function — tidak perlu setting tambahan
3. Redeploy project (env variable baru butuh deploy ulang biar kebaca)

> ⚠️ Kalau cuma ganti Environment Variable tanpa redeploy, perubahan belum akan kepakai.

---

## Langkah 4 — Coba

1. Buka NotaSeru → tab **Ongkir** di bawah
2. Isi kota asal & tujuan (ketik minimal 3 huruf, pilih dari saran yang muncul)
3. Isi berat paket, pilih ekspedisi, klik **Cek Ongkir**

Kalau ada ekspedisi yang muncul "Tidak tersedia": itu artinya API RajaOngkir
memang tidak punya data untuk rute/berat itu, atau akun kamu belum
mendukung ekspedisi tersebut — bukan bug. **Indah Cargo** khususnya belum
100% dipastikan didukung di API versi terbaru; kalau setelah dicoba
ternyata selalu "Tidak tersedia" untuk semua rute, kabari saya supaya kode
kurirnya disesuaikan.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Muncul "RAJAONGKIR_API_KEY belum diset..." | Cek lagi Langkah 2, pastikan sudah redeploy setelah menambah env var |
| Semua ekspedisi "Tidak tersedia" | Cek API key masih aktif & kuota harian (100x/hari) belum habis di dashboard RajaOngkir |
| Pencarian kota tidak muncul hasil | Coba kata kunci lain (nama kecamatan/kota), minimal 3 huruf |
| Mau tambah ekspedisi lain (J&T, TIKI, dll) | Tinggal minta saya tambahkan — RajaOngkir support banyak ekspedisi lain juga |

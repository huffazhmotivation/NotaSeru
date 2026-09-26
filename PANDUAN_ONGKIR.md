# 📦 Panduan Setup Fitur "Cek Ongkir" (via Biteship)

Fitur Cek Ongkir di tab bawah menampilkan tarif JNE, Wahana, Lion Parcel,
dan SiCepat — datanya diambil **langsung dari API resmi Biteship**, bukan
angka yang ditulis manual, supaya selalu akurat & ikut update kalau tarif
ekspedisi berubah.

> ℹ️ **Kenapa pindah dari RajaOngkir ke Biteship?** Kontrak antara
> frontend (`script.js`) dan server (`api/ongkir.js`) sengaja dibuat sama
> persis seperti sebelumnya, jadi yang berubah cuma "dapur" di balik
> layar (`api/ongkir.js`) dan nama Environment Variable-nya. Tampilan &
> cara pakai di aplikasi tidak berubah sama sekali.
>
> **Catatan:** "Indah Cargo" tidak ada di daftar kurir Biteship, jadi
> otomatis hilang dari pilihan ekspedisi. Kalau mau, kamu bisa minta
> ditambahkan kurir lain yang didukung Biteship seperti **J&T (jnt)**,
> **AnterAja (anteraja)**, atau **TIKI (tiki)**.

Karena API key itu rahasia, dia **tidak boleh ditulis di kode** (kalau
ditulis di `script.js`, siapapun bisa lihat & pakai key kamu lewat DevTools
browser). Makanya tetap dipakai 1 file perantara di `api/ongkir.js` yang
jalan di server Vercel — browser bicara ke situ, dan situ yang bicara ke
Biteship pakai key asli yang disimpan aman sebagai *Environment Variable*.

---

## Langkah 1 — Daftar Akun Biteship (gratis)

1. Buka [https://biteship.com](https://biteship.com) → klik **Get Started Free** / daftar akun
2. Selesaikan pendaftaran & verifikasi akun
3. Login ke dashboard di [https://dashboard.biteship.com](https://dashboard.biteship.com)
4. Buka menu **Integrations** ([dashboard.biteship.com/integrations](https://dashboard.biteship.com/integrations)) → klik **Pengaturan** → **Tambah Kunci API**
5. Beri nama key-nya, lalu API key akan digenerate — **key ini cuma ditampilkan sekali**, langsung copy & simpan di tempat aman
   - Kalau baru mau coba-coba dulu, aktifkan **Testing Mode** di sidebar dashboard untuk dapat key testing (`biteship_test.…`) yang gratis dipakai tanpa perlu aktivasi Order API
   - Untuk pemakaian asli (`biteship_live.…`), Rates API (cek ongkir) sudah bisa dipakai langsung tanpa perlu approval tambahan

---

## Langkah 2 — Ganti Environment Variable di Vercel

Ini bagian yang perlu diubah di Vercel:

1. Buka dashboard project NotaSeru kamu di [https://vercel.com](https://vercel.com)
2. Masuk ke **Settings → Environment Variables**
3. **Hapus** variable lama `RAJAONGKIR_API_KEY` (kalau masih ada — tidak wajib dihapus, tapi rapi lebih baik karena sudah tidak dipakai kode)
4. **Tambahkan** variable baru:
   - **Name**: `BITESHIP_API_KEY`
   - **Value**: (paste API key dari Langkah 1)
   - **Environment**: centang semua (Production, Preview, Development)
5. Klik **Save**

---

## Langkah 3 — Deploy Ulang

1. Upload/replace seluruh isi zip ini ke repo/project Vercel kamu (termasuk folder `api/` dan `script.js` yang sudah diperbarui)
2. Vercel akan otomatis mendeteksi `api/ongkir.js` sebagai serverless function — tidak perlu setting tambahan
3. Redeploy project (env variable baru butuh deploy ulang biar kebaca)

> ⚠️ Kalau cuma ganti Environment Variable tanpa redeploy, perubahan belum akan kepakai.

---

## Langkah 4 — Coba

1. Buka NotaSeru → tab **Ongkir** di bawah
2. Isi kota asal & tujuan (ketik minimal 3 huruf, pilih dari saran yang muncul — ini sekarang datang dari **Biteship Maps API**)
3. Isi berat paket (dalam gram, sama seperti sebelumnya), pilih ekspedisi, klik **Cek Ongkir**

Kalau ada ekspedisi yang muncul "Tidak tersedia": lihat baris alasannya di
kartu hasilnya — pesan itu menampilkan **alasan asli langsung dari
Biteship** (bukan teks generik), jadi kelihatan jelas apakah masalahnya
soal rute/berat, atau kurirnya memang tidak melayani rute tersebut.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Muncul "BITESHIP_API_KEY belum diset..." | Cek lagi Langkah 2, pastikan sudah redeploy setelah menambah env var |
| Semua ekspedisi "Tidak tersedia" atau error otorisasi | Pastikan API key masih aktif, dan kamu memakai key yang sesuai (jangan pakai key testing `biteship_test.` untuk kebutuhan produksi) |
| Pencarian kota tidak muncul hasil | Coba kata kunci lain (nama kecamatan/kota), minimal 3 huruf |
| "Indah Cargo" hilang dari daftar | Memang tidak didukung Biteship — minta saya gantikan dengan kurir Biteship lain seperti J&T, AnterAja, atau TIKI |
| Mau tambah ekspedisi lain (J&T, AnterAja, TIKI, dll) | Tinggal minta saya tambahkan — tinggal tambah baris di `OCK_COURIERS` (script.js) & `COURIER_MAP` (api/ongkir.js) dengan kode kurir sesuai daftar resmi di [docs Biteship](https://biteship.com/docs/api/couriers/overview) |

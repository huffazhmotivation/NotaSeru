// api/ongkir.js
// -----------------------------------------------------------------------
// Proxy tipis ke RajaOngkir (by Komerce) API v2.
//
// KENAPA HARUS LEWAT SINI (bukan langsung dari browser)?
// API key RajaOngkir itu RAHASIA — kalau dipanggil langsung dari script.js
// di browser, siapa saja bisa buka DevTools > Network dan mencuri key-nya
// buat dipakai gratis/disalahgunakan. Endpoint /api/ongkir ini jalan di
// server Vercel, jadi browser cuma bicara ke sini, dan hanya file inilah
// yang menyimpan & memakai key aslinya lewat environment variable
// RAJAONGKIR_API_KEY (diset di dashboard Vercel, BUKAN ditulis di kode).
//
// Cara pakai dari frontend:
//   GET  /api/ongkir?search=<kata kunci kota/kecamatan>
//        -> { data: [{ id, label }] }
//   POST /api/ongkir   body JSON: { origin, destination, weight, couriers }
//        -> { data: [{ courier, name, available, services:[{service,description,cost,etd}] }] }
// -----------------------------------------------------------------------

const BASE = 'https://rajaongkir.komerce.id/api/v1';

// Kurir yang dipakai di NotaSeru. RajaOngkir (Komerce) punya skema akun
// gratis "Starter" dan berlangganan "Pro" — TIDAK semua kurir otomatis aktif
// di akun gratis, dan biasanya harus diaktifkan dulu satu-satu di dashboard
// Komerce (menu Integrasi/3PL) atau upgrade paket. "wahana" & "sicepat" juga
// dipindah ke UNCERTAIN (dicoba satu-satu, bukan digabung ke request "jne").
// FIX BUG: sebelumnya wahana & sicepat digabung jadi SATU request bareng
// jne & lion (courier=jne:wahana:lion:sicepat). Kalau akun kamu belum
// meng-cover wahana/sicepat, RajaOngkir tidak selalu error total untuk
// request gabungan itu — dia cuma "diam" (tidak mengembalikan baris apa pun)
// untuk kurir yang tidak didukung, sementara jne/lion tetap normal. Karena
// tidak ada error yang ditangkap, kode lama menandai wahana/sicepat dengan
// pesan generik "Tidak ada layanan untuk rute/berat ini" — padahal alasan
// aslinya BUKAN soal rute, tapi kurir itu belum aktif di akun. Dengan
// dicoba satu-satu di sini (lihat blok "uncertain" di calcCost), kalau
// memang ditolak API, pesan yang tampil ke user jadi lebih jujur & jelas
// ("Kurir ini belum didukung API/akun kamu saat ini" — lihat di bawah).
const COURIER_MAP = {
  jne: 'JNE',
  wahana: 'Wahana',
  lion: 'Lion Parcel',
  sicepat: 'SiCepat',
  indah: 'Indah Cargo',
};
const SAFE_COURIERS = ['jne', 'lion'];
const UNCERTAIN_COURIERS = ['wahana', 'sicepat', 'indah'];

function getKey() {
  const key = process.env.RAJAONGKIR_API_KEY;
  if (!key) {
    const err = new Error(
      'RAJAONGKIR_API_KEY belum diset. Tambahkan di Vercel → Project Settings → Environment Variables, lalu redeploy.'
    );
    err.isConfigError = true;
    throw err;
  }
  return key;
}

async function rajaOngkirFetch(path, opts = {}) {
  const key = getKey();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { key, ...(opts.headers || {}) },
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok || !json || (json.meta && json.meta.status === 'error')) {
    const msg = (json && json.meta && json.meta.message) || `RajaOngkir merespons error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return json.data;
}

async function searchDestination(q) {
  const data = await rajaOngkirFetch(
    `/destination/domestic-destination?search=${encodeURIComponent(q)}&limit=10&offset=0`
  );
  return (data || []).map((d) => ({
    id: d.id,
    label:
      d.label ||
      [d.subdistrict_name, d.district_name, d.city_name, d.province_name].filter(Boolean).join(', '),
    // Kode pos ikut dikirim ke frontend & disimpan di state — dipakai NANTI
    // sebagai fallback ke Biteship (lihat blok BITESHIP FALLBACK di bawah),
    // karena Biteship butuh kode pos/koordinat, bukan ID lokasi RajaOngkir.
    zip: d.zip_code || null,
  }));
}

// ── BITESHIP FALLBACK (opsional) ──────────────────────────────────────
// Wahana, SiCepat & Indah Cargo tidak selalu aktif di akun RajaOngkir
// (Komerce) Starter/gratis (lihat komentar UNCERTAIN_COURIERS di atas).
// Biteship diketahui mendukung ketiga kurir ini secara resmi, jadi kalau
// BITESHIP_API_KEY diisi, ketiganya dicoba lagi lewat Biteship SEBELUM
// ditandai "Tidak tersedia" — RajaOngkir tetap jadi sumber utama/pertama,
// Biteship cuma pelengkap utk 3 kurir yg RajaOngkir tidak cover.
// Kalau BITESHIP_API_KEY tidak diisi, fallback ini otomatis dilewati
// (tidak wajib disetup) dan perilaku tetap seperti sebelumnya.
const BITESHIP_BASE = 'https://api.biteship.com/v1';
const BITESHIP_NAME_HINT = { wahana: 'wahana', sicepat: 'sicepat', indah: 'indah' };
let biteshipCourierCache = null; // { wahana: 'wahana', sicepat: 'sicepat', indah: 'indahcargo' } dst — hasil resolve asli dari akun Biteship, bukan tebakan

async function biteshipFetch(path, opts = {}) {
  const key = process.env.BITESHIP_API_KEY;
  const res = await fetch(BITESHIP_BASE + path, {
    ...opts,
    headers: { authorization: key, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok || !json || json.success === false) {
    const msg = (json && (json.error || json.message)) || `Biteship merespons error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return json;
}

// Kode kurir di Biteship tidak selalu sama persis dengan kode di RajaOngkir,
// jadi kita tanya langsung ke akun Biteship kurir apa saja yang aktif
// (GET /couriers), lalu cocokkan by nama — bukan menebak/hardcode kode.
async function resolveBiteshipCourierCode(ourCode) {
  if (!biteshipCourierCache) {
    const json = await biteshipFetch('/couriers');
    const list = json.couriers || json.data || [];
    biteshipCourierCache = {};
    for (const key of Object.keys(BITESHIP_NAME_HINT)) {
      const hint = BITESHIP_NAME_HINT[key];
      const found = list.find(
        (c) => String(c.courier_code || '').toLowerCase().includes(hint) ||
          String(c.courier_name || '').toLowerCase().includes(hint)
      );
      if (found) biteshipCourierCache[key] = found.courier_code;
    }
  }
  return biteshipCourierCache[ourCode] || null;
}

async function biteshipRatesForCourier(ourCode, { originZip, destinationZip, weight }) {
  if (!process.env.BITESHIP_API_KEY) return null; // fallback belum di-setup
  if (!originZip || !destinationZip) return null; // butuh kode pos asal & tujuan (dari hasil pencarian lokasi)
  const courierCode = await resolveBiteshipCourierCode(ourCode);
  if (!courierCode) return null; // kurir ini juga tidak aktif di akun Biteship kamu

  const json = await biteshipFetch('/rates/couriers', {
    method: 'POST',
    body: JSON.stringify({
      origin_postal_code: Number(originZip),
      destination_postal_code: Number(destinationZip),
      couriers: courierCode,
      items: [{ name: 'Paket', value: 10000, weight: Math.max(1, Number(weight) || 1), quantity: 1 }],
    }),
  });
  const rows = (json.pricing || json.data || []).filter(
    (p) => String(p.courier_code || '').toLowerCase() === courierCode.toLowerCase()
  );
  return rows.map((p) => ({
    service: p.courier_service_name || p.service_name || p.type || 'Layanan',
    description: p.description || p.courier_service_code || '',
    cost: p.price,
    etd: p.duration || p.etd || '',
  }));
}

// Dibungkus try/catch sendiri: kalau Biteship ikut gagal (key salah, kuota
// habis, dll), kita diam-diam kembali ke pesan error RajaOngkir yang asli,
// bukan malah menimpanya dengan error Biteship yang bisa membingungkan.
async function tryBiteshipFallback(ourCode, params) {
  try {
    return await biteshipRatesForCourier(ourCode, params);
  } catch (e) {
    return null;
  }
}

function buildCostBody(origin, destination, weight, courierParam) {
  return new URLSearchParams({
    origin: String(origin),
    destination: String(destination),
    weight: String(weight),
    courier: courierParam,
  });
}

async function calcCost({ origin, destination, weight, couriers, originZip, destinationZip }) {
  const wanted = (couriers && couriers.length ? couriers : Object.keys(COURIER_MAP)).filter(
    (c) => COURIER_MAP[c]
  );
  const safe = wanted.filter((c) => SAFE_COURIERS.includes(c));
  const uncertain = wanted.filter((c) => UNCERTAIN_COURIERS.includes(c));

  const grouped = {};
  const markUnavailable = (code, reason) => {
    grouped[code] = { courier: code, name: COURIER_MAP[code], available: false, reason, services: [] };
  };
  const addResults = (rows) => {
    for (const row of rows || []) {
      const code = String(row.code || '').toLowerCase();
      if (!COURIER_MAP[code]) continue;
      if (!grouped[code]) {
        grouped[code] = { courier: code, name: COURIER_MAP[code], available: true, services: [] };
      }
      grouped[code].services.push({
        service: row.service,
        description: row.description,
        cost: row.cost,
        etd: row.etd,
      });
    }
  };

  // Kurir yang sudah pasti didukung: satu request gabungan (hemat kuota harian).
  if (safe.length) {
    try {
      const rows = await rajaOngkirFetch('/calculate/domestic-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildCostBody(origin, destination, weight, safe.join(':')),
      });
      addResults(rows);
      safe.forEach((c) => {
        if (!grouped[c]) markUnavailable(c, 'Tidak ada layanan untuk rute/berat ini');
      });
    } catch (e) {
      safe.forEach((c) => markUnavailable(c, e.message));
    }
  }

  // Kurir yang belum pasti didukung (Wahana, SiCepat, Indah Cargo): dicoba
  // sendiri-sendiri supaya kalau salah satu ditolak API, kurir lain tetap
  // tampil normal DAN pesan errornya jujur — kita tampilkan langsung pesan
  // asli dari RajaOngkir (e.message), bukan teks generik yang dikarang.
  // Ini penting supaya kelihatan jelas apakah alasannya "kurir ini belum
  // diaktifkan di akun kamu", "butuh upgrade paket", atau sebab lain.
  for (const code of uncertain) {
    try {
      const rows = await rajaOngkirFetch('/calculate/domestic-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildCostBody(origin, destination, weight, code),
      });
      addResults(rows);
      if (!grouped[code]) {
        // RajaOngkir tidak error, tapi juga tidak mengembalikan baris apapun
        // untuk kurir ini — coba Biteship dulu sebelum ditandai tidak tersedia.
        const bsRows = await tryBiteshipFallback(code, { originZip, destinationZip, weight });
        if (bsRows && bsRows.length) {
          grouped[code] = { courier: code, name: COURIER_MAP[code], available: true, services: bsRows };
        } else {
          markUnavailable(code, 'Tidak ada layanan untuk rute/berat ini');
        }
      }
    } catch (e) {
      const bsRows = await tryBiteshipFallback(code, { originZip, destinationZip, weight });
      if (bsRows && bsRows.length) {
        grouped[code] = { courier: code, name: COURIER_MAP[code], available: true, services: bsRows };
      } else {
        markUnavailable(code, `Belum didukung akun/API kamu saat ini — pesan dari RajaOngkir: ${e.message}`);
      }
    }
  }

  return wanted.map(
    (c) => grouped[c] || { courier: c, name: COURIER_MAP[c], available: false, reason: 'Tidak diketahui', services: [] }
  );
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const q = String(req.query.search || req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'Parameter search kosong' });
      const data = await searchDestination(q);
      return res.status(200).json({ data });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
      }
      body = body || {};
      const { origin, destination, weight, couriers, originZip, destinationZip } = body;
      if (!origin || !destination || !weight) {
        return res.status(400).json({ error: 'origin, destination, dan weight wajib diisi' });
      }
      const data = await calcCost({
        origin,
        destination,
        weight: Math.max(1, Number(weight) || 0),
        couriers,
        originZip,
        destinationZip,
      });
      return res.status(200).json({ data });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method tidak didukung' });
  } catch (e) {
    return res.status(e.isConfigError ? 501 : 500).json({ error: e.message || 'Terjadi kesalahan pada server ongkir' });
  }
};

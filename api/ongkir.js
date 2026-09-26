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

// Kurir yang dipakai di NotaSeru. "indah" (Indah Cargo) ditandai "uncertain"
// karena kode kurir ini ada di RajaOngkir versi lama, tapi belum dipastikan
// selalu didukung akun/API v2 yang baru — jadi kita coba terpisah dan kalau
// memang tidak didukung, ditandai "tidak tersedia" apa adanya (BUKAN dikira-kira).
const COURIER_MAP = {
  jne: 'JNE',
  wahana: 'Wahana',
  lion: 'Lion Parcel',
  sicepat: 'SiCepat',
  indah: 'Indah Cargo',
};
const SAFE_COURIERS = ['jne', 'wahana', 'lion', 'sicepat'];
const UNCERTAIN_COURIERS = ['indah'];

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
  }));
}

function buildCostBody(origin, destination, weight, courierParam) {
  return new URLSearchParams({
    origin: String(origin),
    destination: String(destination),
    weight: String(weight),
    courier: courierParam,
  });
}

async function calcCost({ origin, destination, weight, couriers }) {
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

  // Kurir yang belum pasti (mis. Indah Cargo): dicoba sendiri-sendiri supaya
  // kalau kodenya ditolak API, kurir lain tetap tampil normal.
  for (const code of uncertain) {
    try {
      const rows = await rajaOngkirFetch('/calculate/domestic-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildCostBody(origin, destination, weight, code),
      });
      addResults(rows);
      if (!grouped[code]) markUnavailable(code, 'Tidak ada layanan untuk rute/berat ini');
    } catch (e) {
      markUnavailable(code, 'Kurir ini belum didukung API/akun kamu saat ini');
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
      const { origin, destination, weight, couriers } = body;
      if (!origin || !destination || !weight) {
        return res.status(400).json({ error: 'origin, destination, dan weight wajib diisi' });
      }
      const data = await calcCost({
        origin,
        destination,
        weight: Math.max(1, Number(weight) || 0),
        couriers,
      });
      return res.status(200).json({ data });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method tidak didukung' });
  } catch (e) {
    return res.status(e.isConfigError ? 501 : 500).json({ error: e.message || 'Terjadi kesalahan pada server ongkir' });
  }
};

// api/ongkir.js
// -----------------------------------------------------------------------
// Proxy tipis ke Biteship API v1 (menggantikan RajaOngkir/Komerce).
//
// KENAPA HARUS LEWAT SINI (bukan langsung dari browser)?
// API key Biteship itu RAHASIA — kalau dipanggil langsung dari script.js
// di browser, siapa saja bisa buka DevTools > Network dan mencuri key-nya
// buat dipakai gratis/disalahgunakan. Endpoint /api/ongkir ini jalan di
// server Vercel, jadi browser cuma bicara ke sini, dan hanya file inilah
// yang menyimpan & memakai key aslinya lewat environment variable
// BITESHIP_API_KEY (diset di dashboard Vercel, BUKAN ditulis di kode).
//
// Cara pakai dari frontend (KONTRAK INI SENGAJA DIPERTAHANKAN SAMA
// PERSIS seperti versi RajaOngkir lama, jadi script.js/index.html TIDAK
// perlu diubah sama sekali):
//   GET  /api/ongkir?search=<kata kunci kota/kecamatan>
//        -> { data: [{ id, label }] }
//   POST /api/ongkir   body JSON: { origin, destination, weight, couriers }
//        -> { data: [{ courier, name, available, services:[{service,description,cost,etd}] }] }
// -----------------------------------------------------------------------

const BASE = 'https://api.biteship.com/v1';

// Kurir yang dipakai di NotaSeru. Biteship punya daftar kurir sendiri
// (lihat GET /v1/couriers) yang kodenya TIDAK selalu sama dengan
// RajaOngkir. "Indah Cargo" yang dulu ada di RajaOngkir TIDAK tersedia
// di Biteship, jadi kurir ini otomatis ditandai "tidak didukung" kalau
// masih diminta dari frontend lama, bukan dihapus paksa di sini supaya
// tidak error kalau ada kode lama yang masih mengirimkan kode "indah".
const COURIER_MAP = {
  jne: 'JNE',
  wahana: 'Wahana',
  lion: 'Lion Parcel',
  sicepat: 'SiCepat',
};
// Kurir yang PERNAH ada di versi RajaOngkir tapi tidak ada di Biteship.
const UNSUPPORTED_COURIERS = {
  indah: 'Indah Cargo',
};

function getKey() {
  const key = process.env.BITESHIP_API_KEY;
  if (!key) {
    const err = new Error(
      'BITESHIP_API_KEY belum diset. Tambahkan di Vercel → Project Settings → Environment Variables, lalu redeploy.'
    );
    err.isConfigError = true;
    throw err;
  }
  return key;
}

async function biteshipFetch(path, opts = {}) {
  const key = getKey();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      authorization: key,
      ...(opts.headers || {}),
    },
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (!res.ok || !json || json.success === false) {
    const msg = (json && json.message) || `Biteship merespons error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function searchDestination(q) {
  const json = await biteshipFetch(
    `/maps/areas?countries=ID&input=${encodeURIComponent(q)}&type=single`
  );
  return (json.areas || []).map((a) => ({
    id: a.id,
    label: a.name,
  }));
}

async function calcCost({ origin, destination, weight, couriers }) {
  const wanted = couriers && couriers.length ? couriers : Object.keys(COURIER_MAP);
  const supported = wanted.filter((c) => COURIER_MAP[c]);
  const unsupported = wanted.filter((c) => UNSUPPORTED_COURIERS[c]);

  const grouped = {};
  const markUnavailable = (code, name, reason) => {
    grouped[code] = { courier: code, name, available: false, reason, services: [] };
  };

  // Kurir yang sudah pasti ada di Biteship (lihat GET /v1/couriers) —
  // Biteship boleh diminta sekaligus dalam satu request (dipisah koma).
  if (supported.length) {
    try {
      const json = await biteshipFetch('/rates/couriers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_area_id: origin,
          destination_area_id: destination,
          couriers: supported.join(','),
          items: [
            { name: 'Paket', description: 'Paket kiriman', value: 0, quantity: 1, weight },
          ],
        }),
      });
      for (const row of json.pricing || []) {
        const code = String(row.courier_code || '').toLowerCase();
        if (!COURIER_MAP[code]) continue;
        if (!grouped[code]) {
          grouped[code] = { courier: code, name: COURIER_MAP[code], available: true, services: [] };
        }
        grouped[code].services.push({
          service: row.courier_service_name,
          description: row.description,
          cost: row.price,
          etd: row.duration,
        });
      }
      supported.forEach((c) => {
        if (!grouped[c]) markUnavailable(c, COURIER_MAP[c], 'Tidak ada layanan untuk rute/berat ini');
      });
    } catch (e) {
      supported.forEach((c) => markUnavailable(c, COURIER_MAP[c], e.message));
    }
  }

  // Kurir lama (mis. "indah"/Indah Cargo) yang tidak ada lagi di Biteship.
  unsupported.forEach((c) => {
    markUnavailable(
      c,
      UNSUPPORTED_COURIERS[c],
      `${UNSUPPORTED_COURIERS[c]} tidak tersedia di Biteship. Pilih kurir lain (mis. JNE, Wahana, Lion Parcel, SiCepat), atau minta saya tambahkan kurir Biteship lain seperti J&T/AnterAja.`
    );
  });

  return wanted.map(
    (c) =>
      grouped[c] || {
        courier: c,
        name: COURIER_MAP[c] || UNSUPPORTED_COURIERS[c] || c,
        available: false,
        reason: 'Tidak diketahui',
        services: [],
      }
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

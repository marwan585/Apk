# AeroGrid Backend v1.0.0

Backend API + Admin Dashboard untuk aplikasi game booster **AeroGrid**.
Dibangun dengan **Node.js + Express**, database **Supabase (PostgreSQL)**.

Domain produksi: **https://data.cloudnet.web.id**

---

## Isi Paket

```
aerogrid-backend/
├── app.js                 ← Entry utama (cPanel / VPS / lokal)
├── api/index.js           ← Adapter serverless Vercel
├── vercel.json            ← Konfigurasi deploy Vercel
├── package.json
├── ecosystem.config.js    ← Konfigurasi PM2 (VPS, opsional)
├── .env.example           ← Salin menjadi .env lalu isi
├── database/
│   └── schema.sql         ← SQL Supabase (WAJIB dijalankan)
├── src/
│   ├── config.js          ← Konfigurasi dari .env
│   ├── store.js           ← Lapisan data (Supabase / fallback memory)
│   ├── middleware/auth.js ← JWT admin
│   └── routes/
│       ├── api.js         ← Endpoint publik untuk aplikasi
│       └── admin.js       ← Endpoint dashboard (dilindungi JWT)
└── public/                ← Dashboard admin (HTML/CSS/JS)
    ├── index.html
    └── assets/{admin.css, admin.js}
```

---

## 1) Setup Supabase (wajib)

1. Buat project di [supabase.com](https://supabase.com) (Anda sudah punya).
2. Buka **SQL Editor → New query**.
3. Tempel **seluruh isi** `database/schema.sql` → klik **Run**.
   Tabel `devices`, `boost_sessions`, dan view `v_top_games` akan dibuat.
4. Buka **Project Settings → API**, salin:
   - **Project URL** → dipakai sebagai `SUPABASE_URL`
   - **service_role secret** → dipakai sebagai `SUPABASE_SERVICE_KEY`
     (⚠️ jangan pakai `anon key` di backend — RLS menguncinya dan tulisan akan gagal)

> Keamanan: RLS diaktifkan **tanpa policy publik**, jadi hanya backend
> (service_role) yang bisa mengakses data. Aplikasi Android **tidak pernah**
> menyentuh Supabase langsung — semua lewat backend ini. Kunci apa pun tidak
> pernah dikirim ke aplikasi.

---

## 2) Deploy A — cPanel "Setup Node.js App" (data.cloudnet.web.id)

1. Upload seluruh isi folder ini ke mis. `/home/USER/aerogrid-backend`
   (bisa di-compress jadi zip lalu Extract di File Manager).
2. cPanel → **Setup Node.js App** → Create Application:
   - Node.js version: **18 atau lebih baru**
   - Application root: `aerogrid-backend`
   - Application URL: pilih domain/subdomain `data.cloudnet.web.id`
   - Application startup file: **app.js**
3. Klik **Run NPM Install** (atau jalankan `npm ci` di terminal cPanel).
4. Buat file `.env` (salin dari `.env.example`) di folder aplikasi, isi:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - `ADMIN_USERNAME=Marwan`, `ADMIN_PASSWORD=Marwan` (ganti password!)
   - `JWT_SECRET` (isi string acak panjang)
   - `PORT` → **kosongkan** (cPanel mengisi otomatis)
5. Klik **Restart** di halaman Setup Node.js App.
6. Buka `https://data.cloudnet.web.id` → dashboard admin muncul → login.

> Catatan SSL: aktifkan **AutoSSL / Let's Encrypt** di cPanel agar HTTPS jalan
> (aplikasi Android mewajibkan https).

## 2) Deploy B — Vercel

1. `npm i -g vercel` lalu di dalam folder ini: `vercel`
2. Set Environment Variables di Project Settings:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `JWT_SECRET`, `NODE_ENV=production`.
3. Deploy → dapatkan domain → arahkan `data.cloudnet.web.id` (CNAME) ke Vercel.

> Pada Vercel, mode memory (fallback) bersifat sementara antar-invocation,
> jadi **wajib** mengisi Supabase di Environment Variables.

## 2) Deploy C — VPS (PM2)

```bash
npm ci
cp .env.example .env   # lalu isi
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # untuk JWT_SECRET
pm2 start ecosystem.config.js && pm2 save
# Nginx reverse proxy → localhost:3000, lalu certbot untuk HTTPS
```

---

## 3) Endpoint API

### Publik (dipakai aplikasi)

| Method | Endpoint                 | Keterangan                                |
|--------|--------------------------|-------------------------------------------|
| GET    | `/api/health`            | Cek status backend + database             |
| POST   | `/api/devices/register`  | Daftar/sinkron perangkat (device_id unik) |
| POST   | `/api/devices/heartbeat` | Detak jantung (dianggap online ≤ 5 mnt)  |
| POST   | `/api/boosts`            | Simpan log sesi boost                     |

Contoh register:

```bash
curl -X POST https://data.cloudnet.web.id/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"a1b2c3d4-...","model":"POCO X6 Pro","brand":"POCO",
       "androidVersion":"14","sdkInt":34,"processor":"Dimensity 8300",
       "ramTotalMb":12288,"refreshRate":120,"isRooted":false,"appVersion":"1.0.0"}'
```

### Admin (Bearer JWT — dari `/api/auth/login`)

| Method | Endpoint                      | Keterangan                        |
|--------|-------------------------------|-----------------------------------|
| POST   | `/api/auth/login`             | Login admin → token 12 jam        |
| GET    | `/api/admin/overview`         | Ringkasan (total, online, boost)  |
| GET    | `/api/admin/devices`          | Daftar perangkat (?page&search&status) |
| GET    | `/api/admin/devices/frequent` | Perangkat paling sering online    |
| GET    | `/api/admin/boosts`           | Log boost (?page&limit)           |
| DELETE | `/api/admin/devices/:id`      | Hapus perangkat + log terkait     |

```bash
curl -X POST https://data.cloudnet.web.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Marwan","password":"Marwan"}'
```

---

## 4) Keamanan yang sudah diterapkan

- **RLS terkunci penuh** — hanya `service_role` milik backend yang dapat akses.
- **JWT** untuk seluruh endpoint admin (12 jam, secret dari `.env`).
- **Rate limit** 600 req/15 menit per IP + login dibatasi 15 percobaan/15 menit.
- **Helmet** (security headers + CSP) pada semua response.
- **Timing-safe compare** untuk username/password admin.
- **Validasi & sanitasi input** di semua endpoint.
- **Tidak ada kunci rahasia di aplikasi** — aplikasi hanya tahu URL backend.
- Dashboard `noindex, nofollow` agar tidak terindeks mesin pencari.

## 5) Data yang disimpan

Hanya data yang penting: identitas perangkat unik, spesifikasi ringkas
(model, chipset, RAM, Android), status root, heartbeat, dan log boost.
Tidak ada data pribadi ( kontak, lokasi, isi penyimpanan) yang dikumpulkan.

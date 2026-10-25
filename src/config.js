/**
 * AeroGrid Backend — Konfigurasi terpusat
 * Semua nilai sensitif dibaca dari environment (.env).
 */
require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Supabase (gunakan SERVICE_ROLE key di server — JANGAN anon key)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '',

  // Kredensial admin dashboard (ganti lewat .env di produksi!)
  adminUsername: process.env.ADMIN_USERNAME || 'Marwan',
  adminPassword: process.env.ADMIN_PASSWORD || 'Marwan',

  // Secret JWT. Bila tidak diset, dipakai fallback TETAP agar token admin
  // TIDAK kedaluwarsa saat server restart. Disarankan tetap isi di .env.
  jwtSecret:
    process.env.JWT_SECRET ||
    'aerogrid-static-secret-Marwan-2024-keep-me-in-env',
  // 'never' = token tanpa kedaluwarsa (admin tetap login selamanya).
  // Default 10 tahun bila tidak diisi.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '3650d',

  // Perangkat dianggap online bila heartbeat dalam N menit terakhir
  onlineWindowMinutes: Number(process.env.ONLINE_WINDOW_MINUTES || 5),

  // Kunci API khusus untuk request dari aplikasi (opsional, kosong = bebas)
  appApiKey: process.env.APP_API_KEY || '',

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()),
};

module.exports = config;

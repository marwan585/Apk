/**
 * AeroGrid Backend — Entry point
 * Kompatibel:
 *  - cPanel "Setup Node.js App"  → startup file: app.js
 *  - VPS (node app.js / pm2)     → node app.js
 *  - Vercel (serverless)         → lihat api/index.js + vercel.json
 *
 * Endpoint aplikasi : /api/health, /api/devices/register, /api/devices/heartbeat, /api/boosts
 * Dashboard admin   : /            (login: set via .env, default Marwan/Marwan)
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const { createStore } = require('./src/store');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();

// Di belakang proxy (cPanel/Vercel/Nginx) agar req.ip benar
app.set('trust proxy', 1);

// ── Keamanan header ───────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS: aplikasi Android tidak butuh CORS; dashboard same-origin.
// ALLOWED_ORIGINS di .env bisa diisi daftar domain tertentu bila perlu.
const corsOptions =
  config.allowedOrigins.length && config.allowedOrigins[0] !== '*'
    ? { origin: config.allowedOrigins }
    : {};
app.use(cors(corsOptions));

app.use(express.json({ limit: '128kb' }));
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// ── Rate limit ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Terlalu banyak request. Coba lagi nanti.' },
});

// ── Store (Supabase atau fallback memory) ────────────────────────────────
const store = createStore(config);
app.locals.store = store;
app.locals.configRef = config;

// ── Static dashboard admin ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '1h' : 0 }));

// ── API routes (admin dulu agar tidak tertelan /api) ─────────────────────
app.use('/api/admin', adminRoutes);
app.use('/api', apiLimiter, apiRoutes);

// ── 404 API ───────────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint tidak ditemukan.' });
});

// ── Error handler ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'JSON tidak valid.' });
  }
  res.status(500).json({ ok: false, error: 'Kesalahan server internal.' });
});

// ── Start server ──────────────────────────────────────────────────────────
const PORT = config.port;
app
  .listen(PORT, () => {
    console.log('==============================================');
    console.log('  AeroGrid Backend v1.1.0');
    console.log(`  Port      : ${PORT}`);
    console.log(`  Mode      : ${config.env}`);
    console.log(`  Database  : ${store.kind}`);
    console.log(`  Dashboard : http://localhost:${PORT}/`);
    console.log('==============================================');
    if (!config.isProd && !process.env.JWT_SECRET) {
      console.warn('  PERINGATAN: JWT_SECRET belum diset di .env — token admin tidak bertahan setelah restart.');
    }
  })
  .on('error', (e) => {
    console.error('Gagal menjalankan server:', e.message);
    process.exit(1);
  });

module.exports = app;

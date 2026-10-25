/**
 * Route publik API (dipakai aplikasi AeroGrid + login admin).
 *  GET  /api/health
 *  POST /api/auth/login
 *  POST /api/devices/register
 *  POST /api/devices/heartbeat
 *  POST /api/boosts
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

const router = express.Router();

// ── Health ────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const store = req.app.locals.store;
  let db = store.kind;
  try {
    if (store.kind === 'supabase') db = (await store.ping()) ? 'supabase' : 'supabase-error';
  } catch (_) {
    db = 'supabase-error';
  }
  res.json({ ok: true, service: 'aerogrid-backend', version: '1.0.0', db, time: new Date().toISOString() });
});

// ── Login admin ───────────────────────────────────────────────────────────
const loginAttempts = new Map();
router.post('/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const hits = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - hits.t > 15 * 60 * 1000) {
    hits.n = 0;
    hits.t = Date.now();
  }
  if (hits.n >= 15) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
  }
  hits.n += 1;
  loginAttempts.set(ip, hits);

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'username dan password wajib diisi.' });
  }

  const okUser = crypto.timingSafeEqual(
    Buffer.from(username.padEnd(64, '\0').slice(0, 64)),
    Buffer.from(config.adminUsername.padEnd(64, '\0').slice(0, 64))
  );
  const okPass = crypto.timingSafeEqual(
    Buffer.from(password.padEnd(64, '\0').slice(0, 64)),
    Buffer.from(config.adminPassword.padEnd(64, '\0').slice(0, 64))
  );

  if (!(okUser && okPass)) {
    return res.status(401).json({ ok: false, error: 'Username atau password salah.' });
  }
  hits.n = 0;
  const signOpts = config.jwtExpiresIn === 'never' ? {} : { expiresIn: config.jwtExpiresIn };
  const token = jwt.sign({ role: 'admin', u: username }, config.jwtSecret, signOpts);
  res.json({ ok: true, token, expiresIn: config.jwtExpiresIn });
});

// ── Validasi kunci API dari aplikasi (opsional) ───────────────────────────
function appAuth(req, res, next) {
  if (!config.appApiKey) return next(); // tidak diaktifkan
  const key = req.headers['x-aerogrid-key'];
  if (key !== config.appApiKey) {
    return res.status(403).json({ ok: false, error: 'Kunci API aplikasi tidak valid.' });
  }
  return next();
}

// ── Register / sinkron perangkat ──────────────────────────────────────────
router.post('/devices/register', appAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.deviceId || String(body.deviceId).length < 8 || String(body.deviceId).length > 64) {
      return res.status(400).json({ ok: false, error: 'deviceId tidak valid.' });
    }
    const { record, isNew } = await req.app.locals.store.registerDevice(body);
    res.json({
      ok: true,
      deviceId: record.device_id,
      isNew,
      registeredAt: record.last_seen || new Date().toISOString(),
    });
  } catch (e) {
    console.error('[register]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal menyimpan data perangkat.' });
  }
});

// ── Heartbeat ─────────────────────────────────────────────────────────────
router.post('/devices/heartbeat', appAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId || String(deviceId).length > 64) {
      return res.status(400).json({ ok: false, error: 'deviceId tidak valid.' });
    }
    const r = await req.app.locals.store.heartbeat(String(deviceId));
    res.json({ ok: true, known: r.known, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error('[heartbeat]', e.message);
    res.status(500).json({ ok: false, error: 'Heartbeat gagal.' });
  }
});

// ── Log sesi boost ────────────────────────────────────────────────────────
router.post('/boosts', appAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId || String(deviceId).length > 64) {
      return res.status(400).json({ ok: false, error: 'deviceId tidak valid.' });
    }
    await req.app.locals.store.insertBoost(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error('[boosts]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal menyimpan log boost.' });
  }
});

module.exports = router;

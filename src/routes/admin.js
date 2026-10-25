/**
 * Route admin (dilindungi JWT).
 *  GET    /api/admin/overview
 *  GET    /api/admin/devices
 *  GET    /api/admin/devices/frequent
 *  GET    /api/admin/boosts
 *  DELETE /api/admin/devices/:deviceId
 */
const express = require('express');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();
router.use(adminAuth);

router.get('/overview', async (req, res) => {
  try {
    const data = await req.app.locals.store.overview();
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[overview]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal mengambil ringkasan.' });
  }
});

router.get('/devices', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || '').slice(0, 60);
    const status = ['all', 'online', 'offline'].includes(req.query.status)
      ? req.query.status
      : 'all';
    const { rows, total } = await req.app.locals.store.listDevices({ page, limit, search, status });
    const onlineCut = Date.now() - req.app.locals.configRef.onlineWindowMinutes * 60 * 1000;
    const data = rows.map((d) => ({
      ...d,
      is_online: new Date(d.last_seen).getTime() >= onlineCut,
    }));
    res.json({ ok: true, data, total, page, limit });
  } catch (e) {
    console.error('[devices]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal mengambil daftar perangkat.' });
  }
});

router.get('/devices/frequent', async (req, res) => {
  try {
    const rows = await req.app.locals.store.frequentDevices(20);
    const onlineCut = Date.now() - req.app.locals.configRef.onlineWindowMinutes * 60 * 1000;
    const data = rows.map((d, i) => ({
      rank: i + 1,
      device_id: d.device_id,
      model: d.model,
      brand: d.brand,
      heartbeat_count: d.heartbeat_count || 0,
      boost_count: d.boost_count || 0,
      last_seen: d.last_seen,
      is_online: new Date(d.last_seen).getTime() >= onlineCut,
    }));
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[frequent]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal mengambil perangkat sering online.' });
  }
});

router.get('/boosts', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const { rows, total } = await req.app.locals.store.listBoosts({ page, limit });
    res.json({ ok: true, data: rows, total, page, limit });
  } catch (e) {
    console.error('[boosts]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal mengambil log boost.' });
  }
});

router.delete('/devices/:deviceId', async (req, res) => {
  try {
    const id = String(req.params.deviceId).slice(0, 64);
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'deviceId tidak valid.' });
    }
    await req.app.locals.store.deleteDevice(id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[deleteDevice]', e.message);
    res.status(500).json({ ok: false, error: 'Gagal menghapus perangkat.' });
  }
});

module.exports = router;

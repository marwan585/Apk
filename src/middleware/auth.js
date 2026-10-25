/**
 * Middleware autentikasi admin (JWT Bearer).
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token tidak ditemukan. Silakan login.' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== 'admin') throw new Error('role salah');
    req.admin = { username: payload.u };
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token tidak valid atau kedaluwarsa.' });
  }
}

module.exports = { adminAuth };

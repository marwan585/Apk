/**
 * Vercel serverless adapter — semua request diarahkan ke Express app ini.
 * Konfigurasi route ada di vercel.json.
 */
const app = require('../app');

module.exports = app;

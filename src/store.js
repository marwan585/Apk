/**
 * AeroGrid Backend — Lapisan penyimpanan data
 *
 * Dua implementasi dengan kontrak yang sama:
 *  1. SupabaseStore : dipakai bila SUPABASE_URL + SUPABASE_SERVICE_KEY tersedia (produksi).
 *  2. MemoryStore   : fallback otomatis agar backend tetap jalan sebelum Supabase dikonfigurasi.
 *
 * Tabel Supabase yang dipakai (lihat database/schema.sql):
 *  - devices         : data perangkat + heartbeat
 *  - boost_sessions  : log sesi boost per perangkat
 *  - v_top_games     : view agregasi game terpopuler
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

function nowIso() {
  return new Date().toISOString();
}

function cutoffIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function sanitizeDevice(input = {}) {
  const str = (v, max = 120) =>
    v === undefined || v === null ? null : String(v).slice(0, max);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    device_id: str(input.deviceId, 64),
    model: str(input.model, 80),
    brand: str(input.brand, 80),
    manufacturer: str(input.manufacturer, 80),
    android_version: str(input.androidVersion, 20),
    sdk_int: num(input.sdkInt),
    processor: str(input.processor, 120),
    abi: str(input.abi, 40),
    ram_total_mb: num(input.ramTotalMb),
    storage_total_gb: num(input.storageTotalGb),
    refresh_rate: num(input.refreshRate),
    is_rooted: input.isRooted === true,
    app_version: str(input.appVersion, 20),
  };
}

class SupabaseStore {
  constructor(url, key) {
    this.kind = 'supabase';
    this.client = createClient(url, key, { auth: { persistSession: false } });
  }

  async ping() {
    const { error } = await this.client.from('devices').select('id', { count: 'exact', head: true });
    return !error;
  }

  /// Verifikasi struktur tabel di Supabase saat server start.
  /// Mencetak instruksi jelas bila schema.sql belum dijalankan.
  async verifySchema() {
    const { error } = await this.client.from('devices').select('id').limit(1);
    if (!error) {
      console.log('[supabase] OK — tabel devices siap. Semua data tersimpan di Supabase.');
      return true;
    }
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation')) {
      console.error('==============================================');
      console.error('  SUPABASE: TABEL BELUM ADA!');
      console.error('  Jalankan database/schema.sql di Supabase →');
      console.error('  SQL Editor → Paste → Run, lalu restart server.');
      console.error('  Detail: ' + error.message);
      console.error('==============================================');
    } else if (
      msg.includes('permission') || msg.includes('row-level') || msg.includes('rls')
    ) {
      console.error('[supabase] AKSES DITOLAK (RLS). Pastikan memakai SERVICE_ROLE key\n  (SUPABASE_SERVICE_KEY), bukan anon key. Detail: ' + error.message);
    } else {
      console.warn('[supabase] Peringatan koneksi: ' + error.message);
    }
    return false;
  }

  async registerDevice(input) {
    const clean = sanitizeDevice(input);
    if (!clean.device_id) throw new Error('deviceId wajib ada');

    const { data: existing } = await this.client
      .from('devices')
      .select('id, first_seen, heartbeat_count, boost_count')
      .eq('device_id', clean.device_id)
      .maybeSingle();

    const row = { ...clean, last_seen: nowIso(), updated_at: nowIso() };
    if (existing) {
      row.heartbeat_count = existing.heartbeat_count || 1;
      row.boost_count = existing.boost_count || 0;
    }

    const { data, error } = await this.client
      .from('devices')
      .upsert(row, { onConflict: 'device_id' })
      .select()
      .single();
    if (error) throw error;
    return { record: data, isNew: !existing };
  }

  async heartbeat(deviceId) {
    const { data: existing } = await this.client
      .from('devices')
      .select('id, model, brand')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (existing) {
      const { error } = await this.client.rpc('aerogrid_heartbeat', { p_device_id: deviceId });
      if (error) {
        // Fallback tanpa RPC
        const { error: upErr } = await this.client
          .from('devices')
          .update({ last_seen: nowIso(), updated_at: nowIso() })
          .eq('device_id', deviceId);
        if (upErr) throw upErr;
      }
      return { known: true };
    }
    // Perangkat belum terdaftar → daftarkan minimal
    await this.registerDevice({ deviceId, model: 'Unknown Device' });
    return { known: false };
  }

  async insertBoost(input) {
    const str = (v, max = 120) => (v ? String(v).slice(0, max) : null);
    const row = {
      device_id: String(input.deviceId).slice(0, 64),
      game_package: str(input.gamePackage),
      game_name: str(input.gameName),
      ram_freed_mb: Number.isFinite(Number(input.ramFreedMb)) ? Math.round(Number(input.ramFreedMb)) : null,
      temperature_c: Number.isFinite(Number(input.temperatureC)) ? Number(input.temperatureC) : null,
      duration_seconds: Number.isFinite(Number(input.durationSeconds)) ? Math.round(Number(input.durationSeconds)) : null,
      features_used: Array.isArray(input.features) ? input.features.slice(0, 16).map((f) => String(f).slice(0, 40)) : [],
      created_at: nowIso(),
    };
    const { error } = await this.client.from('boost_sessions').insert(row);
    if (error) throw error;
    return { ok: true };
  }

  async overview() {
    const onlineCut = cutoffIso(config.onlineWindowMinutes);
    const dayAgo = cutoffIso(24 * 60);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const c = async (table, extra) => {
      let q = this.client.from(table).select('id', { count: 'exact', head: true });
      if (extra) q = q[extra.op](extra.col, extra.val);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    };

    const [totalDevices, onlineNow, online24h, totalBoosts, boostsToday] = await Promise.all([
      c('devices'),
      c('devices', { op: 'gt', col: 'last_seen', val: onlineCut }),
      c('devices', { op: 'gt', col: 'last_seen', val: dayAgo }),
      c('boost_sessions'),
      c('boost_sessions', { op: 'gte', col: 'created_at', val: todayStart.toISOString() }),
    ]);

    let topGames = [];
    const { data: vg, error: vgErr } = await this.client
      .from('v_top_games')
      .select('game_name, total')
      .limit(5);
    if (!vgErr && Array.isArray(vg)) {
      topGames = vg;
    } else {
      // Fallback bila view belum dibuat: agregasi dari 500 boost terakhir
      const { data: recent } = await this.client
        .from('boost_sessions')
        .select('game_name')
        .order('created_at', { ascending: false })
        .limit(500);
      const map = new Map();
      (recent || []).forEach((r) => {
        if (!r.game_name) return;
        map.set(r.game_name, (map.get(r.game_name) || 0) + 1);
      });
      topGames = [...map.entries()]
        .map(([game_name, total]) => ({ game_name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    }

    return {
      totalDevices,
      onlineNow,
      online24h,
      totalBoosts,
      boostsToday,
      topGames,
      onlineWindowMinutes: config.onlineWindowMinutes,
    };
  }

  async listDevices({ page = 1, limit = 20, search = '', status = 'all' }) {
    let q = this.client.from('devices').select('*', { count: 'exact' });
    if (search) {
      const s = search.replace(/[%,()]/g, '');
      q = q.or(`model.ilike.%${s}%,brand.ilike.%${s}%,device_id.ilike.%${s}%,processor.ilike.%${s}%`);
    }
    if (status === 'online') q = q.gt('last_seen', cutoffIso(config.onlineWindowMinutes));
    if (status === 'offline') q = q.lt('last_seen', cutoffIso(config.onlineWindowMinutes));

    const from = (page - 1) * limit;
    const { data, count, error } = await q
      .order('last_seen', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    return { rows: data || [], total: count || 0 };
  }

  async frequentDevices(limit = 20) {
    const { data, error } = await this.client
      .from('devices')
      .select('*')
      .order('heartbeat_count', { ascending: false })
      .order('last_seen', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async listBoosts({ page = 1, limit = 20 }) {
    const from = (page - 1) * limit;
    const { data, count, error } = await this.client
      .from('boost_sessions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    return { rows: data || [], total: count || 0 };
  }

  async deleteDevice(deviceId) {
    const { error } = await this.client.from('devices').delete().eq('device_id', deviceId);
    if (error) throw error;
    return { ok: true };
  }
}

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.devices = new Map(); // device_id -> record
    this.boosts = [];
  }

  async ping() {
    return true;
  }

  async registerDevice(input) {
    const clean = sanitizeDevice(input);
    if (!clean.device_id) throw new Error('deviceId wajib ada');
    const isNew = !this.devices.has(clean.device_id);
    const prev = this.devices.get(clean.device_id) || {};
    const record = {
      id: prev.id || `mem-${clean.device_id}`,
      ...clean,
      heartbeat_count: prev.heartbeat_count || 1,
      boost_count: prev.boost_count || 0,
      first_seen: prev.first_seen || nowIso(),
      last_seen: nowIso(),
      created_at: prev.created_at || nowIso(),
      updated_at: nowIso(),
    };
    this.devices.set(clean.device_id, record);
    return { record, isNew };
  }

  async heartbeat(deviceId) {
    const existing = this.devices.get(deviceId);
    if (existing) {
      existing.last_seen = nowIso();
      existing.heartbeat_count = (existing.heartbeat_count || 0) + 1;
      return { known: true };
    }
    await this.registerDevice({ deviceId, model: 'Unknown Device' });
    return { known: false };
  }

  async insertBoost(input) {
    const dev = this.devices.get(input.deviceId);
    this.boosts.push({
      id: `boost-${this.boosts.length + 1}`,
      device_id: String(input.deviceId).slice(0, 64),
      game_package: input.gamePackage || null,
      game_name: input.gameName || null,
      ram_freed_mb: Number.isFinite(Number(input.ramFreedMb)) ? Math.round(Number(input.ramFreedMb)) : null,
      temperature_c: Number.isFinite(Number(input.temperatureC)) ? Number(input.temperatureC) : null,
      duration_seconds: Number.isFinite(Number(input.durationSeconds)) ? Math.round(Number(input.durationSeconds)) : null,
      features_used: Array.isArray(input.features) ? input.features.map(String) : [],
      created_at: nowIso(),
    });
    if (dev) dev.boost_count = (dev.boost_count || 0) + 1;
    if (this.boosts.length > 5000) this.boosts.shift();
    return { ok: true };
  }

  async overview() {
    const onlineCut = new Date(Date.now() - config.onlineWindowMinutes * 60 * 1000).getTime();
    const devices = [...this.devices.values()];
    const boosts = this.boosts;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const map = new Map();
    boosts.forEach((b) => {
      if (!b.game_name) return;
      map.set(b.game_name, (map.get(b.game_name) || 0) + 1);
    });
    return {
      totalDevices: devices.length,
      onlineNow: devices.filter((d) => new Date(d.last_seen).getTime() >= onlineCut).length,
      online24h: devices.filter((d) => new Date(d.last_seen).getTime() >= Date.now() - 86400000).length,
      totalBoosts: boosts.length,
      boostsToday: boosts.filter((b) => new Date(b.created_at) >= todayStart).length,
      topGames: [...map.entries()]
        .map(([game_name, total]) => ({ game_name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5),
      onlineWindowMinutes: config.onlineWindowMinutes,
    };
  }

  async listDevices({ page = 1, limit = 20, search = '', status = 'all' }) {
    const onlineCut = new Date(Date.now() - config.onlineWindowMinutes * 60 * 1000).getTime();
    let rows = [...this.devices.values()].sort(
      (a, b) => new Date(b.last_seen) - new Date(a.last_seen)
    );
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((d) =>
        [d.model, d.brand, d.device_id, d.processor].some((v) => v && String(v).toLowerCase().includes(s))
      );
    }
    if (status === 'online') rows = rows.filter((d) => new Date(d.last_seen).getTime() >= onlineCut);
    if (status === 'offline') rows = rows.filter((d) => new Date(d.last_seen).getTime() < onlineCut);
    const total = rows.length;
    return { rows: rows.slice((page - 1) * limit, page * limit), total };
  }

  async frequentDevices(limit = 20) {
    return [...this.devices.values()]
      .sort((a, b) => (b.heartbeat_count || 0) - (a.heartbeat_count || 0))
      .slice(0, limit);
  }

  async listBoosts({ page = 1, limit = 20 }) {
    const rows = [...this.boosts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: rows.slice((page - 1) * limit, page * limit), total: rows.length };
  }

  async deleteDevice(deviceId) {
    this.devices.delete(deviceId);
    this.boosts = this.boosts.filter((b) => b.device_id !== deviceId);
    return { ok: true };
  }
}

function createStore(cfg = config) {
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    console.log('[store] Mode: SUPABASE (' + cfg.supabaseUrl + ')');
    const store = new SupabaseStore(cfg.supabaseUrl, cfg.supabaseKey);
    // Verifikasi struktur database di latar belakang saat boot
    store.verifySchema().catch(() => {});
    return store;
  }
  console.error('==============================================');
  console.error('  PERINGATAN: SUPABASE TIDAK AKTIF — mode MEMORY!');
  console.error('  Data perangkat & log boost TIDAK AKAN TERSIMPAN permanen.');
  console.error('  Cara memperbaiki (wajib untuk produksi):');
  console.error('   1. Buat project di supabase.com');
  console.error('   2. Jalankan database/schema.sql di SQL Editor Supabase');
  console.error('   3. Isi SUPABASE_URL dan SUPABASE_SERVICE_KEY di file .env');
  console.error('   4. Restart server (app.js)');
  console.error('==============================================');
  return new MemoryStore();
}

module.exports = { createStore, SupabaseStore, MemoryStore };

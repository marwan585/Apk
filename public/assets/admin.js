/* ============================================================
   AeroGrid Admin Dashboard — Logika frontend (vanilla JS)
   ============================================================ */
(function () {
  'use strict';

  var TOKEN_KEY = 'aerogrid_admin_token';
  var $ = function (id) { return document.getElementById(id); };
  // localStorage → sesi admin TIDAK hilang walau browser ditutup/restart.
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var state = {
    tab: 'overview',
    devPage: 1,
    devTotalPages: 1,
    boostPage: 1,
    boostTotalPages: 1,
    timer: null,
    db: '…',
  };

  /* ---------- util ---------- */
  function fmt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('id-ID');
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return Math.floor(s) + ' detik lalu';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  }
  function shortId(id) {
    return id ? (String(id).length > 14 ? String(id).slice(0, 14) + '…' : String(id)) : '—';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast hidden'; }, 2600);
  }
  function badge(on) {
    return on
      ? '<span class="badge badge-green">ONLINE</span>'
      : '<span class="badge badge-gray">offline</span>';
  }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      opts.headers || {}
    );
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && token) {
          logout(true);
          throw new Error('Sesi berakhir. Silakan login ulang.');
        }
        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /* ---------- AUTH ---------- */
  function showLogin() {
    $('view-login').classList.remove('hidden');
    $('view-dash').classList.add('hidden');
  }
  function showDash() {
    $('view-login').classList.add('hidden');
    $('view-dash').classList.remove('hidden');
    refreshAll();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(refreshAll, 30000); // auto refresh 30 detik
  }
  function logout(silent) {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    if (state.timer) clearInterval(state.timer);
    showLogin();
    if (!silent) toast('Anda telah keluar.');
  }

  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('btn-login');
    var err = $('login-err');
    btn.disabled = true;
    btn.textContent = 'Memeriksa…';
    err.classList.add('hidden');
    api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('in-user').value.trim(), password: $('in-pass').value }),
    })
      .then(function (j) {
        token = j.token;
        localStorage.setItem(TOKEN_KEY, token);
        showDash();
        toast('Login berhasil. Selamat datang, Admin!');
      })
      .catch(function (ex) {
        err.textContent = ex.message || 'Login gagal.';
        err.classList.remove('hidden');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Masuk Dashboard';
        $('in-pass').value = '';
      });
  });
  $('btn-logout').addEventListener('click', function () { logout(false); });

  /* ---------- TABS ---------- */
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      state.tab = b.dataset.tab;
      document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.add('hidden'); });
      $('tab-' + state.tab).classList.remove('hidden');
      refreshAll();
    });
  });

  /* ---------- REFRESH SEMUA ---------- */
  function refreshAll() {
    if (!token) return;
    api('/api/health').then(function (j) {
      state.db = j.db || '?';
      var b = $('db-badge');
      b.textContent = 'DB: ' + state.db;
      b.className = 'badge ' + (state.db === 'supabase' ? 'badge-green' : state.db === 'memory' ? 'badge-cyan' : 'badge-red');
      // Banner: data belum tersimpan di Supabase
      var w = $('db-warn');
      if (w) {
        if (state.db === 'supabase') {
          w.classList.add('hidden');
        } else {
          w.classList.remove('hidden');
          w.innerHTML = state.db === 'memory'
            ? '<b>Data belum tersimpan di Supabase!</b> Isi <code>SUPABASE_URL</code> &amp; <code>SUPABASE_SERVICE_KEY</code> di file <code>.env</code> lalu restart server, dan jalankan <code>database/schema.sql</code> di SQL Editor Supabase.'
            : '<b>Koneksi Supabase bermasalah!</b> Periksa kredensial di <code>.env</code> dan pastikan <code>database/schema.sql</code> sudah dijalankan.';
        }
      }
    }).catch(function () {});
    if (state.tab === 'overview') loadOverview();
    if (state.tab === 'devices') loadDevices();
    if (state.tab === 'frequent') loadFrequent();
    if (state.tab === 'boosts') loadBoosts();
  }
  $('btn-refresh').addEventListener('click', function () { refreshAll(); toast('Data dimuat ulang.'); });

  /* ---------- OVERVIEW ---------- */
  function loadOverview() {
    api('/api/admin/overview')
      .then(function (j) {
        var d = j.data;
        var cards = [
          { l: 'Total Perangkat', v: fmt(d.totalDevices), s: 'terdaftar di database' },
          { l: 'Online Saat Ini', v: fmt(d.onlineNow), s: 'heartbeat ≤ ' + d.onlineWindowMinutes + ' menit' },
          { l: 'Online 24 Jam', v: fmt(d.online24h), s: 'perangkat aktif hari ini' },
          { l: 'Total Boost', v: fmt(d.totalBoosts), s: 'seluruh waktu' },
          { l: 'Boost Hari Ini', v: fmt(d.boostsToday), s: 'sejak 00:00 UTC' },
        ];
        $('ov-cards').innerHTML = cards.map(function (c) {
          return '<div class="stat-card"><div class="label">' + esc(c.l) + '</div>' +
            '<div class="value">' + c.v + '</div><div class="sub">' + esc(c.s) + '</div></div>';
        }).join('');

        var max = Math.max.apply(null, [1].concat((d.topGames || []).map(function (g) { return g.total; })));
        $('ov-games').innerHTML = (d.topGames && d.topGames.length)
          ? d.topGames.map(function (g, i) {
              var pct = Math.round((g.total / max) * 100);
              return '<div class="rank-item"><div class="rank-num">' + (i + 1) + '</div>' +
                '<div class="rank-main"><strong>' + esc(g.game_name) + '</strong>' +
                '<span class="muted">' + fmt(g.total) + ' sesi boost</span></div>' +
                '<div class="rank-bar"><div style="width:' + pct + '%"></div></div>' +
                '<div class="rank-val">' + fmt(g.total) + '</div></div>';
            }).join('')
          : '<p class="empty">Belum ada data boost.</p>';
      })
      .catch(function (ex) { toast(ex.message, true); });
  }

  /* ---------- DEVICES ---------- */
  function loadDevices() {
    var search = $('dev-search').value.trim();
    var status = $('dev-status').value;
    api('/api/admin/devices?page=' + state.devPage + '&limit=15&search=' + encodeURIComponent(search) + '&status=' + status)
      .then(function (j) {
        state.devTotalPages = Math.max(1, Math.ceil(j.total / 15));
        $('dev-page-label').textContent = j.page + ' / ' + state.devTotalPages;
        $('dev-empty').classList.toggle('hidden', j.data.length > 0);
        $('dev-tbody').innerHTML = j.data.map(function (d) {
          return '<tr>' +
            '<td><strong>' + esc(d.model || '—') + '</strong><br><span class="mono">' + esc(shortId(d.device_id)) + '</span></td>' +
            '<td>' + esc(d.brand || '—') + '</td>' +
            '<td>' + esc(d.android_version || '—') + (d.sdk_int ? ' (API ' + d.sdk_int + ')' : '') + '</td>' +
            '<td>' + esc(d.processor || '—') + '</td>' +
            '<td>' + (d.ram_total_mb ? (d.ram_total_mb / 1024).toFixed(1) + ' GB' : '—') + '</td>' +
            '<td>' + (d.is_rooted ? '<span class="badge badge-cyan">ROOT</span>' : '<span class="badge badge-gray">no</span>') + '</td>' +
            '<td>' + fmt(d.boost_count) + '</td>' +
            '<td>' + fmt(d.heartbeat_count) + '</td>' +
            '<td>' + badge(d.is_online) + '<br><span class="muted" style="font-size:11px">' + timeAgo(d.last_seen) + '</span></td>' +
            '<td><button class="btn-danger-ghost" data-del="' + esc(d.device_id) + '">Hapus</button></td>' +
            '</tr>';
        }).join('');
        document.querySelectorAll('#dev-tbody [data-del]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('Hapus perangkat ini beserta log boost-nya?')) return;
            api('/api/admin/devices/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' })
              .then(function () { toast('Perangkat dihapus.'); loadDevices(); })
              .catch(function (ex) { toast(ex.message, true); });
          });
        });
      })
      .catch(function (ex) { toast(ex.message, true); });
  }
  $('dev-search').addEventListener('input', debounce(function () { state.devPage = 1; loadDevices(); }, 350));
  $('dev-status').addEventListener('change', function () { state.devPage = 1; loadDevices(); });
  $('dev-prev').addEventListener('click', function () { if (state.devPage > 1) { state.devPage--; loadDevices(); } });
  $('dev-next').addEventListener('click', function () { if (state.devPage < state.devTotalPages) { state.devPage++; loadDevices(); } });

  /* ---------- FREQUENT ---------- */
  function loadFrequent() {
    api('/api/admin/devices/frequent')
      .then(function (j) {
        var max = Math.max.apply(null, [1].concat(j.data.map(function (d) { return d.heartbeat_count || 0; })));
        $('fq-list').innerHTML = j.data.length
          ? j.data.map(function (d) {
              var pct = Math.round(((d.heartbeat_count || 0) / max) * 100);
              return '<div class="rank-item"><div class="rank-num">#' + d.rank + '</div>' +
                '<div class="rank-main"><strong>' + esc(d.model || d.device_id) + ' — ' + esc(d.brand || '') + '</strong>' +
                '<span class="muted mono">' + esc(shortId(d.device_id)) + ' • ' + fmt(d.boost_count) + ' boost • ' + timeAgo(d.last_seen) + '</span></div>' +
                (d.is_online ? badge(true) : badge(false)) +
                '<div class="rank-bar"><div style="width:' + pct + '%"></div></div>' +
                '<div class="rank-val">' + fmt(d.heartbeat_count) + '</div></div>';
            }).join('')
          : '<p class="empty">Belum ada perangkat.</p>';
      })
      .catch(function (ex) { toast(ex.message, true); });
  }

  /* ---------- BOOSTS ---------- */
  function loadBoosts() {
    api('/api/admin/boosts?page=' + state.boostPage + '&limit=15')
      .then(function (j) {
        state.boostTotalPages = Math.max(1, Math.ceil(j.total / 15));
        $('boost-page-label').textContent = j.page + ' / ' + state.boostTotalPages;
        $('boost-total-label').textContent = 'Total ' + fmt(j.total) + ' sesi boost';
        $('boost-empty').classList.toggle('hidden', j.data.length > 0);
        $('boost-tbody').innerHTML = j.data.map(function (b) {
          var feats = Array.isArray(b.features_used) ? b.features_used.join(', ') : '';
          return '<tr>' +
            '<td class="mono">' + new Date(b.created_at).toLocaleString('id-ID') + '</td>' +
            '<td><strong>' + esc(b.game_name || '—') + '</strong><br><span class="mono" style="font-size:11px">' + esc(b.game_package || '') + '</span></td>' +
            '<td class="mono">' + esc(shortId(b.device_id)) + '</td>' +
            '<td>' + (b.ram_freed_mb !== null && b.ram_freed_mb !== undefined ? fmt(b.ram_freed_mb) + ' MB' : '—') + '</td>' +
            '<td>' + (b.temperature_c !== null && b.temperature_c !== undefined ? b.temperature_c + ' °C' : '—') + '</td>' +
            '<td>' + (b.duration_seconds ? b.duration_seconds + ' dtk' : '—') + '</td>' +
            '<td>' + esc(feats || '—') + '</td>' +
            '</tr>';
        }).join('');
      })
      .catch(function (ex) { toast(ex.message, true); });
  }
  $('boost-prev').addEventListener('click', function () { if (state.boostPage > 1) { state.boostPage--; loadBoosts(); } });
  $('boost-next').addEventListener('click', function () { if (state.boostPage < state.boostTotalPages) { state.boostPage++; loadBoosts(); } });

  /* ---------- util: debounce ---------- */
  function debounce(fn, ms) {
    var h;
    return function () {
      clearTimeout(h);
      h = setTimeout(fn, ms);
    };
  }

  /* ---------- INIT ---------- */
  if (token) showDash(); else showLogin();
})();

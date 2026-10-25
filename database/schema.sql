-- ============================================================================
--  AEROGRID — SKEMA DATABASE SUPABASE v1.0
--  ---------------------------------------------------------------------------
--  Cara pakai:
--    1. Buka https://supabase.com → project Anda
--    2. Menu  SQL Editor  →  New query
--    3. Tempel seluruh isi file ini → Run
--
--  Tabel yang dibuat:
--    - devices          : daftar perangkat yang pernah memasang AeroGrid
--    - boost_sessions   : log sesi boost (game, RAM dibebaskan, suhu, dll)
--    - v_top_games      : view agregasi game yang paling sering di-boost
--
--  Keamanan:
--    - Row Level Security (RLS) DIAKTIFKAN tanpa policy publik
--      → hanya backend (service_role key) yang bisa membaca/menulis.
--    - Kunci anon (anon key) TIDAK memiliki akses apa pun.
--    - Aplikasi TIDAK PERNAH menghubungi Supabase langsung;
--      semua request melewati backend Node.js di https://data.cloudnet.web.id
-- ============================================================================

-- Ekstensi UUID (biasanya sudah aktif di Supabase)
create extension if not exists pgcrypto;

-- ============================================================================
-- 1. TABEL: devices
-- ============================================================================
create table if not exists public.devices (
  id                 uuid primary key default gen_random_uuid(),
  device_id          text        not null unique,
  model              text,
  brand              text,
  manufacturer       text,
  android_version    text,
  sdk_int            integer,
  processor          text,
  abi                text,
  ram_total_mb       integer,
  storage_total_gb   numeric(10, 2),
  refresh_rate       numeric(6, 2),
  is_rooted          boolean     default false,
  app_version        text,
  heartbeat_count    bigint      default 1,
  boost_count        integer     default 0,
  first_seen         timestamptz default now(),
  last_seen          timestamptz default now(),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

comment on table public.devices is 'Perangkat pengguna AeroGrid — 1 device_id unik per perangkat';

create index if not exists idx_devices_last_seen     on public.devices (last_seen desc);
create index if not exists idx_devices_heartbeat     on public.devices (heartbeat_count desc);
create index if not exists idx_devices_device_id     on public.devices (device_id);

-- ============================================================================
-- 2. TABEL: boost_sessions
-- ============================================================================
create table if not exists public.boost_sessions (
  id                uuid primary key default gen_random_uuid(),
  device_id         text        not null references public.devices (device_id) on delete cascade,
  game_package      text,
  game_name         text,
  ram_freed_mb      integer,
  temperature_c     numeric(5, 1),
  duration_seconds  integer,
  features_used     jsonb       default '[]'::jsonb,
  created_at        timestamptz default now()
);

comment on table public.boost_sessions is 'Log sesi boost per perangkat';

create index if not exists idx_boosts_device    on public.boost_sessions (device_id);
create index if not exists idx_boosts_created   on public.boost_sessions (created_at desc);
create index if not exists idx_boosts_game      on public.boost_sessions (game_package);

-- ============================================================================
-- 3. FUNGSI & TRIGGER
-- ============================================================================

-- updated_at otomatis
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_devices_updated_at on public.devices;
create trigger trg_devices_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

-- Heartbeat atomik: last_seen = now(), heartbeat_count = heartbeat_count + 1
create or replace function public.aerogrid_heartbeat(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.devices
     set last_seen       = now(),
         updated_at      = now(),
         heartbeat_count = coalesce(heartbeat_count, 0) + 1
   where device_id = p_device_id;
end;
$$;

-- Setiap sesi boost baru menaikkan boost_count perangkat
create or replace function public.on_boost_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.devices
     set boost_count = coalesce(boost_count, 0) + 1
   where device_id = new.device_id;
  return new;
end;
$$;

drop trigger if exists trg_boost_insert on public.boost_sessions;
create trigger trg_boost_insert
  after insert on public.boost_sessions
  for each row execute function public.on_boost_insert();

-- ============================================================================
-- 4. VIEW: game terpopuler (untuk dashboard admin)
-- ============================================================================
create or replace view public.v_top_games as
  select game_name,
         count(*)    as total,
         max(created_at) as last_played
    from public.boost_sessions
   where game_name is not null
     and game_name <> ''
   group by game_name
   order by total desc;

-- ============================================================================
-- 5. KEAMANAN: RLS TERKUNCI (penting!)
-- ----------------------------------------------------------------------------
-- RLS diaktifkan TANPA policy untuk anon/authenticated.
-- Artinya:
--   * anon key           → TIDAK BISA select/insert/update/delete apa pun
--   * client langsung    → TIDAK BISA menembus database
--   * backend (service_role) → SATU-SATUNYA yang punya akses penuh
-- ============================================================================

alter table public.devices        enable row level security;
alter table public.boost_sessions enable row level security;
alter table public.devices        force row level security;
alter table public.boost_sessions force row level security;

-- Cabut semua hak dari peran publik (anon & authenticated)
revoke all on public.devices        from anon;
revoke all on public.devices        from authenticated;
revoke all on public.boost_sessions from anon;
revoke all on public.boost_sessions from authenticated;
revoke all on public.v_top_games    from anon;
revoke all on public.v_top_games    from authenticated;

-- (Tidak ada create policy — sengaja dikosongkan agar database terkunci penuh)

-- ============================================================================
-- 6. (OPSIONAL) DUMMY DATA untuk menguji dashboard
--    Hapus tanda komentar blok bawah bila ingin mencoba.
-- ============================================================================
/*
insert into public.devices (device_id, model, brand, manufacturer, android_version, sdk_int,
                            processor, abi, ram_total_mb, storage_total_gb, refresh_rate, is_rooted, app_version)
values
  ('demo-device-0001', 'Galaxy A54 5G',   'samsung', 'Samsung', '14', 34, 'Exynos 1380',        'arm64-v8a', 8192,  128, 120, false, '1.0.0'),
  ('demo-device-0002', 'POCO X6 Pro',     'POCO',    'Xiaomi',  '14', 34, 'Dimensity 8300-Ultra','arm64-v8a', 12288, 512, 120, true,  '1.0.0'),
  ('demo-device-0003', 'Redmi Note 12',   'Redmi',   'Xiaomi',  '13', 33, 'Snapdragon 685',     'arm64-v8a', 6144,  128, 120, false, '1.0.0')
on conflict (device_id) do nothing;

insert into public.boost_sessions (device_id, game_package, game_name, ram_freed_mb, temperature_c, duration_seconds, features_used)
values
  ('demo-device-0001', 'com.mobile.legends', 'Mobile Legends', 742, 38.5, 45,  '["ram_purge","thermal","network"]'),
  ('demo-device-0002', 'com.dts.freefireth',  'Free Fire',      512, 36.2, 30,  '["ram_purge","refresh_lock"]'),
  ('demo-device-0001', 'com.tencent.ig',      'PUBG Mobile',    980, 40.1, 52,  '["ram_purge","thermal","dnd"]')
on conflict do nothing;
*/

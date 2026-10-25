-- Optional schema preparation for per-server connection details and persistent mod/player plans.
-- Run in Supabase SQL Editor only after confirming public.minecraft_servers exists.
alter table public.minecraft_servers
  add column if not exists java_host text,
  add column if not exists java_port integer not null default 25565,
  add column if not exists bedrock_host text,
  add column if not exists bedrock_port integer not null default 19132;

create table if not exists public.minecraft_server_mods (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.minecraft_servers(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

create table if not exists public.minecraft_server_players (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.minecraft_servers(id) on delete cascade,
  player_name text not null,
  is_operator boolean not null default false,
  created_at timestamptz not null default now(),
  unique (server_id, player_name)
);

alter table public.minecraft_server_mods enable row level security;
alter table public.minecraft_server_players enable row level security;

-- Ownership checks use the owner field from minecraft_servers.
drop policy if exists "Owners manage mods for their servers" on public.minecraft_server_mods;
create policy "Owners manage mods for their servers"
on public.minecraft_server_mods for all to authenticated
using (
  exists (
    select 1 from public.minecraft_servers s
    where s.id = minecraft_server_mods.server_id and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.minecraft_servers s
    where s.id = minecraft_server_mods.server_id and s.user_id = auth.uid()
  )
);

drop policy if exists "Owners manage players for their servers" on public.minecraft_server_players;
create policy "Owners manage players for their servers"
on public.minecraft_server_players for all to authenticated
using (
  exists (
    select 1 from public.minecraft_servers s
    where s.id = minecraft_server_players.server_id and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.minecraft_servers s
    where s.id = minecraft_server_players.server_id and s.user_id = auth.uid()
  )
);

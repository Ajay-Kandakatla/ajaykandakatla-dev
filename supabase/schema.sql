-- Schema for post views + likes counters used by src/components/PostStats.astro.
-- Run once in Supabase SQL Editor after creating your project.

create table if not exists post_stats (
  slug       text primary key,
  views      bigint not null default 0,
  likes      bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Public reads (anyone can see counts). RLS controls write paths separately.
alter table post_stats enable row level security;

drop policy if exists "Anyone can read post_stats" on post_stats;
create policy "Anyone can read post_stats"
  on post_stats for select
  using (true);

-- RPC functions: the only way anon clients can mutate the table.
-- This gives us tight control over what increments are allowed
-- (e.g. only +1, only on one column at a time, no arbitrary updates).

create or replace function increment_view(post_slug text)
returns post_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result post_stats;
begin
  insert into post_stats (slug, views, updated_at)
  values (post_slug, 1, now())
  on conflict (slug) do update
    set views = post_stats.views + 1,
        updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function increment_like(post_slug text)
returns post_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result post_stats;
begin
  insert into post_stats (slug, likes, updated_at)
  values (post_slug, 1, now())
  on conflict (slug) do update
    set likes = post_stats.likes + 1,
        updated_at = now()
  returning * into result;
  return result;
end;
$$;

-- Grant execute on the RPC functions to the anon role
grant execute on function increment_view(text) to anon;
grant execute on function increment_like(text) to anon;

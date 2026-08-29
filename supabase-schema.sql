-- ═══════════════════════════════════════════════════════════════
-- NINJAGO MEDIA — community star ratings
-- Run this once in Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════

-- One row per (show, browser). voter_id is a random UUID the site
-- generates itself and stores in localStorage — no login required.
create table if not exists show_ratings (
  id          uuid primary key default gen_random_uuid(),
  show_id     text not null,
  voter_id    text not null,
  stars       smallint not null check (stars between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (show_id, voter_id)
);

-- Keep updated_at current on re-votes.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists show_ratings_set_updated_at on show_ratings;
create trigger show_ratings_set_updated_at
  before update on show_ratings
  for each row execute function set_updated_at();

-- Row Level Security: this is a public, no-login site, so reads and
-- writes are open to anyone holding the anon key (by design — that's
-- what the anon key is for). There's no way to verify who's behind a
-- given voter_id without adding real auth, so treat this as a
-- community-honor-system rating, not a fraud-proof one.
alter table show_ratings enable row level security;

drop policy if exists "public read"        on show_ratings;
drop policy if exists "public insert"      on show_ratings;
drop policy if exists "public update own"  on show_ratings;

create policy "public read"   on show_ratings for select using (true);
create policy "public insert" on show_ratings for insert with check (true);
create policy "public update own" on show_ratings for update using (true) with check (true);

-- Aggregated view the site reads from — one row per show with the
-- average and vote count, so the client never has to fetch or compute
-- over raw per-voter rows.
create or replace view show_rating_stats as
select
  show_id,
  round(avg(stars)::numeric, 2) as avg_stars,
  count(*)::int                 as votes
from show_ratings
group by show_id;

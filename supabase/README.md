# Supabase setup for post views + likes

The blog uses Supabase as the backing store for per-post view and like counters.
Free tier is more than enough for personal-blog scale.

## One-time setup

1. **Create a Supabase project** at https://supabase.com — pick the free tier, any region.
2. **Run the schema**: SQL Editor → New query → paste the contents of [`schema.sql`](./schema.sql) → Run. This creates the `post_stats` table, RLS policies, and the `increment_view` / `increment_like` RPC functions that anonymous clients can call.
3. **Grab two values** from Project Settings → API:
   - **Project URL** (looks like `https://abcd1234.supabase.co`) → goes into `PUBLIC_SUPABASE_URL`
   - **anon / public key** (long JWT) → goes into `PUBLIC_SUPABASE_ANON`
4. **Set them in Vercel**: Project Settings → Environment Variables → add both for Production. Redeploy.

That's it. View counts start incrementing on the next page load.

## Why anon key is safe to expose

The `PUBLIC_` prefix means Astro inlines these values into the static build, so they end up visible in the browser. That's intentional — the anon key has no write access to the table directly (RLS blocks it). The only mutations possible are through the `increment_view` and `increment_like` RPC functions, which are hardcoded to add exactly +1 to one column. An attacker armed with the anon key can spam views/likes on individual posts; they cannot read other tables, delete data, or modify the schema.

For a personal blog the spam vector is tolerable. If it ever becomes a problem, two mitigations:

1. **Rate limit at Cloudflare** (or any edge layer) — block by IP after N requests per minute to the Supabase RPC URLs.
2. **Add a server-side token check** — change the RPC functions to require a value-of-the-day token that the public site generates from a non-PUBLIC env. Annoying to maintain.

## Schema diagram

```
post_stats
├── slug         text primary key   (matches Astro post slug)
├── views        bigint default 0
├── likes        bigint default 0
└── updated_at   timestamptz
```

Each row is one blog post. Slug is the URL-safe identifier (e.g. `the-three-horsemen-of-slow`).

## Manually pre-populate a count

In case you want to seed a number (e.g. you imported a post from Medium and want to reflect its existing view count):

```sql
insert into post_stats (slug, views, likes)
values ('the-three-horsemen-of-slow', 1234, 56)
on conflict (slug) do update
  set views = excluded.views, likes = excluded.likes;
```

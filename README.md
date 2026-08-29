# Typing Adventure 🏎️🦄

A gamified typing tutor built for two kids learning to type at very different stages — Everett (8, hunt-and-peck, working toward full touch-typing) and Elliott (pre-reader, learning letter/keyboard recognition).

## What's in here

- **Two learning tracks**
  - **Supercar Garage** (Everett & a "Dad" testing profile): a 6-stage touch-typing curriculum — Home Row → Top Row → Bottom Row → Short Words → Word Sprint (timed) → Sentences. Stages only advance at 80%+ accuracy. Includes finger-to-key color guidance and a live "use your ___ finger" prompt.
  - **Sparkle Trail** (Elliott): a pre-reading letter-hunt game — spoken prompts, big visual letters, and an on-screen keyboard, starting with the letters in his own name.
- **Coins, ranks, and a rewards vault**: coins unlock themed ranks and real-world reward tiers that a parent redeems with a PIN (this is a tracker, not a payment system — no real money moves through the app).
- **A fair family leaderboard**: ranks by practice *rounds completed this week* (plus a streak badge) rather than raw skill or coins, so kids on completely different tracks can compete fairly. Resets weekly. The "Dad" testing profile is excluded from rankings.
- **Multiple profiles**: Everett, Elliott, and a Dad profile for testing changes without touching the kids' saved progress.

## Architecture

Single static `index.html` — no build step. Progress is saved to a Supabase Postgres table (`typing_app_state`) via the Supabase JS client (loaded from a CDN). The whole app state is stored as one JSON blob under a single row (`id = 'main'`), matching how it worked as a Claude.ai artifact prototype (`window.storage`) before this Supabase swap.

**Security note:** there's no login system — this is a small family app. Row-Level Security policies on `typing_app_state` currently allow public read/write via the Supabase publishable key (which is expected to be public; it's the RLS policies that matter). Realistically, discovering the live URL and knowing to inspect network requests would be needed to tamper with it — low risk for a private family project, but worth tightening (e.g. gating writes through a Supabase Edge Function with a shared secret) if this ever gets a wider audience or gets linked publicly.

## Local development

Just open `index.html` in a browser — no build tools needed. It talks directly to Supabase over the network, so you do need an internet connection even for local testing.

## Deployment

This repo is meant to be connected to Netlify for automatic deploys:

1. In the Netlify dashboard: **Add new site → Import an existing project → GitHub → select this repo**.
2. Build command: none. Publish directory: `/` (repo root).
3. Deploy. Every push to `main` will auto-deploy from then on.

## Database schema

```sql
create table typing_app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

RLS is enabled with public read/insert/update policies (see note above).

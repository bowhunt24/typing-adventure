# Typing Adventure 🏎️🦄

A gamified typing tutor built for two kids learning to type at very different stages — Everett (8, hunt-and-peck, working toward full touch-typing) and Elliott (pre-reader, learning letter/keyboard recognition).

## What's in here

- **One shared, extensible curriculum, two themes**: both kids progress through the same stage ladder — Home Row → Top Row → Bottom Row → Short Words → Word Sprint (timed) → Sentences → Capital Letters (real Shift-key case-checking) → Numbers & Punctuation → Speed Trials (endless, bronze/silver/gold WPM badges, no dead end). Stages advance at 80%+ accuracy; Speed Trials just keeps going forever so there's always something to chase.
  - **Supercar Garage** (Everett & a "Dad" testing profile) runs that ladder from Home Row.
  - **Sparkle Trail** (Elliott) runs the same ladder, but starts one stage earlier with a **Sight Words bridge** — whole-word reading/typing with spoken prompts, no finger-position technique required yet — before merging into Home Row. Meant for a kid who's already reading and writing but hasn't done touch-typing.
  - Both tracks are defined in `CURRICULA` in `index.html`, so adding another stage (or a third track) later is a matter of extending that data, not rewriting the engine.
- **Parent-editable word & sentence lists**: every words/sentences-type stage ships with a real preloaded list (not blank), editable from Parent Settings — Elliott's sight words, spelling-test words, whatever's relevant that week. An emptied-out list silently falls back to the built-in default, so the app is never dependent on a parent keeping it filled in.
- **Coins, ranks, a rewards vault, and savings**: coins unlock themed ranks and reward tiers that a parent redeems with a PIN. Each tier can carry a dollar value; redeeming one now also banks that value into a running **Savings** balance per kid, so several small rewards can visibly stack toward one bigger purchase — a parent logs the purchase (item + amount) from the Savings screen when it happens, drawing down the balance. This is a tracker, not a payment system — no real money moves through the app.
- **A fair family leaderboard**: ranks by practice *rounds completed this week* (plus a streak badge) rather than raw skill or coins, so kids on completely different stages can compete fairly. Resets weekly. The "Dad" testing profile is excluded from rankings.
- **Multiple profiles**: Everett, Elliott, and a Dad profile for testing changes without touching the kids' saved progress.

## Testing

`test/run_sim.js` and `test/run_migration_sim.js` are headless jsdom simulations — not a build step, just a way to sanity-check changes before they touch the live Supabase data both kids are actively using. The first plays a scripted profile through an entire curriculum (every stage, including the endless Speed Trials stage and vault/savings redemption); the second loads a state shaped like what's actually saved in production today and checks it migrates safely — no crash, no lost coins/progress, no reset. Run them with:

```
cd test && npm install && npm test
```

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

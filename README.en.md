# Tico Games

*[Leer en español](README.md)*

A football prediction PWA for groups of friends. Each group predicts match
scores for a tournament; the app scores them automatically against real
results and keeps the standings, the history and the pot.

It started for the 2026 World Cup and now runs **several tournaments at once**
— the World Cup, the UEFA Champions League and the Costa Rican first division —
each with its own groups, rules and scoring.

**It is in production, used by a real group of 26 people, and they play for
money.** That constraint drives most of the design decisions: nobody can see
anyone else's predictions before kickoff, rules cannot be changed mid-tournament
without a group vote, and a miscalculated score is not a cosmetic bug.

## What it does

- **Predictions close automatically** 15 minutes before kickoff. Until then, no
  one can read anyone else's — enforced by Postgres row-level security, not by
  the UI.
- **Automatic scoring**: exact score, correct result, dedicated rules for
  penalty shootouts, and a «×2» power-up with a per-round quota.
- **Live scores** synced from ESPN, with standings and history recomputing on
  their own.
- **Match detail**: line-ups drawn on a pitch, recent form for both teams, and
  head-to-head history.
- **Push notifications**: a 6 a.m. summary of the day's matches, and a reminder
  45 minutes before kickoff — sent only to people who still owe a prediction.
- **Multiple groups per tournament**, each with its own admin, scoring rules,
  pot and rule-change votes.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite 6 · Tailwind CSS 4 · `motion` · TanStack Query · vite-plugin-pwa |
| Backend | FastAPI (Python 3.12) · PyJWT · httpx · pywebpush |
| Database | PostgreSQL on Supabase, with row-level security and `pg_cron` |
| Auth | Supabase Auth — email/password or «Sign in with Google» |
| Hosting | Vercel (frontend and backend deployed together) |

## Layout

```
frontend/    React + Vite. The PWA and the whole interface (112 source files).
backend/     FastAPI (~4,400 lines). ESPN sync, push notifications, admin tasks.
database/    Numbered SQL migrations (87 so far). Applied by hand.
docs/        Documentation for specific features.
shared/      Shared constants.
scripts/     Standalone maintenance utilities.
```

## Running it locally

You need **Node 20**, **Python 3.12**, and your own Supabase project with the
migrations in `database/` applied in order.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env          # fill in your project's values
npm run dev                   # http://localhost:5173
```

`.env` needs:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_API_URL=/_backend
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # fill in your project's values
uvicorn app.main:app --reload # http://localhost:8000
```

`requirements.txt` holds only what ships to the serverless runtime;
`requirements-dev.txt` includes it and adds the local server and pytest.

## Tests

```bash
cd frontend
npm test          # 309 logic tests (vitest)
npm run test:ui   # 110 interface tests (Playwright)
npm run lint

cd ../backend
python -m pytest  # 107 tests
```

The Playwright tests **intercept every Supabase call**: they touch no real
database and need no credentials.

Two conventions worth knowing, both learned the hard way:

- **Every new test is verified by breaking the code on purpose.** A test that
  passes with the bug in place is worse than no test — it also convinces you
  there is nothing to fix. There is a real case in this repo of a focus-contrast
  test that passed for months because it measured a colour mid-transition,
  hiding a genuine WCAG failure underneath.
- **A stub must never be more permissive than the real server.** Another real
  case: `/auth/v1/settings` requires an `apikey` header, the stubs ignored
  headers, twelve tests stayed green while production returned 401.

## Deployment

Every push to `main` deploys the frontend and the backend together on Vercel
(`vercel.json` → `experimentalServices`; the backend is served under
`/_backend`).

Scheduled work — syncing scores, the 6 a.m. summary, the kickoff reminder — is
triggered by **`pg_cron` from inside the database**, not by GitHub Actions.
That move was made after measuring that GitHub's `schedule:` was firing about
**2.5% of the expected runs**.

Migrations in `database/` are **applied by hand** in Supabase's SQL editor, in
order. `database/verificar_estado.sql` is read-only and diffs the live database
against the repository.

## Documentation

- **[`CLAUDE.md`](CLAUDE.md)** *(Spanish)* — the one that matters: an
  architecture decision record where each entry carries the measurement that
  motivated it, the failure mode it prevents, and the mistakes already made.
  Start there before touching scoring, database security or power-up quotas.
- [`docs/CALENDARIO.md`](docs/CALENDARIO.md) — exporting matches to a calendar.
- [`APLICAR_MIGRACIONES.md`](APLICAR_MIGRACIONES.md) — how to apply migrations.

## A note on language

The code, comments and documentation are in Spanish, because the people who
use and maintain this app speak Spanish. This file is the exception, kept in
sync with [`README.md`](README.md).

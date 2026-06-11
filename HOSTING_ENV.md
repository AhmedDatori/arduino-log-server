# Hosting Environment Variables

Add these values in your hosting provider's environment variable panel.

## Required

- `NODE_ENV`
  - Use `production`.

- `PORT`
  - Use the port your host gives you. If your host manages this automatically, you can leave it unset.

- `DATABASE_URL`
  - Your PostgreSQL or Supabase connection string.
  - Format: `postgres://USER:PASSWORD@HOST:5432/postgres`
  - Use this OR the individual `PGHOST`, `PGUSER`, and `PGPASSWORD` fields below.

## Required If You Do Not Use DATABASE_URL

- `PGHOST`
  - Database host, for example `db.your-project.supabase.co`.

- `PGPORT`
  - Usually `5432`.

- `PGDATABASE`
  - Usually `postgres`.

- `PGUSER`
  - Usually `postgres`, unless you created a different database user.

- `PGPASSWORD`
  - Your database password.

## Recommended

- `DB_SSL_REJECT_UNAUTHORIZED`
  - Use `false` for Supabase-style hosted PostgreSQL connections.

## Optional AI Features

- `GEMINI_API_KEY`
  - Required for AI chat, health score, reports, predictions, camera diagnosis, experiments, and hardware diagnostics.
  - If missing, basic logging, controls, plants, alerts, and camera frame storage still work.

- `GEMINI_MODEL`
  - Default: `gemini-3.1-flash-lite`.

## Example

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
DB_SSL_REJECT_UNAUTHORIZED=false
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.1-flash-lite
```

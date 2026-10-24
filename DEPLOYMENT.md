# Deployment: Hostless API + Cloudflare frontend

The backend and browser app deploy independently. The backend still serves the
AdminJS panel, health check, API, webhooks, and legal pages. It no longer tries
to serve the React app unless `SERVE_WEB_APP=true` is explicitly set.

## Hostless backend app

Connect this repository as an **App** and use the checked-in `hostless.yaml`.
Its working directory is `/maria_backend` (and its build context defaults to
that same directory), so Railpack can find `package-lock.json` and `prisma/`.
It generates Prisma Client, compiles TypeScript,
and starts with `npm run start:prod`. The health check is `GET /health`.

Set these variables in the Hostless app environment:

- `NODE_ENV=production`
- `SERVE_WEB_APP=false`
- `DATABASE_URL` with the production PostgreSQL connection string
- `WEB_ALLOWED_ORIGINS` with the exact Cloudflare site origin, without a
  trailing slash (add other approved origins as comma-separated values)
- `RUN_MIGRATIONS_ON_START=true` for the first deployment or when applying
  pending Prisma migrations; Hostless starts the migration before the API
- `AUTH_TOKEN_SECRET` to a random secret of at least 32 characters
- `ADMIN_SESSION_SECRET` and `PII_ENCRYPTION_KEY` to production-only secrets
- Production provider/payment credentials needed by the enabled services;
  never put secrets in Cloudflare build variables or the frontend

Hostless supplies `PORT`; the server already binds to `0.0.0.0`. After the
migrations have been applied, `RUN_MIGRATIONS_ON_START` can be set to `false`
to avoid running the migration command on every restart. The AdminJS panel is
available at `/admin` on the Hostless backend domain.

## Cloudflare Workers frontend (`workers.dev`)

The frontend can run as a static-assets Worker. The checked-in
`web/wrangler.jsonc` points Workers to Vite's `dist/` directory and enables
SPA fallback for React Router routes. Configure the Worker build with:

- Root directory: `web`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Build environment variable `VITE_API_BASE_URL`: the Hostless backend origin,
  such as `https://your-api.hostless.app`, without `/api` or a trailing slash

Add the Worker production origin (for example,
`https://maria-digital.<account>.workers.dev`) to the backend's
`WEB_ALLOWED_ORIGINS`. If you use a custom frontend domain, allow that exact
origin too. Add preview origins only when they should be allowed to call the
production API.

If deploying as Cloudflare Pages instead, use root directory `web`, build
command `npm run build`, and output directory `dist`; Pages supplies SPA
fallback automatically while the project has no top-level `404.html`.

## First deployment order

1. Set Hostless environment variables and deploy the backend.
2. Confirm `https://<backend-domain>/health` returns `{"status":true,...}`.
3. Set Cloudflare's `VITE_API_BASE_URL` to that backend origin and deploy the
   Worker (or Pages site).
4. Add the final Cloudflare origin to `WEB_ALLOWED_ORIGINS` and redeploy/restart the
   backend if you changed it.
5. Update payment-provider callback URLs and partner webhook URLs to the
   Hostless backend domain. The API webhook paths are unchanged.

The frontend build embeds `VITE_API_BASE_URL` into browser JavaScript, so it
must contain only the public backend URL and never a credential or secret.

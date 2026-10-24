# Deployment: Hostless API + Cloudflare Pages frontend

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
- `WEB_ALLOWED_ORIGINS` with the exact Cloudflare Pages site origin, without a
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

## Cloudflare Pages frontend

Create a Pages project from the same repository with:

- Root directory: `web`
- Build command: `npm run build`
- Build output directory: `dist`
- Build environment variable `VITE_API_BASE_URL`: the Hostless backend origin,
  such as `https://your-api.hostless.app`, without `/api` or a trailing slash

Add the Pages production origin (for example,
`https://your-site.pages.dev`) to the backend's `WEB_ALLOWED_ORIGINS`. If you
use a custom frontend domain, allow that exact origin too. Add preview origins
only when they should be allowed to call the production API. Cloudflare Pages
automatically serves this React single-page app's root document for client
routes; do not add a `404.html` file that would disable its SPA fallback.

The checked-in `web/public/_headers` sets conservative caching for the HTML
shell and long-lived caching for Vite's fingerprinted assets.

## First deployment order

1. Set Hostless environment variables and deploy the backend.
2. Confirm `https://<backend-domain>/health` returns `{"status":true,...}`.
3. Set Cloudflare's `VITE_API_BASE_URL` to that backend origin and deploy Pages.
4. Add the final Pages origin to `WEB_ALLOWED_ORIGINS` and redeploy/restart the
   backend if you changed it.
5. Update payment-provider callback URLs and partner webhook URLs to the
   Hostless backend domain. The API webhook paths are unchanged.

The frontend build embeds `VITE_API_BASE_URL` into browser JavaScript, so it
must contain only the public backend URL and never a credential or secret.

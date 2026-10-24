# MAJOR DATA-LINK — Web

Landing page + browser dashboard (login, wallet, buy airtime/data), built with
React + Vite + TypeScript + Tailwind CSS v4. Talks to the same backend API as
the Flutter app (`../major_data_link_backend`).

## Local development

```bash
npm install
npm run dev
```

By default, requests to `/api/*` are proxied to `http://localhost:8787`
(the backend's default port - see `major_data_link_backend/src/config/env.ts`).
If your backend runs elsewhere, set `VITE_API_PROXY_TARGET` before starting:

```bash
VITE_API_PROXY_TARGET=http://localhost:5000 npm run dev
```

## Production: Cloudflare Workers

This project deploys as a static-assets Worker at its `workers.dev` domain.
`wrangler.jsonc` publishes Vite's `dist/` assets and enables SPA fallback for
React Router routes. From the `web` directory, use:

```bash
npm ci
npm run deploy:worker
```

Configure the Worker build with root directory `web`, build command
`npm run build`, and deploy command `npx wrangler deploy` (or run
`npm run deploy:worker` as one command). Set `VITE_API_BASE_URL` as a
build-time variable to the Hostless backend origin, without `/api` or a
trailing slash. Also allow the Worker origin in the backend's
`WEB_ALLOWED_ORIGINS` environment variable. Never put backend secrets in this
frontend project.

## What's here (current scope)

- `/` - marketing landing page
- `/login`, `/register` - auth (same accounts as the mobile app)
- `/dashboard` - wallet balance, virtual account number, recent transactions
- `/buy-airtime`, `/buy-data` - the two most common top-up flows
- `/privacy-policy`, `/terms` - redirect to the backend-hosted legal pages
  (single source of truth, shared with the in-app legal screen)

Not yet built here (still mobile-only for now): cable TV, electricity,
verification services (NIN/BVN), result checkers, referrals, KYC. Same
pattern as the pages above - add a route + page under `src/pages`, call the
matching `/api/...` endpoint.

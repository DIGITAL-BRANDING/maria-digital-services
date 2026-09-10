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

## Production

This app is built and copied into `major_data_link_backend/public/app` as
part of the Railway build (see `../nixpacks.toml` / `../railway.json`), and
served by the same Express server that serves the API - so in production,
`VITE_API_BASE_URL` should stay unset (relative `/api/...` calls hit the same
origin). Only set `VITE_API_BASE_URL` if this is ever deployed to a
**different** origin than the backend.

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

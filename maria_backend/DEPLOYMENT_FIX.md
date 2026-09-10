# Railway Deployment Fix & Troubleshooting Guide

> **Database migration note:** this application's active database is now MySQL.
> `DIRECT_URL`, Supabase pooler advice, and PostgreSQL-specific troubleshooting
> below are historical only. See [MYSQL_MIGRATION.md](MYSQL_MIGRATION.md) for
> the current cutover checklist.

## 🔴 Root Cause Analysis

Your deployment failed with **"1/1 replicas never became healthy"** due to multiple issues:

### Issues Fixed ✅

1. **`server.ts` - Missing Error Handling**
   - Server would crash silently on startup errors
   - No logging for port binding failures or initialization errors
   - Fixed: Added comprehensive error handling, graceful shutdown, and signal handlers

2. **`env.ts` - Poor Error Messages**
   - Validation errors weren't clearly reported
   - Production security checks weren't grouped logically
   - Fixed: Enhanced with detailed error reporting, security check grouping, and early failure detection

3. **`prisma.ts` - No Connection Logging**
   - Database connection failures were silent
   - No indication if migrations had issues
   - Fixed: Added connection state logging, singleton pattern, and exit handlers

4. **`start-prod.mjs` - Silent Failures**
   - Migration failures weren't properly reported
   - Process exits weren't logged with context
   - Fixed: Added progress tracking, better error messages, and visual separators

5. **`error.ts` - Incomplete Error Handling**
   - Zod validation errors weren't properly formatted
   - Errors weren't logged to Railway container stdout/stderr
   - Fixed: Added Zod error handling, environment-aware logging, better error categorization

---

## 📋 Pre-Deployment Checklist

### 1. Environment Variables Setup

Set these in Railway Dashboard → Variables:

```env
# Database (CRITICAL)
DATABASE_URL=mysql://user:password@host:3306/infoverify

# Node
NODE_ENV=production

# Security (MUST be strong random values)
AUTH_TOKEN_SECRET=<generate: openssl rand -hex 32>
ADMIN_SESSION_SECRET=<generate: openssl rand -hex 32>

# Payment
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_CALLBACK_URL=https://yourdomain.com/api/webhooks/paystack

# Providers
ALRAHUZ_API_TOKEN=your_token

# Firebase (Base64 encoded service account)
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded-json>
```

### 2. Generate Secure Secrets

```bash
# Generate AUTH_TOKEN_SECRET (min 32 chars)
openssl rand -hex 32

# Generate ADMIN_SESSION_SECRET (min 16 chars)
openssl rand -hex 16
```

### 3. Database Verification

Before deploying, verify your database:

```bash
# Test connection locally
npx prisma db push  # or migrate deploy

# Check migrations are unapplied
npx prisma migrate status
```

---

## 🚀 Deployment Steps (Railway)

### Step 1: Push Code
```bash
git push origin main
```

### Step 2: Railway Logs - What to Look For

✅ **Good startup sequence:**
```
[start] Starting production deployment sequence...
[start] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[start] Step 1: Running database migrations
[start] Running: npx prisma migrate deploy
✓ Database connected successfully
[start] ✓ prisma completed successfully
[start] Step 2: Starting API server
✓ MAJOR DATA-LINK backend listening on http://0.0.0.0:8787
```

❌ **Common failure patterns:**

| Error | Cause | Fix |
|-------|-------|-----|
| `✗ Environment variable validation failed: DATABASE_URL is required` | Missing DATABASE_URL | Set DATABASE_URL in Railway Variables |
| `✗ Failed to connect to database: ECONNREFUSED` | Database unavailable or wrong host | Verify the MySQL `DATABASE_URL` and MySQL service |
| `✗ Production security violations detected` | AUTH_TOKEN_SECRET or ADMIN_SESSION_SECRET using defaults | Generate strong secrets, set in Railway Variables |
| `✗ Port 8787 is already in use` | Port conflict | Railway assigns dynamic ports; code now uses PORT env var correctly |
| `prisma migrate deploy failed` | Migration issue | Run `npx prisma migrate status` locally; resolve pending migrations |

---

## 🔍 Debugging Failed Deployments

### 1. Check Railway Logs
```
Dashboard → Project → Deployments → Latest → View Logs
```

### 2. View Live Logs
```bash
# If using Railway CLI
railway logs

# Look for:
# - Environment validation errors (first)
# - Database connection errors (second)
# - Migration errors (third)
# - Server startup (fourth)
```

### 3. Test Locally First

```bash
# Build
npm run build

# Test production startup script
npm run start:prod

# Or run directly
node dist/server.js
```

### 4. Health Check

Once deployed, verify the service is healthy:

```bash
curl https://yourdomain.com/health

# Should return:
# {"status":true,"service":"imam-datasub-backend"}
```

---

## 🛠️ What Changed

### Files Modified:

1. **`src/server.ts`** - Added error handling & graceful shutdown
   - Server error listeners
   - Signal handlers (SIGTERM, SIGINT)
   - Prisma disconnection on exit

2. **`src/config/env.ts`** - Enhanced validation & logging
   - Grouped error reporting
   - Better error messages per variable
   - Production security checks with clarity

3. **`src/lib/prisma.ts`** - Connection state management
   - Singleton pattern
   - Connection logging
   - Exit handlers

4. **`scripts/start-prod.mjs`** - Better process orchestration
   - Progress tracking
   - Error context in exit messages
   - Visual separators for log readability

5. **`src/middleware/error.ts`** - Comprehensive error handling
   - Zod validation error formatting
   - Environment-aware logging
   - Better error categorization

---

## 🚨 If Deployment Still Fails

### Escalation Steps:

1. **Check Railway status page** - Are Railway services down?

2. **Verify PostgreSQL is running**
   ```bash
   # Railway Dashboard → Services → PostgreSQL → Check logs
   ```

3. **Test DATABASE_URL locally**
   ```bash
   npx prisma db execute --stdin < /dev/null
   ```

4. **Check Node version**
   - Required: Node >= 20.0.0
   - Railway nixpacks.toml specifies `nodejs_20` ✅

5. **Rebuild from scratch**
   ```bash
   # Force rebuild in Railway
   Dashboard → Redeploy
   ```

6. **Enable verbose logging**
   - Set `NODE_ENV=development` temporarily to see more logs
   - **NEVER use in production for extended time** (security risk)

---

## 📝 Post-Deployment Verification

### 1. Health Endpoint
```bash
curl https://yourdomain.com/health
# {"status":true,"service":"imam-datasub-backend"}
```

### 2. Auth Endpoint
```bash
curl -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "password123"
  }'
```

### 3. Monitor Logs
```bash
railway logs --tail
```

---

## 🎯 Key Improvements Made

| Aspect | Before | After |
|--------|--------|-------|
| **Server Startup** | Silent crashes | Clear error messages with context |
| **Env Validation** | Generic error on first var | Lists all validation errors |
| **DB Connection** | No feedback | Logs connection state & errors |
| **Migrations** | Silent failures | Shows progress: "Step 1...", "Step 2..." |
| **Production Safety** | Defaults allowed in prod | Strict checks prevent insecure deploys |
| **Error Handling** | Incomplete | Handles Zod, ApiError, generic errors |
| **Graceful Shutdown** | Force kills | 10s graceful shutdown on SIGTERM/SIGINT |

---

## 📚 Additional Resources

- [Railway Docs](https://docs.railway.app)
- [Prisma Deployment](https://www.prisma.io/docs/guides/deployment)
- [Express Error Handling](https://expressjs.com/en/guide/error-handling.html)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides/nodejs-performance-example-walkthrough/)

---

## ✅ Summary

Your backend now has:
- ✅ Comprehensive startup error handling
- ✅ Clear environment validation with detailed error messages
- ✅ Database connection logging and validation
- ✅ Graceful shutdown on process signals
- ✅ Production-ready error middleware
- ✅ Better deployment script logging

**Next Steps:**
1. Set all required environment variables in Railway
2. Deploy and monitor logs
3. Verify health endpoint responds
4. Test a sample API call


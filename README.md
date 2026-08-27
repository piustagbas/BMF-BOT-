# Memecoinbot

Solana meme-coin trading **analyzer** (Expo mobile + NestJS API).

## Safety defaults

- **No real-money trades** in early phases
- Trading mode default: `SIGNAL_ONLY`
- Auto trading: **OFF**
- Kill switch: **ON**
- Language: potential setups only — never “guaranteed profit”

## Stack

| Layer | Tech |
|-------|------|
| Mobile | Expo (React Native) |
| API | NestJS + TypeScript |
| DB | **MongoDB** (Mongoose) — same pattern as LinguaAICall-Backend |
| Auth | JWT Bearer + AsyncStorage (`token` / `user`) |
| Jobs | Redis (optional) |
| Monorepo | pnpm + Turborepo |

## Quick start

```bash
# 1. Copy env
cp .env.example .env

# 2. Start MongoDB + Redis
docker compose up -d

# 3. Install
pnpm install

# 4. Build shared packages
pnpm --filter @memecoinbot/db build
pnpm --filter @memecoinbot/api build

# 5. Run API (port 3001, prefix /api)
pnpm dev:api

# 6. Run mobile (separate terminal)
pnpm dev:mobile
```

### Phone / Expo Go via ngrok (LinguaAICall pattern)

```bash
# Terminal A — API
pnpm dev:api

# Terminal B — tunnel the API port
ngrok http 3001

# In .env (and restart Expo):
# SERVER_URL=https://YOUR-SUBDOMAIN.ngrok-free.dev
# EXPO_PUBLIC_API_URL=https://YOUR-SUBDOMAIN.ngrok-free.dev/api

pnpm dev:mobile
```

The mobile client sends `Authorization: Bearer <jwt>` and `ngrok-skip-browser-warning: 1` on every request.

### Auth endpoints

- `POST /api/auth/register` — `{ name, email, password }`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/user/profile` — requires Bearer token

Watchlist and settings are **per-user** in MongoDB (require login).

## Telegram alerts + Redis queues

### Redis (notification job queue)

```bash
# Terminal — keep running
pnpm redis:start
# Uses embedded Redis on 6379 (no Docker needed)
# REDIS_URL=redis://127.0.0.1:6379
```

When Redis is up, Telegram sends go through a **BullMQ** queue. If Redis is down, the API still sends Telegram **directly** (sync fallback).

### Telegram (BotFather)

1. Telegram → **@BotFather** → `/newbot` → copy the bot token  
2. In `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ```
3. Restart API, open your bot in Telegram, send any message  
4. Discover chat id:
   ```bash
   curl -s http://localhost:3001/api/notifications/telegram/discover-chat | python3 -m json.tool
   ```
5. Put `TELEGRAM_CHAT_ID=...` in `.env`, restart API  
6. App → **Settings** → enable **Telegram** → **Send test notification**

Help JSON: `GET /api/notifications/telegram/setup`

## Axiom API keys

**Axiom Trade does not publish an official public developer API key.**

What people use in practice:

1. **Leave empty (recommended for this app)** — scanner still works via DEX Screener + Jupiter + RugCheck. Auto trading stays blocked when `AXIOM_REQUIRED_FOR_AUTO_TRADING=true` (default).
2. **Unofficial / session tokens** — some community SDKs scrape `auth-access-token` / `auth-refresh-token` cookies after you log into [axiom.trade](https://axiom.trade) in a browser. That is unofficial, fragile, and against many ToS; we only expose placeholders (`AXIOM_ACCESS_TOKEN`, `AXIOM_REFRESH_TOKEN`, `AXIOM_API_KEY`) if you later wire a proxy yourself.
3. **Alternatives** — third-party market APIs (e.g. Mobula or similar) that expose Solana meme data with a real documented key.

Until a real Axiom feed is wired, the API reports `AXIOM DATA UNAVAILABLE` and will not claim Axiom-backed auto execution.

## Phase status

- Phase 1–10: ✅ core trading stack
- UI: 5 tabs (Home · Scanner · Signals · Watchlist · More)
- Auth + Mongo persistence: ✅ (watchlist / settings per user)
- Still optional: in-app wallet signing, real Axiom proxy

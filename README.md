# MXN Translate Backend

Backend API for the **MXN Translate Discord Bot dashboard**.

This service:
- Exposes REST endpoints used by your dashboard.
- Reads and updates translation-related settings in the bot's SQLite database.
- Protects API routes with a bearer API key.
- Includes a separate scheduler worker for timed Discord messages.

---

## Tech Stack

- **Node.js** + **Express**
- **SQLite** via `better-sqlite3`
- **Discord API** integration (scheduler worker)
- **Luxon** for timezone-aware timestamp handling

---

## Project Structure

```text
.
├── package.json
└── server
    ├── index.js                  # Main API server
    ├── scheduler-service.mjs     # Background scheduler worker
    ├── middleware/
    ├── routes/
    └── services/
```

> The active API entrypoint is `server/index.js`.

---

## Prerequisites

- Node.js 18+
- npm
- Access to the Discord bot SQLite database file
- A `.env` file with required variables

---

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=3600
BOT_API_KEY=your_secure_api_key
DB_PATH=/absolute/path/to/discord_tracker.db
DISCORD_BOT_TOKEN=your_discord_bot_token
```

### Variable details

- `PORT` (optional): API server port. Defaults to `3600`.
- `BOT_API_KEY` (required for protected routes): Bearer token expected by the API.
- `DB_PATH` (optional but strongly recommended): SQLite DB path. If omitted, code falls back to `/home/mason/discord_data/discord_tracker.db`.
- `DISCORD_BOT_TOKEN` (required for scheduler): Bot token for sending scheduled messages through Discord API.

---

## Installation

```bash
npm install
```

---

## Running the API

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

### PM2

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

---

## Running the Scheduler Worker

The scheduler is a separate process from the API:

```bash
node server/scheduler-service.mjs
```

It checks for due scheduled messages every 30 seconds and posts them to Discord (via bot token or webhook, depending on stored config).

---

## Authentication

Protected endpoints require:

```http
Authorization: Bearer <BOT_API_KEY>
```

If missing or invalid, the API returns `401`.

---

## API Endpoints

Base URL (local): `http://localhost:3600`

### Health

- `GET /health`
- Returns API status, timestamp, and DB connectivity state.

### Guilds

- `GET /api/guilds`
- Returns guild list (id, name, icon, memberCount).
- **Auth required**.

### Channels

- `GET /api/channels?serverId=<guild_id>`
- Returns visible/configured channels for a guild.
- **Auth required**.

### Full Config

- `GET /api/config/:serverId`
- Returns:
  - `autoTranslate.pairs`
  - `announcements.routes`
  - `restrictions.blockedChannels`
  - `general.enabled`
- **Auth required**.

### Update General Toggle

- `POST /api/config/:serverId/general`
- Body:

```json
{ "enabled": true }
```

- Upserts `translation_config.enabled` for that guild.
- **Auth required**.

---

## Example Requests

### Health check

```bash
curl http://localhost:3600/health
```

### Fetch guilds

```bash
curl -H "Authorization: Bearer $BOT_API_KEY" \
  http://localhost:3600/api/guilds
```

### Fetch channels

```bash
curl -H "Authorization: Bearer $BOT_API_KEY" \
  "http://localhost:3600/api/channels?serverId=123456789012345678"
```

### Fetch config

```bash
curl -H "Authorization: Bearer $BOT_API_KEY" \
  http://localhost:3600/api/config/123456789012345678
```

### Update translation enabled

```bash
curl -X POST \
  -H "Authorization: Bearer $BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  http://localhost:3600/api/config/123456789012345678/general
```

---

## Notes

- If DB connection fails on startup, the API enters a placeholder mode where some endpoints return empty responses.
- CORS currently allows localhost dashboard origins and `*.mxn.au`.
- Additional route/service files exist in `server/routes` and `server/services`; keep them in sync if you later refactor `server/index.js` to use modular routing.

---

## License

Private project (update this section if you want to publish).

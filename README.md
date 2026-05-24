# Arduino Log Server

A lightweight Node.js server that receives log entries from an Arduino/ESP-01 
and displays them in a live-updating dashboard.

## Quick Start (local)

```bash
npm install
npm start
# open http://localhost:3000
```

## API

| Method | Path        | Body (form / JSON)           | Description              |
|--------|-------------|------------------------------|--------------------------|
| POST   | `/log`      | `message=...&device=...`     | Save a new log entry     |
| GET    | `/api/logs` | —                            | Return last 100 logs JSON|
| DELETE | `/api/logs` | —                            | Clear all logs           |
| GET    | `/`         | —                            | Dashboard UI             |

## Test with curl

```bash
curl -X POST http://localhost:3000/log \
  -d "message=Hello from Arduino&device=ESP-01"
```

## Deploy (VPS / any Node host)

1. Upload the folder (without `node_modules/`)
2. `npm install` on the server
3. `npm start`  (or use PM2: `pm2 start server.js`)

If you use a reverse proxy (nginx), proxy port 3000 to port 80/443.

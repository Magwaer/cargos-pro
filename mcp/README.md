# Cargos.pro MCP server

MCP tools for the Cargos TMS API: companies, contacts, orders, dispatch, fleet, invoices, expenses, activities, workflows, documents, users, search, reports, SMS, and audit.

Authorization is stored **on this server**, not in the chat client. A write API key does not expire until you revoke it.

Production URL: **https://cargos.pro/mcp**

## Tools

| Group | Tools |
| --- | --- |
| Auth | `auth_login`, `auth_status`, `auth_logout` |
| Read any object | `list`, `get` |
| Write one object | `create`, `update`, `remove` |
| Batch write | `batch` — insert / update / delete up to 50 records |
| Overview | `search`, `get_me`, `get_dashboard`, `get_reports`, `get_paid_report`, `get_invoice_aging` |
| Dispatch | `get_dispatch`, `assign_dispatch`, `unassign_dispatch`, `estimate_route` |
| Order extras | `set_order_party`, `remove_order_party`, `generate_order_invoice` |
| Invoices | `share_invoice`, `email_invoice` |
| Platform | `list_notifications`, `mark_notifications_read`, `list_workflow_runs`, `list_audit`, `list_sms`, `get_sms_thread`, `send_sms` |
| API keys | `list_api_keys`, `create_api_key`, `revoke_api_key` |

`resource` on list/get/create/update/remove/batch: `company`, `contact`, `order`, `expense`, `invoice`, `vehicle`, `driver`, `activity`, `workflow`, `document`, `user`, `address`.

### Batch example

```json
{
  "operations": [
    { "op": "insert", "resource": "company", "data": { "name": "Nordic Grain", "role": "customer", "city": "Gdansk" } },
    { "op": "update", "resource": "order", "id": "345efcc3-4999-45ef-b560-7547c3412c58", "data": { "status": "in_transit" } },
    { "op": "delete", "resource": "expense", "id": "…" }
  ],
  "stopOnError": true
}
```

Money fields are integer cents (`186000` = €1,860).

## Authorization (long-lived)

Pick one. The server keeps the credential and every tool reuses it.

1. **API key (recommended).** In Cargos: Settings → API keys → create a **write** key (`ck_live_…`). Set `CARGOS_API_KEY`. Keys stay valid until revoked.
2. **Login once.** Call `auth_login` with email and password. The server exchanges the 7-day JWT for a write API key and writes it to `MCP_AUTH_PATH` (mode `0600`).
3. **Startup login.** Set `CARGOS_EMAIL` and `CARGOS_PASSWORD`. On boot the server mints a key and stores it, then you can unset the password.

`auth_logout` deletes the file. It does not unset `CARGOS_API_KEY`.

## Local (stdio, Cursor)

```bash
cd mcp
cp .env.example .env
# set CARGOS_API_URL=http://localhost:3010 and CARGOS_API_KEY
npm install
```

```json
{
  "mcpServers": {
    "cargos": {
      "command": "node",
      "args": ["/absolute/path/to/cargos.pro/mcp/src/index.js"],
      "env": {
        "CARGOS_API_URL": "http://localhost:3010",
        "CARGOS_API_KEY": "ck_live_…"
      }
    }
  }
}
```

Docker Compose on this machine can still run the API and a local MCP (`http://localhost:3100/mcp`) for development. Production does not use Docker.

## Production (https://cargos.pro)

The API and MCP run under **PM2**. Nginx terminates TLS, serves the built frontend from `frontend/dist`, and proxies the API and MCP:

| URL | Served by | Port |
| --- | --- | --- |
| `https://cargos.pro` | Nginx static files (`frontend/dist`) | — |
| `https://cargos.pro/api/` | `cargos-api` | `127.0.0.1:3000` |
| `https://cargos.pro/mcp` | `cargos-mcp` | `127.0.0.1:3100` |

### 1. Host packages

Node 22, PostgreSQL, Nginx, Certbot, PM2.

```bash
sudo npm install -g pm2
sudo mkdir -p /opt/cargos.pro /var/lib/cargos
```

### 2. App

```bash
cd /opt/cargos.pro
npm --prefix backend install --omit=dev
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix mcp install --omit=dev
```

### 3. Environment

`backend/.env` — see `backend/.env.example`. Set:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://cargos:…@127.0.0.1:5432/cargos
JWT_SECRET=long-random-string
PUBLIC_URL=https://cargos.pro
```

`mcp/.env`:

```
NODE_ENV=production
CARGOS_API_URL=http://127.0.0.1:3000
CARGOS_API_KEY=ck_live_…
MCP_TRANSPORT=http
MCP_PORT=3100
MCP_BIND=127.0.0.1
MCP_AUTH_PATH=/var/lib/cargos/mcp-auth.json
MCP_SHARED_SECRET=long-random-string
```

`CARGOS_API_URL` is loopback so MCP talks to the API on the same machine. `MCP_SHARED_SECRET` is what Cursor sends; it is not the Cargos API key.

```bash
chmod 600 backend/.env mcp/.env
```

### 4. PM2

```bash
cd /opt/cargos.pro
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` prints a systemd command — run it so the API and MCP come back after reboot.

```bash
pm2 status
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3100/health
```

### 5. Nginx + TLS

```bash
sudo cp deploy/nginx/cargos.pro.conf /etc/nginx/sites-available/cargos.pro
sudo ln -sf /etc/nginx/sites-available/cargos.pro /etc/nginx/sites-enabled/cargos.pro
sudo nginx -t
sudo certbot --nginx -d cargos.pro
sudo systemctl reload nginx
```

Point DNS for `cargos.pro` at this server before Certbot.

### 6. Connect Cursor (or any MCP client)

```json
{
  "mcpServers": {
    "cargos": {
      "url": "https://cargos.pro/mcp",
      "headers": {
        "Authorization": "Bearer long-random-string"
      }
    }
  }
}
```

Use the same string as `MCP_SHARED_SECRET`. The Cargos write key never leaves the server.

### After a code update

```bash
cd /opt/cargos.pro && git pull
npm --prefix backend install --omit=dev
npm --prefix frontend install && npm --prefix frontend run build
npm --prefix mcp install --omit=dev
pm2 restart cargos-api cargos-mcp
```

## Environment

| Variable | Purpose |
| --- | --- |
| `CARGOS_API_URL` | Cargos API origin (`http://127.0.0.1:3000` in production) |
| `CARGOS_API_KEY` | Long-lived write key (`ck_live_…`) |
| `CARGOS_TOKEN` | Alternate bearer token (JWT expires in 7 days) |
| `CARGOS_EMAIL` / `CARGOS_PASSWORD` | Optional one-time login at start |
| `MCP_AUTH_PATH` | File for the minted key |
| `MCP_TRANSPORT` | `stdio` or `http` |
| `MCP_PORT` | HTTP port (default `3100`) |
| `MCP_BIND` | Listen address (default `127.0.0.1`) |
| `MCP_SHARED_SECRET` | Bearer required on `/mcp` |

## Inspect (local)

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

# Cargos.pro

CRM and transport desk for European road-freight forwarders and carriers. A deal becomes an order, an order becomes one or more relations (own truck or a subcontracted carrier), a delivery becomes an invoice, and the margin stays on the order.

The interface follows the calm layout of the [Snow Dashboard UI Kit](https://snowui.framer.website/#pages): light canvas, a quiet sidebar, rounded cards, and pastel status chips. It is a product UI for this app, not a copy of that marketing site.

## Stack

- React (Vite) built to static files
- Node.js API (Express)
- PostgreSQL
- Docker Compose for local development
- Node + Nginx + Certbot on the host for production (`https://cargos.pro`)

## Local development

```bash
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:3010/api/health

Postgres stays on the Compose network. Reach it with `docker compose exec db psql -U cargos -d cargos`. The user and password are both `cargos`.

The first start installs npm dependencies inside the containers. The API reloads when backend files change. Vite reloads the UI.

Demo data is loaded only when `SEED_DEMO=true` (set in `docker-compose.yml`) and the database is empty. It is not loaded in production.

| Person | Email | Password | Seat |
| --- | --- | --- | --- |
| Anna Kowalska | anna@northlane.example | demo1234 | Owner |
| Marek Nowak | marek@northlane.example | demo1234 | Dispatcher |
| Ioana Popescu | ioana@northlane.example | demo1234 | Sales |
| Elena Ionescu | elena@northlane.example | demo1234 | Finance |
| Piotr Zieliński | piotr@northlane.example | demo1234 | Driver |

Piotr lands on the driver view: status buttons, a POD upload, and a signature pad. Office seats use the sidebar.

Create another workspace from the sign-in page. New workspaces get a 14-day trial. The demo workspace is already active.

Optional keys can be placed in a `.env` file next to `docker-compose.yml`. Compose reads them if they are exported in the shell or present in that file. See `.env.example`.

## What the app does

- Companies (customer, carrier, or both), contacts, and a saved address book
- Deal board and list, with fuel surcharge and distance as soon as origin and destination are set
- Convert a won deal into an order
- Orders with revenue, relation cost, and margin
- Dispatch board: drop an order on a vehicle or a carrier
- Fleet registry with insurance and inspection dates
- Invoices, aging, and mark-as-paid
- Documents on orders (CMR, POD, and the rest)
- Workflows: property change can create a task, an invoice draft, an email, or an SMS
- Reports for margin, invoice totals, and fleet status
- Team seats, per-tenant API keys (`ck_live_…`, read or write), and an audit log
- Stripe Checkout for seat and driver subscriptions when `STRIPE_SECRET_KEY` is set
- Driver mobile view

Distance uses Google Distance Matrix when `GOOGLE_MAPS_API_KEY` is set. Otherwise it uses a road estimate for a built-in list of European cities, and the screen says which one it is.

Gmail, Google Calendar, and QuickBooks connect only when their OAuth client id and secret are set. Twilio sends SMS only when its credentials are set. Until then, email and SMS actions are written on the record timeline and the screen says they were not sent. Nothing is marked connected just because the button exists.

Out of the box, the demo workspace runs three workflows:

- Order status becomes Delivered → finance task and a draft invoice
- Invoice becomes overdue → finance task and a reminder email (logged until Gmail is connected)
- Deal is won → dispatcher task

A background pass every five minutes marks sent invoices overdue and opens a task when a vehicle document expires within 30 days.

## API

Bearer authentication. Browser sessions use a JWT. External tools use an API key from Settings. Send it as `Authorization: Bearer ck_live_…`.

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| CRM | `/api/companies`, `/api/contacts`, `/api/deals`, `POST /api/deals/:id/convert`, `/api/addresses` |
| Transport | `/api/orders`, `POST /api/orders/:id/clone`, `POST /api/orders/:id/invoice`, `/api/dispatch`, `POST /api/routing/estimate` |
| Driver | `GET /api/driver/assignments`, `POST /api/driver/relations/:id/status`, POD and signature uploads |
| Fleet | `/api/vehicles`, `/api/drivers` |
| Finance | `/api/invoices`, `/api/invoices/aging`, `POST /api/invoices/:id/quickbooks` |
| Platform | `/api/dashboard`, `/api/reports`, `/api/search`, `/api/activities`, `/api/workflows`, `/api/documents`, `/api/users`, `/api/api-keys`, `/api/integrations`, `/api/billing`, `/api/audit` |

Money is integer cents. Create an order with `priceCents`, not a decimal string.

Driver seats cannot call the office API. Read-only API keys cannot call anything except GET and HEAD.

## Production

Production is **not** Docker. **PM2** runs the frontend, API, and MCP. Host Nginx terminates TLS for `https://cargos.pro`.

| URL | PM2 app | Port |
| --- | --- | --- |
| `https://cargos.pro` | `cargos-web` | `127.0.0.1:4173` |
| `https://cargos.pro/api/` | `cargos-api` | `127.0.0.1:3000` |
| `https://cargos.pro/mcp` | `cargos-mcp` | `127.0.0.1:3100` |

```bash
npm --prefix frontend run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
sudo cp deploy/nginx/cargos.pro.conf /etc/nginx/sites-available/cargos.pro
sudo ln -sf /etc/nginx/sites-available/cargos.pro /etc/nginx/sites-enabled/cargos.pro
sudo certbot --nginx -d cargos.pro
```

Full MCP env, secrets, and the Cursor URL are in `mcp/README.md`.

Set `PUBLIC_URL=https://cargos.pro`.

- Stripe webhook: `https://cargos.pro/api/billing/webhook`
- Google OAuth: `https://cargos.pro/api/integrations/google/callback`
- QuickBooks OAuth: `https://cargos.pro/api/integrations/quickbooks/callback`

## Layout

```
backend/          Node API, SQL schema, demo seed
frontend/         React app
mcp/              MCP server (https://cargos.pro/mcp)
ecosystem.config.cjs  PM2: api, web, mcp
deploy/           Host Nginx
docker-compose.yml   Local development only
```

## Scope

This is the first loop from the product plan: CRM objects, dispatch, driver capture, invoicing, a small workflow engine, and the billing and integration hooks. A visual workflow canvas, live telematics, Trans.eu, HubSpot sync, and KSeF are later phases. Connectors stay dark until their credentials are present and a real call succeeds.

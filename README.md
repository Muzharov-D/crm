# CRM

Sales CRM (leads, companies, deals, follow-ups, forecasts) on its own server.
The app comes from [HeyPuter/everything](https://github.com/HeyPuter/everything)
(`src/crm`, MIT); here the Puter cloud is replaced by our server.

- `server/` — Express: sign-in, data (KV), files (attachments and backups).
  Postgres when `DATABASE_URL` is set, otherwise files in `data/`.
- `public/platform.js` — the part of the Puter SDK the app uses (`auth`, `kv`, `fs`),
  answered by our server. AI assist is off: `puter.ai` is not provided.

## Local

```sh
npm install
npm run build
npm start          # http://localhost:8790, settings in .env
```

`.env` (not in git):

```
CRM_USERS=owner:password:admin;sales:password:manager;guest:password:viewer
SESSION_SECRET=<random string>
PORT=8790
```

### Roles and audit

`CRM_USERS` is a semicolon-separated list of `login:password:role` entries:

- `admin` — full access and the administrative change journal at `#/audit`;
- `manager` — create and edit CRM data, without access to the journal;
- `viewer` — read-only access, including server-side rejection of every write.

The legacy `login:password` format remains valid and grants `admin` for
backward compatibility. Passwords may contain colons: only a final segment
exactly matching `admin`, `manager`, or `viewer` is parsed as the role.
Use a unique random `SESSION_SECRET` in production and never commit `.env`.

The server records create, update, delete, and document-upload events with
actor, timestamp, record, and changed field names. The journal retains the
latest 500 events and cannot be overwritten through the public data API.

### ABR qualification and forecasts

In **Settings → Pipeline stages**, **Apply ABR** installs the S0–S7 funnel and
moves deals from the original stages to their corresponding ABR stages. Deal
forms contain evidence-based qualification: client team, economic buyer,
champion, external deadline, client investment, budget, purchase type,
competitors, next step, and manager confidence. A named fact counts as 1, a
value beginning with `?` as 0.5, and a blank as 0.

**Settings → Forecast and qualification** selects stage-based, manager-based,
or model-based weighting. The model combines stage probability, qualification
quality, and risk penalties; the same mode is used by the dashboard, pipeline,
and monthly forecast.

Without `DATABASE_URL`, data goes to `data/`. For live front-end edits run
`npm start` and `npm run dev` side by side (http://localhost:5274, API proxied).

## Vercel

Production: https://crm-muzharov-dmitrys-projects-ccf03ba0.vercel.app (project
`crm-muzharov`, Neon database `crm-db` in fra1). A push to `main` deploys.
Commits must be authored as Muzharov26@icloud.com, otherwise Vercel blocks the deploy.

`api/index.js` runs `server/app.js` as a function; the built app is static.
Project environment: `DATABASE_URL` (Postgres, e.g. Neon from the Vercel
Storage tab), `CRM_USERS`, `SESSION_SECRET`, `VITE_MAX_FILE_MB=4` (Vercel
rejects request bodies over 4.5 MB, so attachments are capped at 4 MB).

## Timeweb (or any server with Docker)

`docker-compose.yml`: Caddy (HTTPS, ports 80/443), the app, Postgres
(internal network only). Point the domain's A record at the server first,
otherwise Caddy cannot get a certificate. A standalone container starts in
preview mode with the test roles from `.env.example` and a random session
secret; Compose disables that mode and requires the production secrets below.

```sh
git clone <repo> crm && cd crm
cp .env.example .env    # fill DOMAIN, CRM_USERS, SESSION_SECRET, POSTGRES_PASSWORD
docker compose up -d --build
```

Update: `git pull && docker compose up -d --build`.

Database dump: `docker compose exec db pg_dump -U crm crm > backups/crm-$(date +%F).sql`.

All users of one server share the same data.

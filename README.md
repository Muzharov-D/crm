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
CRM_USERS=login:password;login2:password2
SESSION_SECRET=<random string>
PORT=8790
```

Without `DATABASE_URL`, data goes to `data/`. For live front-end edits run
`npm start` and `npm run dev` side by side (http://localhost:5274, API proxied).

## Render

`render.yaml` creates the web service and a Postgres database in Frankfurt.
After the first deploy, set `CRM_USERS` in the service environment.

All users of one server share the same data.

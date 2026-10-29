/**
 * The whole CRM on one port: the API from server/app.js plus the built app.
 *   PORT  listen port (default 8790)
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, storageKind } from './app.js';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8790;

/* The service worker must always be revalidated. */
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'sw.js'));
});
app.use(express.static(dist, { index: 'index.html' }));

app.listen(PORT, () => {
  console.log(`CRM on http://localhost:${PORT} (storage: ${storageKind})`);
});

/** Container entry point: an isolated preview can start without a local .env. */
import crypto from 'node:crypto';

if (process.env.CRM_PREVIEW === 'true') {
  process.env.CRM_USERS ||= [
    'admin:CRM-admin-2026:admin',
    'manager:CRM-manager-2026:manager',
    'viewer:CRM-viewer-2026:viewer',
  ].join(';');
  // Random on every container start; real deployments must provide their own.
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
}

await import('./index.js');

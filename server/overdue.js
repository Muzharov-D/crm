import { projectOverdue } from '../src/lib/deal-workflow.js';

const STEPS_KEY = 'crm:deal-steps:v1';
const NOTES_KEY = 'crm:deal-notifications:v1';

export async function runOverdue(storage, now = new Date()) {
  const [stepsRaw, notesRaw] = await Promise.all([storage.kvGet(STEPS_KEY), storage.kvGet(NOTES_KEY)]);
  if (!stepsRaw) return { changed: false, active: 0 };
  const steps = JSON.parse(stepsRaw);
  const notifications = notesRaw ? JSON.parse(notesRaw) : [];
  const projected = projectOverdue(Array.isArray(steps) ? steps : [], Array.isArray(notifications) ? notifications : [], now);
  const changed = JSON.stringify(projected.steps) !== stepsRaw
    || JSON.stringify(projected.notifications) !== (notesRaw || '[]');
  if (changed) {
    await storage.kvTransaction([
      { key: STEPS_KEY, change: () => JSON.stringify(projected.steps) },
      { key: NOTES_KEY, change: () => JSON.stringify(projected.notifications) },
    ]);
  }
  return { changed, active: projected.notifications.filter((row) => row.active).length, at: now.toISOString() };
}

export function startOverdueScheduler(storage) {
  const run = () => runOverdue(storage).catch((error) => console.error('overdue:', error));
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

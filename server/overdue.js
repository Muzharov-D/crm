import { projectOverdue } from '../src/lib/deal-workflow.js';

const TASKS_KEY = 'crm:tasks:v1';
const STEPS_KEY = 'crm:deal-steps:v1';
const NOTES_KEY = 'crm:deal-notifications:v1';

export async function runOverdue(storage, now = new Date()) {
  const [tasksRaw, stepsRaw, notesRaw] = await Promise.all([
    storage.kvGet(TASKS_KEY), storage.kvGet(STEPS_KEY), storage.kvGet(NOTES_KEY),
  ]);
  if (!tasksRaw && !stepsRaw) return { changed: false, active: 0 };
  const parsedTasks = tasksRaw ? JSON.parse(tasksRaw) : [];
  const tasks = Array.isArray(parsedTasks) ? parsedTasks : [];
  const steps = stepsRaw ? JSON.parse(stepsRaw) : [];
  // A cron may run before the first client opens the new version. Project a
  // legacy active step into the same task id, without creating a duplicate.
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step?.status !== 'active' || tasks.some((task) => task.id === step.id || task.legacyStepId === step.id)) continue;
    tasks.push({
      ...step, title: step.action, status: 'К выполнению', done: false,
      isNextStep: true, legacyStepId: step.id,
    });
  }
  const notifications = notesRaw ? JSON.parse(notesRaw) : [];
  const projected = projectOverdue(tasks, Array.isArray(notifications) ? notifications : [], now);
  const serializedTasks = JSON.stringify(projected.tasks);
  const serializedNotes = JSON.stringify(projected.notifications);
  const changed = serializedTasks !== (tasksRaw || '[]') || serializedNotes !== (notesRaw || '[]');
  if (changed) {
    await storage.kvTransaction([
      { key: TASKS_KEY, change: () => serializedTasks },
      { key: NOTES_KEY, change: () => serializedNotes },
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

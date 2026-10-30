import { describe, it, expect } from 'vitest';
import {
  MODULES, BLOCKS, workspaceOf, routeEnabled, homeHash, WORKSPACE_PRESETS,
} from '../src/lib/workspace.js';
import { normalizeEmployee } from '../src/lib/mvp.js';

 describe('workspace controls', () => {
  it('keeps every existing module and block enabled by default', () => {
    const workspace = workspaceOf({});
    expect(Object.keys(workspace.modules)).toHaveLength(MODULES.length);
    expect(Object.keys(workspace.blocks)).toHaveLength(BLOCKS.length);
    expect(Object.values(workspace.modules).every(Boolean)).toBe(true);
    expect(Object.values(workspace.blocks).every(Boolean)).toBe(true);
  });

  it('blocks direct routes and respects route aliases', () => {
    const settings = { workspace: { modules: { reports: false, companies: false, tasks: false } } };
    expect(routeEnabled(settings, 'forecast')).toBe(false);
    expect(routeEnabled(settings, 'contacts')).toBe(false);
    expect(routeEnabled(settings, 'followups')).toBe(false);
    expect(routeEnabled(settings, 'pipeline')).toBe(true);
    expect(routeEnabled(settings, 'settings')).toBe(true);
    expect(routeEnabled(settings, 'control')).toBe(true);
  });

  it('falls back to an enabled home module', () => {
    expect(homeHash({ workspace: { home: 'dashboard', modules: { dashboard: false, pipeline: true } } })).toBe('#/pipeline');
    expect(homeHash({ workspace: { home: 'reports' } })).toBe('#/forecast');
    expect(homeHash({ workspace: { modules: Object.fromEntries(MODULES.map((m) => [m.key, false])) } })).toBe('#/settings');
  });

  it('offers complete preset maps without deleting saved preferences', () => {
    const previous = workspaceOf({ workspace: { density: 'compact' } });
    const preset = WORKSPACE_PRESETS.find((p) => p.key === 'executive');
    const next = workspaceOf({ workspace: { ...previous, modules: { ...previous.modules, ...preset.modules }, blocks: { ...previous.blocks, ...preset.blocks } } });
    expect(next.density).toBe('compact');
    expect(next.modules.reports).toBe(true);
    expect(next.modules.leads).toBe(false);
    expect(next.blocks.quickCreate).toBe(false);
  });

  it('treats legacy employees as active and preserves explicit deactivation', () => {
    expect(normalizeEmployee({ name: 'Анна' }).active).toBe(true);
    expect(normalizeEmployee({ name: 'Анна', active: false }).active).toBe(false);
  });
});

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addPlanItem,
  clearPlan,
  emptyPlan,
  formatPlan,
  loadPlan,
  removePlanItem,
  savePlan,
  setPlanItemStatus,
} from '../../src/storage/plan-store.js';

describe('plan-store', () => {
  it('round-trips a plan through save/load', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-plan-'));
    const file = path.join(dir, 'sess.plan.json');
    try {
      let plan = emptyPlan('sess', 'Migration roadmap');
      ({ plan } = addPlanItem(plan, 'Audit database schema'));
      ({ plan } = addPlanItem(plan, 'Write migration scripts', 'idempotent + reversible'));
      await savePlan(file, plan);

      const loaded = await loadPlan(file);
      expect(loaded?.title).toBe('Migration roadmap');
      expect(loaded?.items).toHaveLength(2);
      expect(loaded?.items[0]?.title).toBe('Audit database schema');
      expect(loaded?.items[1]?.details).toBe('idempotent + reversible');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('updates and removes by index', () => {
    let plan = emptyPlan('s');
    ({ plan } = addPlanItem(plan, 'one'));
    ({ plan } = addPlanItem(plan, 'two'));
    plan = setPlanItemStatus(plan, '2', 'done');
    expect(plan.items[1]?.status).toBe('done');
    plan = removePlanItem(plan, '1');
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.title).toBe('two');
  });

  it('formatPlan renders status marks', () => {
    let plan = emptyPlan('s');
    ({ plan } = addPlanItem(plan, 'alpha'));
    ({ plan } = addPlanItem(plan, 'beta'));
    plan = setPlanItemStatus(plan, '2', 'in_progress');
    const out = formatPlan(plan);
    expect(out).toContain('[ ] alpha');
    expect(out).toContain('[~] beta');
  });

  it('clearPlan empties items', () => {
    let plan = emptyPlan('s');
    ({ plan } = addPlanItem(plan, 'x'));
    plan = clearPlan(plan);
    expect(plan.items).toEqual([]);
  });

  it('loadPlan returns null on missing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-plan-'));
    try {
      expect(await loadPlan(path.join(dir, 'no.json'))).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

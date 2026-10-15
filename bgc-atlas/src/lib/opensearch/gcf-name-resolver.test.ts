import { describe, it, expect, vi } from 'vitest';
import type { FilterGroup } from '@/lib/filters/types';
import { collectGcfNames, resolveGcfNames } from '@/lib/opensearch/gcf-name-resolver';

const UUID_A = '01d66fba-f681-595f-bb8f-82f1e9e1489d';
const UUID_B = 'fd788842-04ff-50e9-8fca-bc46a6ef0c9e';

const group = (partial: Partial<FilterGroup>): FilterGroup => ({
  id: 'g', operator: 'AND', conditions: [], groups: [], ...partial,
});
const cond = (field: string, value: unknown, operator = 'in') =>
  ({ id: 'c', field, operator, value } as FilterGroup['conditions'][number]);

const lookup = (map: Record<string, string>) =>
  vi.fn(async (names: string[]) =>
    new Map(names.flatMap((n) => (map[n] ? [[n, map[n]] as [string, string]] : []))));

describe('collectGcfNames', () => {
  it('collects non-UUID gcf_id values, deduped, across nested groups', () => {
    const g = group({
      conditions: [cond('gcf_id', ['GCF-04-000042', 'GCF-CC-04-400017'])],
      groups: [group({ id: 'g2', conditions: [cond('gcf_id', 'GCF-04-000042')] })],
    });
    expect(collectGcfNames(g).sort()).toEqual(['GCF-04-000042', 'GCF-CC-04-400017']);
  });

  it('ignores values that are already UUIDs', () => {
    expect(collectGcfNames(group({ conditions: [cond('gcf_id', [UUID_A])] }))).toEqual([]);
  });

  it('ignores other fields that happen to hold GCF-shaped strings', () => {
    expect(collectGcfNames(group({ conditions: [cond('sample_name', 'GCF-04-000042')] })))
      .toEqual([]);
  });
});

describe('resolveGcfNames', () => {
  it('substitutes the UUID for a resolved name', async () => {
    const g = group({ conditions: [cond('gcf_id', ['GCF-04-000042'])] });
    const out = await resolveGcfNames(g, lookup({ 'GCF-04-000042': UUID_A }));
    expect(out!.conditions[0].value).toEqual([UUID_A]);
  });

  it('preserves a single (non-array) value as a single value', async () => {
    const g = group({ conditions: [cond('gcf_id', 'GCF-04-000042', 'equals')] });
    const out = await resolveGcfNames(g, lookup({ 'GCF-04-000042': UUID_A }));
    expect(out!.conditions[0].value).toBe(UUID_A);
  });

  it('passes a pasted UUID straight through without a lookup', async () => {
    const fn = lookup({});
    const g = group({ conditions: [cond('gcf_id', [UUID_A])] });
    const out = await resolveGcfNames(g, fn);
    expect(out!.conditions[0].value).toEqual([UUID_A]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('leaves an unresolvable name in place so it matches no UUID', async () => {
    const g = group({ conditions: [cond('gcf_id', ['GCF-04-999999'])] });
    const out = await resolveGcfNames(g, lookup({}));
    expect(out!.conditions[0].value).toEqual(['GCF-04-999999']);
  });

  it('resolves the names it can and leaves the rest', async () => {
    const g = group({ conditions: [cond('gcf_id', ['GCF-04-000042', 'GCF-04-999999'])] });
    const out = await resolveGcfNames(g, lookup({ 'GCF-04-000042': UUID_A }));
    expect(out!.conditions[0].value).toEqual([UUID_A, 'GCF-04-999999']);
  });

  it('resolves inside nested groups', async () => {
    const g = group({
      groups: [group({ id: 'g2', conditions: [cond('gcf_id', ['GCF-04-000042'])] })],
    });
    const out = await resolveGcfNames(g, lookup({ 'GCF-04-000042': UUID_A }));
    expect(out!.groups[0].conditions[0].value).toEqual([UUID_A]);
  });

  it('leaves conditions on other fields untouched', async () => {
    const g = group({
      conditions: [cond('gcf_id', ['GCF-04-000042']), cond('pfam', ['PF00109'])],
    });
    const out = await resolveGcfNames(g, lookup({ 'GCF-04-000042': UUID_B }));
    expect(out!.conditions[1]).toEqual(g.conditions[1]);
  });

  it('does not hit the lookup when there is nothing to resolve', async () => {
    const fn = lookup({});
    const g = group({ conditions: [cond('pfam', ['PF00109'])] });
    const out = await resolveGcfNames(g, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(out).toBe(g);           // same reference — no needless clone
  });

  it('handles a null group', async () => {
    expect(await resolveGcfNames(null, lookup({}))).toBeNull();
  });
});

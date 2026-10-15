// The Property Search builder edits a flat list of rows joined by per-row AND/OR;
// they are converted to FilterGroup at the edges. AND binds before OR, as in SQL.
import {
  createDefaultFilterGroup, isBlankFilterValue,
  type FilterCondition, type FilterGroup,
} from './types';

export type Join = 'AND' | 'OR';

export type FilterRow =
  | { kind: 'condition'; id: string; join: Join; condition: FilterCondition }
  | { kind: 'group'; id: string; join: Join; rows: FilterRow[] };

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2));

export const conditionRow = (condition: FilterCondition, join: Join = 'AND'): FilterRow =>
  ({ kind: 'condition', id: newId(), join, condition });

export const groupRow = (rows: FilterRow[], join: Join = 'AND'): FilterRow =>
  ({ kind: 'group', id: newId(), join, rows });

/** Split rows at their ORs: each run is ANDed, the runs are ORed. */
export const runsOf = (rows: FilterRow[]): FilterRow[][] => {
  const runs: FilterRow[][] = [];
  rows.forEach((row, i) => {
    if (i === 0 || row.join === 'OR') runs.push([]);
    runs[runs.length - 1].push(row);
  });
  return runs;
};

const isGroup = (it: FilterCondition | FilterGroup): it is FilterGroup => 'groups' in it;

// FilterGroup keeps conditions and groups in separate lists, which would move a
// condition written after a bracket above it; in that case every item becomes a group.
const groupOf = (operator: Join, items: Array<FilterCondition | FilterGroup>): FilterGroup => {
  const firstGroup = items.findIndex(isGroup);
  const reorders = firstGroup >= 0 && items.slice(firstGroup).some((it) => !isGroup(it));
  if (reorders) {
    return {
      ...createDefaultFilterGroup(),
      operator,
      conditions: [],
      groups: items.map((it) => (isGroup(it) ? it : { ...createDefaultFilterGroup(), conditions: [it] })),
    };
  }
  return {
    ...createDefaultFilterGroup(),
    operator,
    conditions: items.filter((it): it is FilterCondition => !isGroup(it)),
    groups: items.filter(isGroup),
  };
};

const itemOf = (row: FilterRow): FilterCondition | FilterGroup =>
  (row.kind === 'condition' ? row.condition : rowsToGroup(row.rows));

export function rowsToGroup(rows: FilterRow[]): FilterGroup {
  const runs = runsOf(rows);
  if (runs.length <= 1) return groupOf('AND', (runs[0] ?? []).map(itemOf));
  return groupOf('OR', runs.map((run) => (run.length === 1 ? itemOf(run[0]) : groupOf('AND', run.map(itemOf)))));
}

// Inverse of rowsToGroup: same-operator nesting is flattened so a tree written by
// rowsToGroup comes back as the rows that wrote it.
export function groupToRows(group: FilterGroup | null | undefined): FilterRow[] {
  if (!group) return [];
  const op: Join = group.operator === 'OR' ? 'OR' : 'AND';
  const out: FilterRow[] = [];
  const push = (row: FilterRow) => { out.push({ ...row, join: out.length ? row.join : 'AND' }); };

  const alternatives: FilterRow[][] = [
    ...(group.conditions ?? []).map((c) => [conditionRow(c)]),
    ...(group.groups ?? []).map((child) => childRows(child, op)),
  ].filter((rows) => rows.length);

  alternatives.forEach((rows) => {
    rows.forEach((row, i) => push({ ...row, join: i === 0 ? op : row.join }));
  });
  return out;
}

function childRows(child: FilterGroup, parentOp: Join): FilterRow[] {
  const op: Join = child.operator === 'OR' ? 'OR' : 'AND';
  const size = (child.conditions?.length ?? 0) + (child.groups?.length ?? 0);
// AND inside OR needs no brackets: AND-before-OR already reads it that way.
  if (op === parentOp || size <= 1 || (op === 'AND' && parentOp === 'OR')) return groupToRows(child);
  const inner = groupToRows(child);
  return inner.length ? [groupRow(inner)] : [];
}

export const rowsHaveRules = (rows: FilterRow[]): boolean => rows.some((row) => (row.kind === 'condition'
  ? !isBlankFilterValue(row.condition.value)
  : rowsHaveRules(row.rows)));

export const pruneRows = (rows: FilterRow[]): FilterRow[] => rows.flatMap((row): FilterRow[] => {
  if (row.kind === 'condition') return isBlankFilterValue(row.condition.value) ? [] : [row];
  const inner = pruneRows(row.rows);
  return inner.length ? [{ ...row, rows: inner }] : [];
});

export type SummaryPart =
  | { kind: 'text'; value: string }
  | { kind: 'op'; value: Join }
  | { kind: 'paren'; value: '(' | ')' };

export interface SummaryLine { joiner: Join | null; parts: SummaryPart[] }

// One line per top-level item while all rows are ANDed; once an OR appears, one
// line per alternative with the brackets AND-before-OR implies.
export function summarizeRows(rows: FilterRow[], describe: (c: FilterCondition) => string): SummaryLine[] {
  const pruned = pruneRows(rows);
  const op = (value: Join): SummaryPart => ({ kind: 'op', value });
  const paren = (value: '(' | ')'): SummaryPart => ({ kind: 'paren', value });

  const itemParts = (row: FilterRow): SummaryPart[] => {
    if (row.kind === 'condition') return [{ kind: 'text', value: describe(row.condition) }];
    const inner = expression(row.rows);
    return countItems(row.rows) > 1 ? [paren('('), ...inner, paren(')')] : inner;
  };
  const runParts = (run: FilterRow[], bracket: boolean): SummaryPart[] => {
    const parts = run.flatMap((row, i) => [...(i ? [op('AND')] : []), ...itemParts(row)]);
    return bracket && run.length > 1 ? [paren('('), ...parts, paren(')')] : parts;
  };
  function expression(list: FilterRow[]): SummaryPart[] {
    const runs = runsOf(list);
    return runs.flatMap((run, i) => [...(i ? [op('OR')] : []), ...runParts(run, runs.length > 1)]);
  }

  const runs = runsOf(pruned);
  if (runs.length <= 1) {
    return pruned.map((row, i) => ({ joiner: i ? 'AND' : null, parts: itemParts(row) }));
  }
  return runs.map((run, i) => ({ joiner: i ? 'OR' : null, parts: runParts(run, true) }));
}

const countItems = (rows: FilterRow[]) => pruneRows(rows).length;

export function rowsExpression(rows: FilterRow[], describe: (c: FilterCondition) => string): SummaryPart[] {
  return summarizeRows(rows, describe).flatMap((l, i) => [
    ...(i ? [{ kind: 'op' as const, value: l.joiner ?? 'AND' }] : []),
    ...l.parts,
  ]);
}

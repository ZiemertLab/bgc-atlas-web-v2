'use client';

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConditionRow } from '@/components/ui/filter-builder/condition-row';
import {
  createDefaultCondition, describeFilterGroup, type FilterCondition, type FilterFieldDefinition,
} from '@/lib/filters/types';
import {
  conditionRow, groupRow, summarizeRows, type FilterRow, type Join, type SummaryPart,
} from '@/lib/filters/rows';

interface QueryRowsProps {
  fields: FilterFieldDefinition[];
  rows: FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  /** Inside a group: no "+ Add group" (groups nest one level). */
  nested?: boolean;
  onRemoveGroup?: () => void;
}

/** One line per condition, each led by its own AND/OR. AND binds before OR (lib/filters/rows.ts). */
export function QueryRows({ fields, rows, onChange, nested = false, onRemoveGroup }: QueryRowsProps) {
  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const replace = (index: number, next: FilterRow | null) => {
    const copy = [...rows];
    if (next) copy[index] = next; else copy.splice(index, 1);
    onChange(copy);
  };
  // A new row joins the way the last one did.
  const lastJoin: Join = rows.length > 1 ? rows[rows.length - 1].join : 'AND';
  const addCondition = () => onChange([...rows, conditionRow(createDefaultCondition(fields[0]), lastJoin)]);
  const addGroup = () => onChange([...rows, groupRow([conditionRow(createDefaultCondition(fields[0]))], 'AND')]);

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2">
          {index === 0 ? <span /> : (
            <Select value={row.join} onValueChange={(join: Join) => replace(index, { ...row, join })}>
              <SelectTrigger className="h-8 px-2 text-xs font-semibold text-muted-foreground" aria-label="Join with the row above">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          )}
          {row.kind === 'condition' ? (
            <ConditionRow
              plain
              condition={row.condition}
              fields={fields}
              fieldMap={fieldMap}
              onChange={(partial) => replace(index, { ...row, condition: { ...row.condition, ...partial } as FilterCondition })}
              onRemove={() => replace(index, null)}
            />
          ) : (
            <div className="rounded-sm border bg-muted/60 p-3">
              <QueryRows
                fields={fields}
                rows={row.rows}
                nested
                onChange={(inner) => replace(index, inner.length ? { ...row, rows: inner } : null)}
                onRemoveGroup={() => replace(index, null)}
              />
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addCondition}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
        </Button>
        {nested ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemoveGroup}>Remove group</Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={addGroup}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add group
          </Button>
        )}
      </div>
    </div>
  );
}

/** One condition in the Summary's words ("Category in RiPP", option labels not values). */
export function useDescribeCondition(fields: FilterFieldDefinition[]) {
  return useMemo(() => (condition: FilterCondition) => describeFilterGroup(
    { id: 'one', operator: 'AND', conditions: [condition], groups: [] }, fields,
  )[0]?.parts.map((p) => p.value).join(' ') ?? '', [fields]);
}

export function SummaryParts({ parts }: { parts: SummaryPart[] }) {
  return (
    <>
      {parts.map((part, i) => (part.kind === 'op' ? (
        // Real spaces, not margin, so a copied summary reads "a OR b".
        <span key={i}>{' '}<span className="text-[11px] font-semibold tracking-wide text-muted-foreground">{part.value}</span>{' '}</span>
      ) : part.kind === 'paren' ? (
        <span key={i} className="font-medium text-muted-foreground">{part.value}</span>
      ) : <span key={i}>{part.value}</span>))}
    </>
  );
}

export interface SummaryRow { joiner: Join | null; lead?: string; parts: SummaryPart[] }

/** Today's Summary format: a join column, then the item. */
export function QuerySummary({ lines }: { lines: SummaryRow[] }) {
  if (!lines.length) return null;
  return (
    <div className="border-t bg-muted/40 px-4 py-3 text-sm">
      <p className="section-label mb-1.5">Summary</p>
      <div className="space-y-0.5">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="w-9 shrink-0 pt-px text-[11px] font-semibold tracking-wide text-muted-foreground">{line.joiner}</span>
            <span className="min-w-0 break-words">
              {line.lead}
              <SummaryParts parts={line.parts} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const rowsSummary = (rows: FilterRow[], describe: (c: FilterCondition) => string): SummaryRow[] =>
  summarizeRows(rows, describe);

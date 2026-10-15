'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { FilterFieldDefinition, FilterGroup } from '@/lib/filters/types';
import { countFilterRules, describeFilterGroup, hasFilterRules, serializeFilterGroup } from '@/lib/filters/types';
import type { FilterRecipe } from '@/lib/filters/recipes';
import { FilterGroupEditor } from './group-editor';
import { SavedFiltersPanel } from './saved-filters-panel';

type FilterBuilderProps = {
  fields: FilterFieldDefinition[];
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
  recipes?: FilterRecipe[];
  storageKey?: string;
  /** Passed to SavedFiltersPanel; see there. */
  showShare?: boolean;
  /** Replaces "add at least one" where an empty filter is a complete answer. */
  emptyMessage?: string;
};

export function FilterBuilder({
  fields,
  value,
  onChange,
  recipes,
  storageKey = 'bgc-atlas-advanced-filters',
  showShare = true,
  emptyMessage,
}: FilterBuilderProps) {
  const fieldMap = useMemo(() => new Map(fields.map(field => [field.id, field])), [fields]);

  const hasRules = hasFilterRules(value);
  const lines = useMemo(() => describeFilterGroup(hasRules ? value : null, fields), [hasRules, value, fields]);
  const ruleCount = countFilterRules(hasRules ? value : null);
  const serializedFilters = useMemo(() => serializeFilterGroup(hasRules ? value : null), [hasRules, value]);

  if (!fields.length) {
    return (
      <div className="rounded-md border border-dashed border-muted p-4 text-sm text-muted-foreground">
        No filterable fields available.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SavedFiltersPanel
        fields={fields}
        value={value}
        hasRules={hasRules}
        serializedFilters={serializedFilters}
        recipes={recipes}
        storageKey={storageKey}
        onChange={onChange}
        showShare={showShare}
      />

      {hasRules && (
        <Card className="space-y-3 border border-dashed border-primary/40 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Summary</p>
            </div>
            <Badge variant="default">
              {`${ruleCount.toLocaleString()} active rule${ruleCount === 1 ? '' : 's'}`}
            </Badge>
          </div>
          <div className="space-y-1 text-sm text-foreground/90">
            {lines.map((line, index) => (
              <div key={index} className="flex gap-2">
                <span className="w-8 shrink-0 pt-px text-[11px] font-semibold tracking-wide text-muted-foreground">
                  {line.joiner}
                </span>
                <span className="min-w-0 break-words">
                  {line.parts.map((part, i) => (
                    part.kind === 'op' ? (
                      // Real spaces, not margin, so a copied summary reads "a OR b".
                      <span key={i}>
                        {' '}
                        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">{part.value}</span>
                        {' '}
                      </span>
                    ) : part.kind === 'paren' ? (
                      <span key={i} className="font-medium text-muted-foreground">{part.value}</span>
                    ) : (
                      <span key={i}>{part.value}</span>
                    )
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <FilterGroupEditor
        group={value}
        depth={0}
        fields={fields}
        fieldMap={fieldMap}
        onChange={onChange}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

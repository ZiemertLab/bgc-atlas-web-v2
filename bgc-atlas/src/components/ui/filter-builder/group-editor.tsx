'use client';

import { Layers, PlusCircle, Split, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterGroup,
} from '@/lib/filters/types';
import { createDefaultCondition, createDefaultFilterGroup } from '@/lib/filters/types';
import { ConditionRow } from './condition-row';

interface FilterGroupEditorProps {
  group: FilterGroup;
  depth: number;
  fields: FilterFieldDefinition[];
  fieldMap: Map<string, FilterFieldDefinition>;
  onChange: (group: FilterGroup) => void;
  onRemove?: () => void;
  /** Replaces the root group's empty-state text; see FilterBuilder. */
  emptyMessage?: string;
}

export function FilterGroupEditor({
  group,
  depth,
  fields,
  fieldMap,
  onChange,
  onRemove,
  emptyMessage,
}: FilterGroupEditorProps) {
  const setOperator = (operator: 'AND' | 'OR') => {
    onChange({ ...group, operator });
  };

  const addCondition = () => {
    const firstField = fields[0];
    const newCondition = createDefaultCondition(firstField);
    onChange({
      ...group,
      conditions: [...group.conditions, newCondition],
    });
  };

  const updateCondition = (conditionId: string, partial: Partial<FilterCondition>) => {
    onChange({
      ...group,
      conditions: group.conditions.map((condition) =>
        condition.id === conditionId ? { ...condition, ...partial } : condition
      ),
    });
  };

  const removeCondition = (conditionId: string) => {
    onChange({
      ...group,
      conditions: group.conditions.filter((condition) => condition.id !== conditionId),
    });
  };

  const addGroup = () => {
    const newGroup = createDefaultFilterGroup();
    if (!newGroup.conditions.length) {
      newGroup.conditions.push(createDefaultCondition(fields[0]));
    }
    onChange({
      ...group,
      groups: [...group.groups, newGroup],
    });
  };

  const updateChildGroup = (child: FilterGroup, index: number) => {
    onChange({
      ...group,
      groups: group.groups.map((existing, idx) => (idx === index ? child : existing)),
    });
  };

  const removeChildGroup = (index: number) => {
    onChange({
      ...group,
      groups: group.groups.filter((_, idx) => idx !== index),
    });
  };

  return (
    <Card className="space-y-4 border border-muted-foreground/30 bg-muted/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {depth === 0 ? (
            <>
              <Layers className="h-4 w-4 text-muted-foreground" />
              Root group
            </>
          ) : (
            <>
              <Split className="h-4 w-4 text-muted-foreground" />
              Nested group
            </>
          )}
        </div>
        <Select value={group.operator} onValueChange={(value: 'AND' | 'OR') => setOperator(value)}>
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">AND</SelectItem>
            <SelectItem value="OR">OR</SelectItem>
          </SelectContent>
        </Select>
        {depth > 0 && onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive">
            <Trash2 className="mr-1 h-4 w-4" />
            Remove group
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {group.conditions.map((condition) => (
          <ConditionRow
            key={condition.id}
            condition={condition}
            fields={fields}
            fieldMap={fieldMap}
            onChange={(partial) => updateCondition(condition.id, partial)}
            onRemove={() => removeCondition(condition.id)}
          />
        ))}
        {!group.conditions.length && (
          <div className="rounded border border-dashed border-muted px-3 py-2 text-sm text-muted-foreground">
            {(depth === 0 && emptyMessage) || 'No conditions. Add at least one to filter this group.'}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {group.groups.map((child, idx) => (
          <FilterGroupEditor
            key={child.id}
            group={child}
            depth={depth + 1}
            fields={fields}
            fieldMap={fieldMap}
            onChange={(updated) => updateChildGroup(updated, idx)}
            onRemove={() => removeChildGroup(idx)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={addCondition}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add condition
        </Button>
        <Button variant="outline" size="sm" onClick={addGroup}>
          <Split className="mr-2 h-4 w-4" />
          Add group
        </Button>
      </div>
    </Card>
  );
}

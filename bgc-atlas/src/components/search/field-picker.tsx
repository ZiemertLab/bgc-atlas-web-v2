'use client';

import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { FilterFieldDefinition } from '@/lib/filters/types';
import { FieldCombobox } from './field-combobox';

interface FieldPickerProps {
  fields: FilterFieldDefinition[];
  value?: string;
  onChange: (fieldId: string) => void;
  invalid?: boolean;
  wrap?: boolean;
}

/** Falls back to the single combobox when the field set has no groups. */
export function FieldPicker({ fields, value, onChange, invalid, wrap = false }: FieldPickerProps) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const f of fields) {
      const g = f.group ?? '';
      if (g && !seen.has(g)) {
        seen.add(g);
        order.push(g);
      }
    }
    return order;
  }, [fields]);

  if (!groups.length) {
    return <FieldCombobox fields={fields} value={value} onChange={onChange} invalid={invalid} />;
  }

  const selected = fields.find((f) => f.id === value);
  const currentGroup = selected?.group ?? groups[0];
  const fieldsInGroup = fields.filter((f) => (f.group ?? '') === currentGroup);

  const onGroupChange = (group: string) => {
    const first = fields.find((f) => (f.group ?? '') === group);
    if (first) onChange(first.id);
  };

  return (
    <div className={cn('flex items-center gap-2', wrap && 'min-w-0 max-w-full flex-wrap')}>
      <Select value={currentGroup} onValueChange={onGroupChange}>
        <SelectTrigger
          className={cn('h-8 min-w-[130px] text-xs', wrap && 'min-w-0 max-w-full', invalid && 'border-destructive')}
        >
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {groups.map((g) => (
            <SelectItem key={g} value={g}>{g}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selected?.id ?? ''} onValueChange={onChange}>
        <SelectTrigger
          aria-invalid={invalid ? true : undefined}
          className={cn(
            'h-8 min-w-[160px] text-xs',
            wrap && 'min-w-0 max-w-full',
            invalid && 'border-destructive text-destructive focus-visible:ring-destructive/30',
          )}
        >
          <SelectValue placeholder="Property" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {fieldsInGroup.map((f) => (
            <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

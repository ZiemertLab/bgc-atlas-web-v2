'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { FilterFieldDefinition } from '@/lib/filters/types';

interface FieldComboboxProps {
  fields: FilterFieldDefinition[];
  value?: string;
  onChange: (fieldId: string) => void;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}

export function FieldCombobox({ fields, value, onChange, invalid, placeholder = 'Field', className }: FieldComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = fields.find((f) => f.id === value);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? fields.filter((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      : fields;
    const groups = new Map<string, FilterFieldDefinition[]>();
    for (const f of matched) {
      const g = f.group ?? '';
      const list = groups.get(g);
      if (list) list.push(f);
      else groups.set(g, [f]);
    }
    return [...groups.entries()];
  }, [fields, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-invalid={invalid ? true : undefined}
          className={cn(
            'h-8 min-w-[180px] justify-between text-xs font-normal',
            invalid && 'border-destructive text-destructive focus-visible:ring-destructive/30',
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…"
            className="h-8 text-xs"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {grouped.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching fields</p>
          )}
          {grouped.map(([group, groupFields]) => (
            <div key={group || '_ungrouped'}>
              {group && (
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
              )}
              {groupFields.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { onChange(f.id); setOpen(false); setQuery(''); }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
                    f.id === value && 'bg-accent',
                  )}
                >
                  <span className="truncate">{f.label}</span>
                  {f.id === value && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronsUpDown, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { FilterFieldDefinition } from '@/lib/filters/types';

interface TieredFieldPickerProps {
  fields: FilterFieldDefinition[];
  onChange: (fieldId: string) => void;
  placeholder?: string;
  className?: string;
}

// Typing flattens both tiers into one filtered list. Kept separate from FieldCombobox so the
// query builder's flat picker is unaffected.
export function TieredFieldPicker({ fields, onChange, placeholder = 'Add a field…', className }: TieredFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const f of fields) {
      const g = f.group ?? 'Other';
      if (!seen.includes(g)) seen.push(g);
    }
    return seen;
  }, [fields]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? fields.filter((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) : []),
    [fields, q],
  );
  const inGroup = useMemo(
    () => (group ? fields.filter((f) => (f.group ?? 'Other') === group) : []),
    [fields, group],
  );

  const reset = () => { setQuery(''); setGroup(null); };
  const pick = (id: string) => { onChange(id); setOpen(false); reset(); };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox"
          className={cn('h-8 min-w-[200px] justify-between text-xs font-normal', className)}>
          <span className="truncate">{placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…" className="h-8 text-xs" />
        </div>

        <div className="max-h-[26rem] overflow-y-auto p-1">
          {q ? (
            matches.length ? matches.map((f) => (
              <button key={f.id} type="button" onClick={() => pick(f.id)}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
                <span className="truncate">{f.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{f.group}</span>
              </button>
            )) : <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matching fields.</p>
          ) : group ? (
            <>
              <button type="button" onClick={() => setGroup(null)}
                className="mb-1 flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-left text-xs font-medium hover:bg-accent">
                <ChevronLeft className="h-3.5 w-3.5" /> {group}
              </button>
              {inGroup.map((f) => (
                <button key={f.id} type="button" onClick={() => pick(f.id)}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 pl-4 text-left text-xs hover:bg-accent">
                  <span className="truncate">{f.label}</span>
                </button>
              ))}
            </>
          ) : (
            groups.map((g) => {
              const count = fields.filter((f) => (f.group ?? 'Other') === g).length;
              return (
                <button key={g} type="button" onClick={() => setGroup(g)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
                  <span className="truncate font-medium">{g}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    {count}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

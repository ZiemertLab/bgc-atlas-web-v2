'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
  /** Shown on the closed trigger instead of `label` (e.g. without the count). */
  shortLabel?: string;
}

interface OptionMultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (values: string[]) => void;
  invalid?: boolean;
}

export function OptionMultiSelect({ options, value, onChange, invalid }: OptionMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  // Labels, not raw values: a sentinel like `unknown` is an internal key.
  const named = (v: string) => {
    const o = options.find((x) => x.value === v);
    return o?.shortLabel ?? o?.label ?? v;
  };
  const label = value.length === 0
    ? 'Select values'
    : value.length <= 2 ? value.map(named).join(', ') : `${value.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-invalid={invalid ? true : undefined}
          className={cn(
            'h-8 w-48 justify-between text-xs font-normal',
            invalid && 'border-destructive text-destructive focus-visible:ring-destructive/30',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-48 overflow-y-auto p-1" align="start">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
            >
              <span className={cn(
                'flex h-3.5 w-3.5 items-center justify-center rounded border',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
              )}>
                {on && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="flex-1 truncate">{o.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

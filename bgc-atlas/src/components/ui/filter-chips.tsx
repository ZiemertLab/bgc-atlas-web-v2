"use client";

import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterChip {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  filters: FilterChip[];
  onClearAll?: () => void;
  className?: string;
}

export function FilterChips({ filters, onClearAll, className }: FilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="section-label mr-1">Active</span>
      {filters.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex max-w-full items-center gap-1 border border-border bg-card pl-1.5 pr-0.5 py-px text-[11px] leading-none text-foreground"
        >
          <span className="shrink-0 text-muted-foreground">{filter.label}:</span>{' '}
          <span className="min-w-0 truncate font-medium" title={filter.value}>
            {filter.value}
          </span>
          <button
            type="button"
            onClick={filter.onRemove}
            className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Remove ${filter.label} filter`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {filters.length > 1 && onClearAll && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

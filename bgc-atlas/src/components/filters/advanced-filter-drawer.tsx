"use client";

import { Button } from "@/components/ui/button";
import { FilterBuilder } from "@/components/ui/filter-builder";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FilterFieldDefinition, FilterGroup } from "@/lib/filters/types";
import type { FilterRecipe } from "@/lib/filters/recipes";

interface AdvancedFilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FilterFieldDefinition[];
  recipes?: FilterRecipe[];
  storageKey?: string;
  draft: FilterGroup;
  onDraftChange: (next: FilterGroup) => void;
  onApply: () => void;
  onClear: () => void;
  hasDraft: boolean;
  hasApplied: boolean;
  /** Shown as "N active". */
  appliedCount?: number;
}

export function AdvancedFilterDrawer({
  open,
  onOpenChange,
  fields,
  recipes,
  storageKey,
  draft,
  onDraftChange,
  onApply,
  onClear,
  hasDraft,
  hasApplied,
  appliedCount,
}: AdvancedFilterDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader className="flex-row items-start justify-between gap-4 pr-12">
          <div className="min-w-0 flex-1">
            <span className="section-label">Filter builder</span>
            <SheetTitle>Advanced filters</SheetTitle>
            <SheetDescription>
              Build or load a query, then apply.
            </SheetDescription>
          </div>
          <Button
            size="sm"
            onClick={onApply}
            disabled={!hasDraft}
            className="shrink-0"
          >
            Apply filters
          </Button>
        </SheetHeader>
        <SheetBody>
          <FilterBuilder
            fields={fields}
            value={draft}
            onChange={onDraftChange}
            recipes={recipes}
            storageKey={storageKey}
          />
        </SheetBody>
        <SheetFooter>
          <span className="mr-auto text-xs tabular-nums text-muted-foreground">
            {hasApplied && appliedCount !== undefined
              ? `${appliedCount} active`
              : hasDraft
              ? 'unapplied changes'
              : 'no rules'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!hasApplied && !hasDraft}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button size="sm" onClick={onApply} disabled={!hasDraft}>
            Apply filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

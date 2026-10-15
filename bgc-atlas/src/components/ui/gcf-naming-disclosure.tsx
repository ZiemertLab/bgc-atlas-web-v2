"use client";

import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GcfNamingLegend } from '@/components/ui/gcf-naming-legend';
import { cn } from '@/lib/utils';

// Uncontrolled: Radix stamps `data-state` on the trigger, so the chevron rotates from CSS.
export function GcfNamingDisclosure({ className }: { className?: string }) {
  return (
    <Collapsible className={cn('max-w-3xl', className)}>
      <CollapsibleTrigger className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline">
        <ChevronRight
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
        />
        How families are named
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-sm border border-border px-3 py-1">
        <GcfNamingLegend />
      </CollapsibleContent>
    </Collapsible>
  );
}

"use client";

import * as React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  icon?: LucideIcon;
  badge?: string | number;
  defaultOpen?: boolean;
  /** Lets an expensive panel defer fetching until it is first opened. */
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  icon: Icon,
  badge,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  const handleOpenChange = React.useCallback((open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  }, [onOpenChange]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn("rounded-sm border border-border bg-card", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40">
        {/* min-w-0 + break-words: an unbreakable title (a filename, an accession) would
            otherwise push the header wider than a 390px viewport. */}
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <h2 className="min-w-0 break-words text-left text-sm font-semibold tracking-tight">{title}</h2>
          {badge !== undefined && (
            <Badge variant="outline" className="shrink-0 font-mono tabular-nums">
              {badge}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        <div className="p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

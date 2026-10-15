"use client";

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TOOLTIP_WIDE_CLASS,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

// `Badge` is a <span>, which Radix `asChild` does not make focusable or Enter/Space-activatable,
// so the trigger is a real <button>. Prefer TooltipBadge; use this for non-tooltip overlays.
export function BadgeButton({
  variant,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { variant?: BadgeVariant }) {
  return (
    <Badge asChild variant={variant} className={className}>
      <button type="button" {...props}>
        {children}
      </button>
    </Badge>
  );
}

interface TooltipBadgeProps extends React.ComponentProps<'button'> {
  variant?: BadgeVariant;
  tooltip: React.ReactNode;
  /** Wider, left-aligned bubble. Explicit, unlike InfoTooltip: a ReactNode has no length to measure. */
  wide?: boolean;
}

// Radix tooltips never open on touch, so a click pins the bubble open until clicked again,
// clicked away from, or dismissed with Escape. Hover still peeks on desktop.
export function TooltipBadge({
  variant,
  className,
  tooltip,
  wide = false,
  children,
  onClick,
  ...props
}: TooltipBadgeProps) {
  const [hoverOpen, setHoverOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  const close = React.useCallback(() => {
    setPinned(false);
    setHoverOpen(false);
  }, []);

  return (
    <Tooltip
      open={pinned || hoverOpen}
      // While `open` is controlled Radix reports opening but not closing, so hover is closed
      // by the pointer/focus handlers below.
      onOpenChange={(open) => { if (open) setHoverOpen(true); }}
    >
      <TooltipTrigger asChild>
        <BadgeButton
          variant={variant}
          className={cn('cursor-help', className)}
          aria-expanded={pinned}
          onPointerEnter={() => setHoverOpen(true)}
          onPointerLeave={() => setHoverOpen(false)}
          onFocus={() => setHoverOpen(true)}
          onBlur={() => setHoverOpen(false)}
          onClick={(event) => {
            setPinned((wasPinned) => !wasPinned);
            onClick?.(event);
          }}
          {...props}
        >
          {children}
        </BadgeButton>
      </TooltipTrigger>
      <TooltipContent
        className={wide ? TOOLTIP_WIDE_CLASS : undefined}
        onPointerDownOutside={close}
        onEscapeKeyDown={close}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

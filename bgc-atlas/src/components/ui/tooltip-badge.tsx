"use client";

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TOOLTIP_WIDE_CLASS,
} from '@/components/ui/tooltip';
import { useTapToggleTooltip } from '@/components/ui/use-tap-toggle-tooltip';
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
  /** Extra classes for the bubble, merged after `wide`'s, e.g. `max-w-[440px]`. */
  contentClassName?: string;
}

/**
 * A badge whose tooltip opens by pointer, keyboard and touch, via {@link useTapToggleTooltip}
 * (as `InfoTooltip`): hover peeks with no delay, focus opens it, a tap toggles it, a mouse
 * click only opens it. A tap or click elsewhere, Escape, or the pointer leaving closes it.
 * A caller's `onClick`/`onPointerDown` run first; their `preventDefault()` does not stop the
 * toggle.
 */
export function TooltipBadge({
  variant,
  className,
  tooltip,
  wide = false,
  contentClassName,
  children,
  ...props
}: TooltipBadgeProps) {
  const { open, onOpenChange, triggerProps, contentProps } = useTapToggleTooltip();

  return (
    <Tooltip open={open} onOpenChange={onOpenChange} delayDuration={0}>
      <TooltipTrigger asChild {...triggerProps}>
        <BadgeButton variant={variant} className={cn('cursor-help', className)} {...props}>
          {children}
        </BadgeButton>
      </TooltipTrigger>
      <TooltipContent
        {...contentProps}
        className={cn(wide && TOOLTIP_WIDE_CLASS, contentClassName)}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

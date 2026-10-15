"use client";

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BadgeButton, TooltipBadge } from '@/components/ui/tooltip-badge';
import { FRAGMENTED_TOOLTIP } from '@/lib/gcf-naming';
import { cn } from '@/lib/utils';

interface FragmentedBadgeProps {
  /**
   * `hover` (default): a Tooltip. `tap`: a Popover for the narrow card layout, since
   * Radix tooltips ignore touch pointer moves and can never be opened by touch.
   */
  trigger?: 'hover' | 'tap';
  className?: string;
}

export function FragmentedBadge({ trigger = 'hover', className }: FragmentedBadgeProps) {
  if (trigger === 'tap') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <BadgeButton variant="outline" className={cn('cursor-pointer', className)}>
            Fragmented
          </BadgeButton>
        </PopoverTrigger>
        {/* `role="dialog"` needs a name of its own; the trigger's label is not one. */}
        <PopoverContent
          align="end"
          aria-label="What a fragmented family is"
          className="text-xs leading-relaxed"
        >
          {FRAGMENTED_TOOLTIP}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipBadge variant="outline" className={className} wide tooltip={FRAGMENTED_TOOLTIP}>
      Fragmented
    </TooltipBadge>
  );
}

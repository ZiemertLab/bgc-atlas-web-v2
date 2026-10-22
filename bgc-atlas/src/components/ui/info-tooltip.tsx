"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TOOLTIP_WIDE_CLASS,
} from "@/components/ui/tooltip";
import { useTapToggleTooltip } from "@/components/ui/use-tap-toggle-tooltip";

// Copy at or below this length keeps the narrow bubble. Calibrated on existing tooltips:
// the longest short one is 140 chars, the shortest long one 190.
const WIDE_TOOLTIP_MIN_CHARS = 150;

interface InfoTooltipProps {
  content: React.ReactNode;
  /**
   * A phrase in running text to explain. Given, it is the trigger -- bold, with a
   * dotted underline, the convention for "this term has a definition" that does
   * not read as a link -- in place of the ? icon.
   */
  children?: React.ReactNode;
  /** The wide bubble. Derived from the length of string content; pass it for anything else. */
  wide?: boolean;
}

export function InfoTooltip({ content, children, wide: wideProp }: InfoTooltipProps) {
  const wide = wideProp ?? (typeof content === "string" && content.length > WIDE_TOOLTIP_MIN_CHARS);
  if (children !== undefined) return <TermTooltip content={content} wide={wide}>{children}</TermTooltip>;
  return <IconTooltip content={content} wide={wide} />;
}

/**
 * The icon variant of InfoTooltip: a "?" that opens on hover, focus or tap.
 *
 * Not portalled. The bubble is position:fixed (Radix popper), so it escapes the
 * tables' horizontal-scroll containers without a portal. It is placed wrong under
 * any ancestor that becomes the containing block for fixed elements (a transform,
 * a filter, or `container-type`, which CardHeader sets): the bubble lands off
 * screen. So never put it in a CardHeader.
 */
function IconTooltip({ content, wide }: { content: React.ReactNode; wide: boolean }) {
  const { open, onOpenChange, triggerProps, contentProps } = useTapToggleTooltip();
  return (
    <Tooltip open={open} onOpenChange={onOpenChange} delayDuration={300}>
      <TooltipTrigger asChild {...triggerProps}>
        <button
          type="button"
          className="ml-1.5 inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/40"
          aria-label="More information"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        {...contentProps}
        className={wide ? TOOLTIP_WIDE_CLASS : 'max-w-[250px] text-center'}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The phrase variant of InfoTooltip. Opens on hover, focus and tap like the icon
 * (see useTapToggleTooltip).
 *
 * Portalled, unlike the icon variant: the trigger sits inside running text, and
 * content rendered in place would put block elements inside a <p>.
 */
function TermTooltip({ content, children, wide }: { content: React.ReactNode; children: React.ReactNode; wide: boolean }) {
  const { open, onOpenChange, triggerProps, contentProps } = useTapToggleTooltip();
  return (
    <Tooltip open={open} onOpenChange={onOpenChange} delayDuration={300}>
      <TooltipTrigger asChild {...triggerProps}>
        <button
          type="button"
          className="cursor-help rounded-sm font-bold underline decoration-dotted decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipContent {...contentProps} className={wide ? TOOLTIP_WIDE_CLASS : "max-w-[250px] text-center"}>
          {content}
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
}

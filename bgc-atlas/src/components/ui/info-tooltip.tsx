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

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-1.5 inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/40"
          aria-label="More information"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        className={wide ? TOOLTIP_WIDE_CLASS : 'max-w-[250px] text-center'}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The phrase variant of InfoTooltip.
 *
 * Opens on hover and keyboard focus like any tooltip, and also on tap: a phone has
 * no hover, and Radix's trigger closes the tooltip on pointerdown and on click, so
 * a tap would otherwise open nothing. Those two handlers are pre-empted
 * (preventDefault makes Radix skip its own) and the tap toggles instead; a tap
 * elsewhere still closes it.
 *
 * Portalled, unlike the icon variant: the trigger sits inside running text, and
 * content rendered in place would put block elements inside a <p>.
 */
function TermTooltip({ content, children, wide }: { content: React.ReactNode; children: React.ReactNode; wide: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          className="cursor-help rounded-sm font-bold underline decoration-dotted decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipContent collisionPadding={16} className={wide ? TOOLTIP_WIDE_CLASS : "max-w-[250px] text-center"}>
          {content}
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
}

"use client";

import * as React from "react";

/**
 * Opens a tooltip on tap as well as on hover and keyboard focus.
 *
 * A phone has no hover, and Radix's trigger closes the tooltip on pointerdown and
 * on click, so a tap would otherwise open nothing. Those two handlers are
 * pre-empted (preventDefault makes Radix skip its own) and the tap toggles
 * instead. Hover (after the delay) and focus still arrive through `onOpenChange`,
 * and a tap elsewhere still closes it: the content's DismissableLayer listens for
 * pointerdown on the document, which a controlled `open` does not switch off.
 *
 * The toggle reads the state from before the press, not at click time: Chrome on
 * Android focuses a tapped button, and focus opens the tooltip before the click
 * lands, so toggling at click time would shut what the tap just opened. A mouse
 * click only ever opens: the pointer is already hovering, so the tooltip is
 * usually open, and a click that closed it would read as broken; moving away
 * closes it as before. A keyboard click (Enter/Space, no press) toggles.
 *
 * A press on the trigger is not "outside" for the content's dismiss: the click
 * decides, otherwise the dismiss would close it on pointerdown and the click
 * reopen it -- a visible flicker.
 *
 * Nothing here stops propagation. The outside-dismiss of any OTHER open tooltip
 * relies on this pointerdown and click reaching the document, and Escape on
 * this one relies on keydown reaching it.
 *
 * Focusing a trigger that sits partly outside a scroll container (a badge in a
 * horizontally scrolled table, a header "?" in a wide one) makes the browser
 * scroll it into view. Radix closes an open tooltip on any scroll of an
 * ancestor of its trigger, so the bubble that focus just opened was shut by the
 * scroll that same focus caused, within a frame. Radix means that close for the
 * reader scrolling away, so it is left in place; instead, from focus until the
 * scrolling it caused settles (two animation frames with no scroll of an
 * ancestor), the trigger is watched, and if it still has focus at the end the
 * tooltip is reopened. Any pointerdown, keydown, wheel or touchmove in that
 * window ends the watch without reopening -- that is the reader acting (a tap,
 * Escape, their own scroll), whose close must stick -- and so does blur. A focus
 * that causes no scroll ends the watch after two frames and changes nothing.
 * Like the tap paths, this reopen sets `open` directly and so bypasses Radix's
 * own open bookkeeping: no TOOLTIP_OPEN event, so another open tooltip is not
 * closed by it.
 *
 * `contentProps` also carries `collisionPadding`, so a bubble is shifted to keep
 * a 16px gutter from the viewport edge rather than touching it; the caller still
 * caps the bubble's width to the viewport (`TOOLTIP_WIDE_CLASS`).
 */
export function useTapToggleTooltip() {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pressRef = React.useRef<{ wasOpen: boolean; pointerType: string } | null>(null);
  // Teardown of the focus-scroll watch, while one runs.
  const focusWatchRef = React.useRef<(() => void) | null>(null);

  const endFocusWatch = React.useCallback(() => {
    focusWatchRef.current?.();
    focusWatchRef.current = null;
  }, []);

  React.useEffect(() => endFocusWatch, [endFocusWatch]);

  const startFocusWatch = () => {
    endFocusWatch();
    const trigger = triggerRef.current;
    if (!trigger) return;
    let sawScroll = false;
    let quietFrames = 0;
    let frames = 0;
    let raf = 0;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && e.target.contains(trigger)) {
        sawScroll = true;
        quietFrames = 0;
      }
    };
    const tick = () => {
      frames += 1;
      quietFrames += 1;
      // A cap, so a scroll that never stops (an animation) cannot hold the watch.
      if (quietFrames >= 2 || frames >= 60) {
        // Only once the scroll has settled: at the cap it may still be going.
        const reopen = quietFrames >= 2 && sawScroll && document.activeElement === trigger;
        endFocusWatch();
        if (reopen) setOpen(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const userEvents = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    window.addEventListener("scroll", onScroll, { capture: true });
    // Passive: these only observe, and must not hold up the reader's scroll.
    userEvents.forEach((t) => window.addEventListener(t, endFocusWatch, { capture: true, passive: true }));
    raf = requestAnimationFrame(tick);
    focusWatchRef.current = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, { capture: true });
      userEvents.forEach((t) => window.removeEventListener(t, endFocusWatch, { capture: true }));
    };
  };

  const triggerProps = {
    ref: triggerRef,
    onFocus: startFocusWatch,
    onBlur: endFocusWatch,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      pressRef.current = { wasOpen: open, pointerType: e.pointerType };
    },
    // A press that never becomes a click (a touch that turns into a scroll, a mouse
    // dragged off) leaves no stale record behind for the next keyboard click.
    onPointerCancel: () => {
      pressRef.current = null;
    },
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      // detail 0 is a keyboard click: Enter/Space, never preceded by a press. Read
      // that way, a press left over from a mouse dragged off (no pointercancel) is
      // ignored too.
      const press = e.detail === 0 ? null : pressRef.current;
      pressRef.current = null;
      if (press?.pointerType === "mouse") setOpen(true);
      else setOpen(!(press ? press.wasOpen : open));
    },
  };

  const contentProps = {
    collisionPadding: 16,
    onPointerDownOutside: (e: { target: EventTarget | null; preventDefault: () => void }) => {
      if (e.target instanceof Node && triggerRef.current?.contains(e.target)) e.preventDefault();
    },
  };

  return { open, onOpenChange: setOpen, triggerProps, contentProps };
}

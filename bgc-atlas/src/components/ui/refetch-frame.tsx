import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface RefetchFrameProps {
  /** True while a query that already has rows on screen is fetching new ones. */
  refetching: boolean;
  /** What is loading, for assistive tech, e.g. "Updating BGCs". */
  label: string;
  children: ReactNode;
}

// Keeps the table mounted while refetching: swapping in a skeleton would unmount the column
// filter row and lose the input being typed into. The bar's 2px slot is always reserved.
export function RefetchFrame({ refetching, label, children }: RefetchFrameProps) {
  return (
    <div aria-busy={refetching}>
      <div
        className={cn('h-0.5 w-full overflow-hidden', refetching && 'bg-muted')}
        role={refetching ? 'progressbar' : undefined}
        aria-label={refetching ? label : undefined}
      >
        {refetching && (
          <div className="h-full w-1/4 bg-foreground animate-indeterminate-bar motion-reduce:animate-none" />
        )}
      </div>
      <div className={cn('transition-opacity duration-150', refetching && 'opacity-60')}>
        {children}
      </div>
    </div>
  );
}

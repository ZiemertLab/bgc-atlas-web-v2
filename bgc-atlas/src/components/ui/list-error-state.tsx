'use client';

import { Button } from '@/components/ui/button';
import { ApiError, isDeepPageRefusal, isFilterRefusal } from '@/lib/api-client';

interface ListErrorStateProps {
  error: Error;
  /** What the list holds, for the failure title: "Couldn't load {noun}". */
  noun: string;
  /** Re-run the list query (React Query refetch), never a page reload. */
  onRetry: () => void;
  /** The retry is in flight; the button waits for it. */
  retrying?: boolean;
  /** Back to page one, offered when the server refused a page too deep to serve. */
  onFirstPage?: () => void;
}

/**
 * The results area of a list page when its request did not succeed. Rendered in
 * place of the table, so the header, toolbar and filter chips stay on screen.
 *
 * Every branch shows the server's own sentence, not a stand-in for it. A refused
 * filter names the field and the values it accepts, and that text is the only
 * way to repair a saved or shared link.
 *
 * - A filter refusal (400, `filter_refused`) is not a failure, and asking again
 *   sends the same URL. No title and no button: the sentence, then where the way
 *   out is -- the chip row above.
 * - A deep-page refusal (400, `deep_page`) may come with no filter at all (and
 *   fires when the index is down), so it does not say to remove one. The page
 *   keeps its pager; this offers the first page.
 * - Any other 400 gets the sentence alone: the reader may have nothing to remove.
 * - Anything else may succeed on a second try: a title and a Retry that re-runs
 *   the query.
 */
export function ListErrorState({ error, noun, onRetry, retrying = false, onFirstPage }: ListErrorStateProps) {
  const is400 = error instanceof ApiError && error.status === 400;

  if (is400) {
    return (
      <div role="status" className="py-12 text-center text-sm text-muted-foreground">
        <p className="mx-auto max-w-prose break-words">{error.message}</p>
        {isFilterRefusal(error) && <p className="mt-1">Remove the filter above to see results.</p>}
        {isDeepPageRefusal(error) && onFirstPage && (
          <Button variant="link" size="sm" className="mt-1 h-auto p-0" onClick={onFirstPage}>
            Go to first page
          </Button>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className="py-12 text-center text-sm">
      <p className="font-semibold text-destructive">Couldn&apos;t load {noun}</p>
      <p className="mx-auto mt-2 max-w-prose break-words text-muted-foreground">{error.message}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying}
      >
        Retry
      </Button>
    </div>
  );
}

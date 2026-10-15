import { deserializeFilterGroup } from '@/lib/filters/types';

// Browse pages rebuild requests from state, so an unparseable value would otherwise be dropped and
// the request widened to the whole corpus. The raw text is forwarded for the server to refuse.
export const unreadableAdvancedFilterParam = (raw: string | null | undefined): string | null => {
  if (!raw || !raw.trim()) return null;
  return deserializeFilterGroup(raw) ? null : raw;
};

// The page's own state wins once the reader applies or clears a filter. The value stays in the URL
// too: /studies mirrors it back, and dropping it there would widen the next render.
export const advancedFilterRequestParam = (
  encodedFromState: string,
  unreadableRaw: string | null,
): string | undefined => encodedFromState || unreadableRaw || undefined;

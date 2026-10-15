// Client-safe: the Export menu disables the item with the same sentence the server answers.
export const SAMPLE_TEXT_FILTER_EXPORT_REFUSAL =
  'The environment-text and host filters are answered by the database, not the search '
  + 'index, so they cannot be exported in full yet. Remove them, or download this page.';

export const ASSEMBLY_VIEW_EXPORT_REFUSAL =
  'The assembly view is answered by the database, not the search index, so it cannot '
  + 'be exported in full yet. Switch to samples, or download this page.';

export const GENERIC_SQL_EXPORT_REFUSAL =
  'One of these filters is answered by the database, not the search index, so the full '
  + 'result cannot be exported. Simplify the filters, or download this page.';

export const INDEX_UNAVAILABLE_EXPORT_REFUSAL =
  'The search index is unavailable, so the full result cannot be exported right now. '
  + 'Download this page instead, or try again later.';

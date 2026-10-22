/**
 * Escape text for an HTML email body or a double-quoted attribute.
 *
 * Anything a visitor can influence -- a path, a user agent, a referrer, an alert's
 * title or metadata built from them -- goes into admin mail; escape it rather than
 * trusting it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

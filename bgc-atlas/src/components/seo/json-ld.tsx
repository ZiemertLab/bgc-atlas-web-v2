// Must stay a server component so the markup is present before any JavaScript runs.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }}
    />
  );
}

/**
 * JSON safe to place inside a <script> element.
 *
 * JSON.stringify leaves `<` alone, so a `</script>` inside a value — a study
 * title or a submitter-written abstract — would end the element and let the rest
 * parse as HTML. The \u escapes are the same characters to any JSON parser.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

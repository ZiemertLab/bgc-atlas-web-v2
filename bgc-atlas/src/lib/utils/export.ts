// CSV follows RFC 4180. TSV has no agreed quoting convention, so structural
// characters become spaces.
export function escapeDelimitedField(value: unknown, separator: string): string {
  const text = value == null ? '' : String(value);

  if (separator === '\t') return text.replace(/[\t\r\n]+/g, ' ');

  return text.includes(separator) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function toDelimitedText(headers: string[], rows: unknown[][], separator: string): string {
  return [
    headers.map((header) => escapeDelimitedField(header, separator)).join(separator),
    ...rows.map((row) => row.map((cell) => escapeDelimitedField(cell, separator)).join(separator)),
  ].join('\n');
}

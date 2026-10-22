// CSV follows RFC 4180. TSV has no agreed quoting convention, so structural
// characters become spaces.
export function escapeDelimitedField(value: unknown, separator: string): string {
  const raw = value == null ? '' : String(value);

  if (separator === '\t') return neutraliseFormula(raw.replace(/[\t\r\n]+/g, ' '));

  const text = neutraliseFormula(raw);
  return text.includes(separator) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

const FORMULA_START = /^[=+@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

// A cell a spreadsheet would run as a formula (starting with = + @, or - when not a number)
// gets a leading apostrophe, read as text by Excel, LibreOffice and Sheets (OWASP CSV
// injection): exported cells include text other people wrote, such as shared query ids.
function neutraliseFormula(text: string): string {
  if (text === '') return text;
  if (FORMULA_START.test(text) || (text.startsWith('-') && !PLAIN_NUMBER.test(text))) return `'${text}`;
  return text;
}

export function toDelimitedText(headers: string[], rows: unknown[][], separator: string): string {
  return [
    headers.map((header) => escapeDelimitedField(header, separator)).join(separator),
    ...rows.map((row) => row.map((cell) => escapeDelimitedField(cell, separator)).join(separator)),
  ].join('\n');
}

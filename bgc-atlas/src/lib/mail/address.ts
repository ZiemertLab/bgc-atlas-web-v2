/**
 * Exactly one email address, of a plain shape.
 *
 * For a field whose value becomes a To: or Reply-To: header. Commas, semicolons,
 * angle brackets and whitespace are refused, so "a@x, b@y" is one invalid value
 * rather than a recipient list: the contribute form mailed whatever its email field
 * named, which made it a relay for any number of recipients per request.
 */
const SINGLE_EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function isSingleEmailAddress(value: string): boolean {
  return value.length <= 254 && SINGLE_EMAIL_RE.test(value);
}

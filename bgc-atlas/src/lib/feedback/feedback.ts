// Limits match the table's CHECK constraints, so a message the form accepts is never refused.
export const FEEDBACK_MESSAGE_MAX = 5000;
export const FEEDBACK_EMAIL_MAX = 320;
export const FEEDBACK_PAGE_MAX = 2000;
/** The privacy policy keeps contact addresses at most 90 days. */
export const FEEDBACK_EMAIL_RETENTION_DAYS = 90;

export type FeedbackInput = { message: string; email: string | null; page: string | null };

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; error: string }
  | { ok: 'spam' };

// Deliberately loose: it only has to keep obvious junk out of a Reply-To header.
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function validateFeedback(body: unknown): FeedbackValidation {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  // Honeypot field: reported as spam so the route answers 200 and the bot learns nothing.
  if (text(input.website)) return { ok: 'spam' };

  const message = text(input.message);
  if (!message) return { ok: false, error: 'Please write a message.' };
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, error: `Please keep the message under ${FEEDBACK_MESSAGE_MAX.toLocaleString()} characters.` };
  }

  const email = text(input.email);
  if (email && (email.length > FEEDBACK_EMAIL_MAX || !EMAIL_RE.test(email))) {
    return { ok: false, error: 'That email address does not look right.' };
  }

  // Only a path on this site; the form never sends a full URL.
  const pageRaw = text(input.page);
  const page = pageRaw.startsWith('/') ? pageRaw.slice(0, FEEDBACK_PAGE_MAX) : null;

  return { ok: true, value: { message, email: email || null, page } };
}

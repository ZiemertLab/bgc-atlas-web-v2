import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { buildMailTransport } from '@/lib/mail/transport';
import { checkRateLimit, feedbackRateLimit, getClientIp } from '@/lib/rate-limit';
import { FEEDBACK_EMAIL_RETENTION_DAYS, validateFeedback, type FeedbackInput } from '@/lib/feedback/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Never the reader's address (that only becomes Reply-To), or the form would mail anyone a bot names.
const recipients = (): string[] =>
  (process.env.FEEDBACK_TO || process.env.CONTRIBUTION_CC || '')
    .split(',').map((v) => v.trim()).filter(Boolean);

const notify = async (id: string, input: FeedbackInput) => {
  const mail = buildMailTransport();
  const to = recipients();
  if (!mail || to.length === 0) return;
  await mail.transporter.sendMail({
    from: mail.from,
    to,
    ...(input.email ? { replyTo: input.email } : {}),
    subject: `BGC Atlas feedback${input.page ? ` (${input.page})` : ''}`,
    text: `${input.message}\n\n--\nPage: ${input.page ?? 'not given'}\n`
      + `Reply-to: ${input.email ?? 'not given'}\nFeedback ID: ${id}\n`,
  });
};

export async function POST(request: Request) {
  const rate = await checkRateLimit(feedbackRateLimit, getClientIp(request));
  if (!rate.success) {
    return NextResponse.json(
      { success: false, error: 'Too many messages from here in the last hour. Please try again later, or email us.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.reset - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed request.' }, { status: 400 });
  }
  const checked = validateFeedback(body);
  if (checked.ok === 'spam') return NextResponse.json({ success: true });
  if (!checked.ok) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });

  const { message, email, page } = checked.value;
  let id: string;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO feedback (message, email, page)
      VALUES (${message}, ${email}, ${page})
      RETURNING id::text AS id`;
    id = rows[0].id;
  } catch (error) {
    console.error('feedback: could not store', error);
    return NextResponse.json(
      { success: false, error: 'Your message could not be saved. Please email us instead.' },
      { status: 500 },
    );
  }

  // Neither may turn a stored message into a reported failure.
  // Privacy policy: contact addresses are purged after 90 days.
  await prisma.$executeRaw`
    UPDATE feedback SET email = NULL
     WHERE email IS NOT NULL
       AND created_at < now() - make_interval(days => ${FEEDBACK_EMAIL_RETENTION_DAYS}::int)`
    .catch((error) => console.error('feedback: email purge failed', error));
  await notify(id, checked.value)
    .catch((error) => console.error('feedback: notification email failed', error));
  return NextResponse.json({ success: true });
}
